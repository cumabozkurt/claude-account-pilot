import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, type NativeImage } from "electron";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { applyClaudeBaseUrl, claudeEnvSnippet, restoreClaudeSettings } from "../core/claude-settings.js";
import { loadConfig, saveConfig } from "../core/config.js";
import { DISCOVERED_CLAUDE, DISCOVERED_CODEX, readClaudeOauth, readCodexAuth } from "../core/credentials.js";
import { discoverInstalls, type Discovery } from "../core/discover.js";
import { detectLang, translate } from "../core/i18n.js";
import { emptyLedger, loadLedger, recordUsage, saveLedger } from "../core/ledger.js";
import type { RuntimeSnapshot } from "../core/plan.js";
import { startProxy, type RunningProxy } from "../core/proxy.js";
import { windowsFromUsageJson, worstPercent } from "../core/quota.js";
import {
  PROVIDER_IDS,
  type Account,
  type ActivityEvent,
  type AppConfig,
  type AuthKind,
  type Lang,
  type ProviderId,
  type QuotaSource,
  type QuotaWindow,
  defaultConfig,
} from "../core/types.js";
import { createSecretStore, type SecretStore } from "./secrets.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const here = fileURLToPath(new URL(".", import.meta.url));
const rendererHtml = join(here, "../renderer/index.html");
const preloadPath = join(here, "../preload/preload.cjs");

let config: AppConfig = defaultConfig();
let secrets: SecretStore = null as unknown as SecretStore;
let ledgerPath = "";
let configPath = "";
let ledger = emptyLedger();
let proxy: RunningProxy | null = null;
let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let icon: NativeImage;
let quitting = false;
let probeTimer: NodeJS.Timeout | null = null;
const activity: ActivityEvent[] = [];
const quotaNotes = new Map<string, { windows: QuotaWindow[]; percent: number | null; source: QuotaSource; note?: string }>();
let flash: { text: string; warn?: boolean } | null = null;

const runtime: RuntimeSnapshot = {
  config: undefined as unknown as AppConfig,
  activeByProvider: {},
  percentByAccount: {},
  cooldownUntil: {},
};

function home(): string {
  return app.getPath("home") || homedir();
}

function persist(): void {
  saveConfig(configPath, config);
}

function pushActivity(event: ActivityEvent): void {
  activity.unshift(event);
  if (activity.length > 40) activity.length = 40;
}

function publicState() {
  const lang = config.lang ?? "en";
  const baseUrl = `http://127.0.0.1:${proxy?.port ?? config.proxyPort}`;
  const activeId = runtime.activeByProvider.claude;
  const active = config.accounts.find((account) => account.id === activeId) ?? config.accounts.find((account) => account.enabled);
  const activeQuota = active ? quotaNotes.get(active.id) : undefined;
  return {
    version: pkg.version,
    lang,
    proxyRunning: Boolean(proxy),
    baseUrl,
    envSnippet: claudeEnvSnippet(baseUrl),
    threshold: config.switchThreshold,
    port: config.proxyPort,
    widgetEnabled: config.widgetEnabled,
    launchAtLogin: config.launchAtLogin,
    encryptionWarning: secrets.plainWarning(),
    providersEnabled: config.providersEnabled,
    accounts: config.accounts.map((account) => {
      const usage = ledger.byAccount[account.id];
      const quota = quotaNotes.get(account.id);
      return {
        id: account.id,
        provider: account.provider,
        label: account.label,
        enabled: account.enabled,
        active: runtime.activeByProvider[account.provider] === account.id,
        percent: quota?.percent ?? runtime.percentByAccount[account.id] ?? null,
        windows: quota?.windows ?? [],
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
        costUsd: usage?.costUsd ?? 0,
        source: quota?.source ?? (usage ? "local-estimate" : "none"),
        note: quota?.note,
      };
    }),
    routes: config.routes,
    discoveries: discoverInstalls(home()),
    activity,
    activeLabel: active?.label ?? "",
    activePercent: activeQuota?.percent ?? (active ? runtime.percentByAccount[active.id] ?? null : null),
    message: flash,
  };
}

function publish(): void {
  const state = publicState();
  for (const window of [mainWindow, widgetWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("pilot:state", state);
  }
  refreshTray(state.lang, state.activePercent, state.activeLabel);
}

async function resolveSecret(account: Account): Promise<string | null> {
  try {
    if (account.secretRef === DISCOVERED_CODEX) {
      const login = readCodexAuth(JSON.parse(readFileSync(join(home(), ".codex", "auth.json"), "utf8")));
      return login?.token ?? null;
    }
    if (account.secretRef === DISCOVERED_CLAUDE) {
      for (const relative of [join(".claude", ".credentials.json"), ".claude.json"]) {
        try {
          const login = readClaudeOauth(JSON.parse(readFileSync(join(home(), relative), "utf8")));
          if (login?.token) return login.token;
        } catch {
          /* try the next known file */
        }
      }
      return null;
    }
  } catch {
    return null;
  }
  return secrets.get(account.secretRef);
}

async function startListening(): Promise<void> {
  if (proxy || !config.proxyEnabled) return;
  try {
    proxy = await startProxy(
      {
        getState: () => runtime,
        getSecret: resolveSecret,
        onQuota: (accountId, percent, windows) => {
          runtime.percentByAccount[accountId] = percent;
          quotaNotes.set(accountId, { windows, percent, source: "headers" });
          publish();
        },
        onUsage: (accountId, model, usage) => {
          recordUsage(ledger, accountId, model, usage);
          saveLedger(ledgerPath, ledger);
          const existing = quotaNotes.get(accountId);
          if (!existing || existing.source === "none" || existing.source === "local-estimate") {
            quotaNotes.set(accountId, {
              windows: existing?.windows ?? [],
              percent: existing?.percent ?? runtime.percentByAccount[accountId] ?? null,
              source: existing?.percent != null ? existing.source : "local-estimate",
              note: existing?.note,
            });
          }
          publish();
        },
        onSwitch: () => undefined,
        onActivity: (event) => {
          pushActivity(event);
          publish();
        },
        onCooldown: (accountId, until) => {
          runtime.cooldownUntil[accountId] = until;
        },
        rememberActive: (provider, accountId) => {
          runtime.activeByProvider[provider] = accountId;
        },
      },
      config.proxyPort,
    );
    if (proxy.port !== config.proxyPort) {
      config.proxyPort = proxy.port;
      persist();
    }
  } catch (error) {
    proxy = null;
    flash = { text: error instanceof Error ? error.message : "proxy", warn: true };
  }
}

async function stopListening(): Promise<void> {
  const running = proxy;
  proxy = null;
  if (running) await running.close();
}

async function probeQuotas(): Promise<void> {
  for (const account of config.accounts) {
    if (!account.enabled) continue;
    const secret = await resolveSecret(account);
    if (!secret) continue;
    try {
      if (account.provider === "claude" && account.authKind !== "api-key") {
        const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
          headers: { authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const windows = windowsFromUsageJson(await response.json());
          const percent = worstPercent(windows);
          if (percent != null) runtime.percentByAccount[account.id] = percent;
          quotaNotes.set(account.id, { windows, percent, source: "provider" });
        }
      } else if (account.provider === "deepseek") {
        const response = await fetch("https://api.deepseek.com/user/balance", {
          headers: { authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const payload = (await response.json()) as {
            balance_infos?: Array<{ total_balance?: string; currency?: string }>;
          };
          const info = payload.balance_infos?.[0];
          if (info?.total_balance) {
            const previous = quotaNotes.get(account.id);
            quotaNotes.set(account.id, {
              windows: previous?.windows ?? [],
              percent: previous?.percent ?? null,
              source: "provider",
              note: `${info.total_balance} ${info.currency ?? ""}`.trim(),
            });
          }
        }
      }
    } catch {
      /* a failed probe keeps the last ledger and header reading */
    }
  }
  publish();
}

function showMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  mainWindow?.show();
  mainWindow?.focus();
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 820,
    minWidth: 760,
    minHeight: 640,
    show: false,
    title: "Claude Account Pilot",
    icon: join(here, "../icon.png"),
    backgroundColor: "#f3efe6",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  void mainWindow.loadFile(rendererHtml);
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (process.env.PILOT_SMOKE === "1") {
      setTimeout(() => {
        const shot = process.env.PILOT_SHOT;
        const finish = () => app.exit(0);
        if (!shot || !mainWindow) {
          finish();
          return;
        }
        mainWindow.webContents
          .capturePage()
          .then((image) => {
            const { writeFileSync } = require("node:fs") as typeof import("node:fs");
            writeFileSync(shot, image.toPNG());
          })
          .finally(finish);
      }, 700);
    }
  });
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function syncWidget(): void {
  if (!config.widgetEnabled) {
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide();
    return;
  }
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    widgetWindow = new BrowserWindow({
      width: 280,
      height: 156,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      frame: false,
      show: false,
      backgroundColor: "#fffdf8",
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    void widgetWindow.loadFile(rendererHtml, { query: { widget: "1" } });
  }
  widgetWindow.showInactive();
}

function refreshTray(lang: Lang, percent: number | null, label: string): void {
  if (!tray) return;
  const summary =
    percent == null
      ? label || "Claude Account Pilot"
      : translate(lang, "tray.summary", { label: label || "Claude", percent: `${Math.round(percent)}%` });
  tray.setToolTip(summary);
  if (process.platform === "darwin") tray.setTitle(percent == null ? "" : ` ${Math.round(percent)}%`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: translate(lang, "tray.open"), click: () => showMain() },
      {
        label: translate(lang, "tray.widget"),
        type: "checkbox",
        checked: config.widgetEnabled,
        click: (item) => {
          config.widgetEnabled = item.checked;
          persist();
          syncWidget();
          publish();
        },
      },
      { type: "separator" },
      { label: summary, enabled: false },
      { type: "separator" },
      {
        label: translate(lang, "tray.quit"),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as string[]).includes(value);
}

function registerIpc(): void {
  ipcMain.handle("pilot:getState", () => publicState());
  ipcMain.handle("pilot:setLang", (_event, lang: Lang) => {
    if (lang === "en" || lang === "tr") {
      config.lang = lang;
      persist();
      publish();
    }
  });
  ipcMain.handle("pilot:setThreshold", (_event, value: number) => {
    if (Number.isFinite(value)) {
      config.switchThreshold = Math.min(99, Math.max(50, Math.round(value)));
      persist();
      publish();
    }
  });
  ipcMain.handle("pilot:setPort", async (_event, value: number) => {
    if (!Number.isFinite(value) || value < 1 || value > 65535) return;
    config.proxyPort = Math.round(value);
    persist();
    await stopListening();
    await startListening();
    publish();
  });
  ipcMain.handle("pilot:setProxyEnabled", async (_event, enabled: boolean) => {
    config.proxyEnabled = Boolean(enabled);
    persist();
    if (config.proxyEnabled) await startListening();
    else await stopListening();
    publish();
  });
  ipcMain.handle("pilot:setProvider", (_event, id: ProviderId, enabled: boolean) => {
    if (!isProvider(id)) return;
    config.providersEnabled[id] = Boolean(enabled);
    persist();
    publish();
  });
  ipcMain.handle("pilot:setWidget", (_event, enabled: boolean) => {
    config.widgetEnabled = Boolean(enabled);
    persist();
    syncWidget();
    publish();
  });
  ipcMain.handle("pilot:setLaunchAtLogin", (_event, enabled: boolean) => {
    config.launchAtLogin = Boolean(enabled);
    app.setLoginItemSettings({ openAtLogin: config.launchAtLogin });
    persist();
    publish();
  });
  ipcMain.handle("pilot:addAccount", (_event, input: { label?: string; provider?: string; secret?: string; authKind?: AuthKind }) => {
    const label = (input.label ?? "").trim();
    const secret = (input.secret ?? "").trim();
    if (!isProvider(input.provider) || label.length < 1 || secret.length < 8) {
      flash = { text: config.lang === "tr" ? "Hesap bilgisi eksik." : "Account details are incomplete.", warn: true };
      publish();
      return;
    }
    const id = randomUUID();
    secrets.set(id, secret);
    config.accounts.push({
      id,
      provider: input.provider,
      label: label.slice(0, 80),
      enabled: true,
      secretRef: id,
      authKind: input.authKind === "oauth" ? "oauth" : "api-key",
    });
    config.providersEnabled[input.provider] = true;
    flash = { text: translate(config.lang ?? "en", "status.saved") };
    persist();
    publish();
  });
  ipcMain.handle("pilot:toggleAccount", (_event, id: string, enabled: boolean) => {
    const account = config.accounts.find((item) => item.id === id);
    if (!account) return;
    account.enabled = Boolean(enabled);
    persist();
    publish();
  });
  ipcMain.handle("pilot:removeAccount", (_event, id: string) => {
    const account = config.accounts.find((item) => item.id === id);
    if (!account) return;
    if (!account.secretRef.startsWith("discovered:")) secrets.delete(account.secretRef);
    config.accounts = config.accounts.filter((item) => item.id !== id);
    delete runtime.percentByAccount[id];
    quotaNotes.delete(id);
    persist();
    publish();
  });
  ipcMain.handle("pilot:toggleRoute", (_event, id: string, enabled: boolean) => {
    const route = config.routes.find((item) => item.id === id);
    if (!route) return;
    route.enabled = Boolean(enabled);
    persist();
    publish();
  });
  ipcMain.handle("pilot:addRoute", (_event, input: { match?: string; provider?: string; targetModel?: string }) => {
    const match = (input.match ?? "").trim();
    const targetModel = (input.targetModel ?? "").trim();
    if (!isProvider(input.provider) || !match || !targetModel) return;
    config.routes.push({ id: randomUUID(), enabled: true, match, provider: input.provider, targetModel });
    persist();
    publish();
  });
  ipcMain.handle("pilot:removeRoute", (_event, id: string) => {
    config.routes = config.routes.filter((route) => route.id !== id);
    persist();
    publish();
  });
  ipcMain.handle("pilot:moveRoute", (_event, id: string, direction: number) => {
    const index = config.routes.findIndex((route) => route.id === id);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= config.routes.length) return;
    const [route] = config.routes.splice(index, 1);
    if (route) config.routes.splice(next, 0, route);
    persist();
    publish();
  });
  ipcMain.handle("pilot:importDiscovered", (_event, provider: ProviderId) => {
    importDiscovered(provider);
    persist();
    publish();
  });
  ipcMain.handle("pilot:applyClaude", () => {
    const baseUrl = `http://127.0.0.1:${proxy?.port ?? config.proxyPort}`;
    applyClaudeBaseUrl(home(), baseUrl);
    flash = { text: translate(config.lang ?? "en", "proxy.applied") };
    publish();
  });
  ipcMain.handle("pilot:restoreClaude", () => {
    const ok = restoreClaudeSettings(home());
    flash = { text: translate(config.lang ?? "en", ok ? "proxy.restored" : "proxy.noBackup"), warn: !ok };
    publish();
  });
  ipcMain.handle("pilot:openMain", () => showMain());
}

function importDiscovered(provider: ProviderId): void {
  const found: Discovery[] = discoverInstalls(home());
  const hit = found.find((item) => item.provider === provider && item.canImport);
  if (!hit) return;
  if (provider === "codex" && !config.accounts.some((account) => account.secretRef === DISCOVERED_CODEX)) {
    const login = readCodexAuth(JSON.parse(readFileSync(join(home(), ".codex", "auth.json"), "utf8")));
    if (!login) return;
    config.accounts.push({
      id: randomUUID(),
      provider: "codex",
      label: "Codex",
      enabled: true,
      secretRef: DISCOVERED_CODEX,
      authKind: "discovered",
      externalId: login.accountId,
      baseUrl: login.kind === "apikey" ? "https://api.openai.com/v1" : undefined,
    });
    config.providersEnabled.codex = true;
  }
  if (provider === "claude" && !config.accounts.some((account) => account.secretRef === DISCOVERED_CLAUDE)) {
    config.accounts.push({
      id: randomUUID(),
      provider: "claude",
      label: "Claude Code",
      enabled: true,
      secretRef: DISCOVERED_CLAUDE,
      authKind: "oauth",
    });
    config.providersEnabled.claude = true;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showMain());
  void app.whenReady().then(async () => {
    app.setAppUserModelId("dev.cumabozkurt.claudeaccountpilot");
    const dir = app.getPath("userData");
    configPath = join(dir, "config.json");
    ledgerPath = join(dir, "ledger.json");
    config = loadConfig(configPath);
    if (!config.lang) config.lang = detectLang(app.getLocale());
    runtime.config = config;
    ledger = loadLedger(ledgerPath);
    secrets = createSecretStore(join(dir, "secrets.bin"));
    persist();
    icon = nativeImage.createFromPath(join(here, "../icon.png"));
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
    else icon = icon.resize({ width: 18, height: 18 });
    tray = new Tray(icon);
    tray.on("click", () => showMain());
    registerIpc();
    app.setLoginItemSettings({ openAtLogin: config.launchAtLogin });
    await startListening();
    createMainWindow();
    syncWidget();
    publish();
    void probeQuotas();
    probeTimer = setInterval(() => void probeQuotas(), 60_000);
    probeTimer.unref();
  });
}

app.on("before-quit", () => {
  quitting = true;
  if (probeTimer) clearInterval(probeTimer);
});

app.on("will-quit", () => {
  void stopListening();
});

app.on("window-all-closed", () => {
  /* stay in the tray */
});
