import { app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, shell, type NativeImage } from "electron";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { applyClaudeBaseUrl, claudeEnvSnippet, restoreClaudeSettings } from "../core/claude-settings.js";
import { loadConfig, saveConfig } from "../core/config.js";
import { captureDisk, claudeCodeOwns, keychainPlan, readCredentialsRaw, restoreCredentialsFile, writeCredentialsFile } from "../core/credential-swap.js";
import { DISCOVERED_CLAUDE, DISCOVERED_CODEX, readCodexAuth } from "../core/credentials.js";
import { appendSample, type QuotaSample } from "../core/history.js";
import { bindingReset, evaluateAlerts, percentAfterReset } from "../core/monitor.js";
import {
  accessTokenFromSecret,
  blobFromSecret,
  buildAuthorizeUrl,
  createPkce,
  credentialsDocument,
  exchangeClaudeCode,
  lineageOf,
  type HttpClient,
  type PkceLogin,
} from "../core/oauth-claude.js";
import { pollClaudeSubscription } from "../core/subscription.js";
import { applyCodexRefresh, codexNeedsRefresh, codexRefreshRequest, mergeCodexTokens, parseCodexTokens } from "../core/oauth-codex.js";
import {
  ANTIGRAVITY,
  applyGoogleToken,
  buildAntigravityAuthorizeUrl,
  createGoogleLogin,
  googleExchangeRequest,
  googleNeedsRefresh,
  googleRefreshRequest,
  googleTokensDocument,
  parseGoogleTokens,
} from "../core/oauth-google.js";
import { OPENROUTER_KEY_URL, openRouterPercent } from "../core/openrouter.js";
import { listenForOAuthCode } from "../core/oauth-loopback.js";
import { discoverInstalls, type Discovery } from "../core/discover.js";
import { detectLang, translate } from "../core/i18n.js";
import { emptyLedger, loadLedger, recordUsage, saveLedger } from "../core/ledger.js";
import type { RuntimeSnapshot } from "../core/plan.js";
import { startProxy, type RunningProxy } from "../core/proxy.js";
import { loadRuntime, saveRuntime, type PersistedRuntime } from "../core/runtime-file.js";
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
let runtimePath = "";
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
let history: QuotaSample[] = [];
let alertSeen: Record<string, true> = {};
let pendingLogin: PkceLogin | null = null;
let flash: { text: string; warn?: boolean } | null = null;

const runtime: RuntimeSnapshot = {
  config: undefined as unknown as AppConfig,
  activeByProvider: {},
  percentByAccount: {},
  cooldownUntil: {},
};

const ANTIGRAVITY_CLIENT_SECRET = "antigravity:client-secret";

function googleClient(): { clientId: string; clientSecret: string } {
  return {
    clientId: config.antigravityClientId.trim(),
    clientSecret: secrets.get(ANTIGRAVITY_CLIENT_SECRET) ?? "",
  };
}

function home(): string {
  return app.getPath("home") || homedir();
}

function diskLineage(): string | undefined {
  return captureDisk(readCredentialsRaw(home())).diskLineage;
}

const nodeHttp: HttpClient = async (request) => {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, body: await response.text() };
};

function rememberQuota(accountId: string, windows: QuotaWindow[], percent: number | null, source: QuotaSource, note?: string): void {
  runtime.percentByAccount[accountId] = percent;
  const previous = quotaNotes.get(accountId);
  quotaNotes.set(accountId, { windows, percent, source, note: note ?? previous?.note });
  history = appendSample(history, { at: new Date().toISOString(), accountId, percent, windows });
}

function notifyUser(title: string, body: string): void {
  if (!config.notify) return;
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

function persist(): void {
  saveConfig(configPath, config);
}

function snapshotRuntime(): PersistedRuntime {
  const quotas: PersistedRuntime["quotas"] = {};
  for (const [id, quota] of quotaNotes) quotas[id] = quota;
  return {
    version: 1,
    activeByProvider: { ...runtime.activeByProvider },
    percentByAccount: { ...runtime.percentByAccount },
    quotas,
    activity: activity.slice(0, 40),
    history,
    alertSeen: Object.keys(alertSeen),
  };
}

function persistRuntime(): void {
  if (!runtimePath) return;
  saveRuntime(runtimePath, snapshotRuntime());
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
        authKind: account.authKind,
        email: account.email,
        synced: config.syncedAccountId === account.id,
        ownedByClaudeCode: claudeCodeOwns(account.lineage, diskLineage()),
        resetsAt: quota ? bindingReset(quota.windows) : undefined,
        history: history.filter((sample) => sample.accountId === account.id).slice(-48).map((sample) => sample.percent),
      };
    }),
    notify: config.notify,
    syncedAccountId: config.syncedAccountId,
    antigravityClientId: config.antigravityClientId,
    antigravityClientReady: Boolean(config.antigravityClientId && secrets.get(ANTIGRAVITY_CLIENT_SECRET)),
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

async function readStoredSecret(account: Account): Promise<string | null> {
  try {
    if (account.secretRef === DISCOVERED_CODEX) {
      const path = join(home(), ".codex", "auth.json");
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      let tokens = parseCodexTokens(raw);
      if (tokens && codexNeedsRefresh(tokens)) {
        const request = codexRefreshRequest(tokens);
        if (request) {
          const response = await nodeHttp(request);
          const refreshed = applyCodexRefresh(tokens, response.status, response.body);
          if (refreshed.tokens) {
            tokens = refreshed.tokens;
            writeFileSync(path, `${JSON.stringify(mergeCodexTokens(raw, tokens), null, 2)}\n`, { mode: 0o600 });
            pushActivity({ at: new Date().toISOString(), key: "log.refreshed", vars: { label: account.label } });
          }
        }
      }
      if (tokens?.accountId) account.externalId = tokens.accountId;
      return tokens?.accessToken ?? null;
    }
    if (account.secretRef === DISCOVERED_CLAUDE) return readCredentialsRaw(home());
  } catch {
    return null;
  }
  const stored = secrets.get(account.secretRef);
  if (!stored || account.provider !== "antigravity") return stored;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored) as unknown;
  } catch {
    return stored;
  }
  const tokens = parseGoogleTokens(parsed);
  if (!tokens) return stored;
  if (tokens.refreshToken && googleNeedsRefresh(tokens)) {
    const request = googleRefreshRequest(tokens, googleClient());
    if (request) {
      try {
        const response = await nodeHttp(request);
        const refreshed = applyGoogleToken(tokens, response.status, response.body);
        if (refreshed.tokens) {
          secrets.set(account.secretRef, googleTokensDocument(refreshed.tokens));
          account.expiresAt = refreshed.tokens.expiresAt;
          account.email = refreshed.tokens.email ?? account.email;
          if (refreshed.tokens.projectId) account.externalId = refreshed.tokens.projectId;
          return refreshed.tokens.accessToken;
        }
      } catch {
        return tokens.accessToken;
      }
    }
  }
  return tokens.accessToken;
}

async function resolveSecret(account: Account): Promise<string | null> {
  const stored = await readStoredSecret(account);
  if (!stored) return null;
  if (account.provider === "claude" && account.authKind !== "api-key") return accessTokenFromSecret(stored);
  return stored;
}

function storeOauthBlob(account: Account, stored: string, blob: NonNullable<ReturnType<typeof blobFromSecret>>): void {
  if (account.secretRef.startsWith("discovered:")) return;
  secrets.set(account.secretRef, stored);
  account.expiresAt = blob.expiresAt;
  account.email = blob.email ?? account.email;
  account.lineage = lineageOf(blob.refreshToken) ?? account.lineage;
  if (blob.accountUuid) account.externalId = blob.accountUuid;
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
          persistRuntime();
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
          persistRuntime();
          publish();
        },
        onCooldown: (accountId, until) => {
          runtime.cooldownUntil[accountId] = until;
        },
        rememberActive: (provider, accountId) => {
          runtime.activeByProvider[provider] = accountId;
          persistRuntime();
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
  const now = Date.now();
  for (const [id, quota] of quotaNotes) {
    const released = percentAfterReset(quota.windows, now);
    if (released.windows.length !== quota.windows.length) {
      quotaNotes.set(id, { ...quota, windows: released.windows, percent: released.percent });
      runtime.percentByAccount[id] = released.percent;
    }
  }
  const previous = new Map<string, number | null>();
  for (const account of config.accounts) previous.set(account.id, quotaNotes.get(account.id)?.percent ?? runtime.percentByAccount[account.id] ?? null);
  for (const account of config.accounts) {
    if (!account.enabled) continue;
    const stored = await readStoredSecret(account);
    if (!stored) continue;
    try {
      if (account.provider === "claude" && account.authKind !== "api-key") {
        const blob = blobFromSecret(stored);
        const owns = claudeCodeOwns(account.lineage ?? lineageOf(blob?.refreshToken), diskLineage());
        const polled = await pollClaudeSubscription(stored, nodeHttp, owns, now);
        if (polled.stored && polled.blob) storeOauthBlob(account, polled.stored, polled.blob);
        if (polled.rotated) {
          pushActivity({ at: new Date().toISOString(), key: "log.refreshed", vars: { label: account.label } });
        }
        if (polled.dead) {
          quotaNotes.set(account.id, {
            windows: quotaNotes.get(account.id)?.windows ?? [],
            percent: quotaNotes.get(account.id)?.percent ?? null,
            source: "provider",
            note: "relogin",
          });
          pushActivity({ at: new Date().toISOString(), key: "log.oauthDead", vars: { label: account.label } });
        } else if (polled.usageStatus === 200 && polled.usageBody) {
          const windows = windowsFromUsageJson(JSON.parse(polled.usageBody) as unknown);
          const percent = worstPercent(windows);
          rememberQuota(account.id, windows, percent, "provider");
        }
      } else if (account.provider === "deepseek") {
        const secret = accessTokenFromSecret(stored) ?? stored;
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
            persistRuntime();
          }
        }
      } else if (account.provider === "openrouter") {
        const response = await fetch(OPENROUTER_KEY_URL, {
          headers: { authorization: `Bearer ${stored}` },
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const parsed = openRouterPercent(await response.json());
          const windows = parsed.percent == null ? [] : [{ label: "balance" as const, percent: parsed.percent, name: "credits" }];
          rememberQuota(account.id, windows, parsed.percent, "provider", parsed.note);
        }
      }
    } catch {
      /* a failed probe keeps the last ledger and header reading */
    }
  }
  const alerts = evaluateAlerts(
    config.accounts.map((account) => {
      const quota = quotaNotes.get(account.id);
      return {
        id: account.id,
        label: account.label,
        enabled: account.enabled,
        previousPercent: previous.get(account.id) ?? null,
        percent: quota?.percent ?? runtime.percentByAccount[account.id] ?? null,
        resetsAt: quota ? bindingReset(quota.windows) : undefined,
      };
    }),
    config.switchThreshold,
    alertSeen,
    now,
  );
  alertSeen = alerts.seen;
  const lang = config.lang ?? "en";
  for (const alert of alerts.alerts) {
    const key = alert.kind === "threshold" ? "notify.threshold" : alert.kind === "reset-soon" ? "notify.resetSoon" : "notify.poolFull";
    notifyUser(translate(lang, "app.title"), translate(lang, key, alert.vars));
    pushActivity({ at: new Date().toISOString(), key, vars: alert.vars });
  }
  persist();
  persistRuntime();
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
  ipcMain.handle(
    "pilot:addRoute",
    (_event, input: { match?: string; provider?: string; targetModel?: string; fallbacks?: Array<{ provider?: string; targetModel?: string }> }) => {
      const match = (input.match ?? "").trim();
      const targetModel = (input.targetModel ?? "").trim();
      if (!isProvider(input.provider) || !match || !targetModel) return;
      const fallbacks = (input.fallbacks ?? [])
        .filter((hop) => isProvider(hop.provider) && (hop.targetModel ?? "").trim())
        .map((hop) => ({ provider: hop.provider as ProviderId, targetModel: (hop.targetModel ?? "").trim() }));
      config.routes.push({
        id: randomUUID(),
        enabled: true,
        match,
        provider: input.provider,
        targetModel,
        fallbacks: fallbacks.length ? fallbacks : undefined,
      });
      persist();
      publish();
    },
  );
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
  ipcMain.handle("pilot:setNotify", (_event, enabled: boolean) => {
    config.notify = Boolean(enabled);
    persist();
    publish();
  });
  ipcMain.handle("pilot:startClaudeLogin", async () => {
    pendingLogin = createPkce();
    const url = buildAuthorizeUrl(pendingLogin);
    await shell.openExternal(url);
    flash = { text: translate(config.lang ?? "en", "oauth.opened") };
    publish();
    return { url };
  });
  ipcMain.handle("pilot:finishClaudeLogin", async (_event, pasted: string) => {
    const login = pendingLogin;
    if (!login) {
      flash = { text: translate(config.lang ?? "en", "oauth.badCode"), warn: true };
      publish();
      return { ok: false };
    }
    const result = await exchangeClaudeCode(login, String(pasted ?? ""), nodeHttp);
    pendingLogin = null;
    if (!result.blob) {
      flash = { text: translate(config.lang ?? "en", "oauth.badCode"), warn: true };
      publish();
      return { ok: false };
    }
    addManagedClaude(result.blob, result.blob.email || "Claude");
    flash = { text: translate(config.lang ?? "en", "oauth.saved") };
    persist();
    publish();
    void probeQuotas();
    return { ok: true };
  });
  ipcMain.handle("pilot:importClaudeCredentials", (_event, raw: string) => {
    const blob = blobFromSecret(String(raw ?? ""));
    if (!blob?.refreshToken && !blob?.accessToken) {
      flash = { text: translate(config.lang ?? "en", "oauth.badCode"), warn: true };
      publish();
      return { ok: false };
    }
    if (!blob) return { ok: false };
    addManagedClaude(blob, blob.email || "Claude");
    flash = { text: translate(config.lang ?? "en", "oauth.saved") };
    persist();
    publish();
    void probeQuotas();
    return { ok: true };
  });
  ipcMain.handle("pilot:syncClaudeAccount", (_event, id: string) => {
    const account = config.accounts.find((item) => item.id === id && item.provider === "claude");
    if (!account) return { ok: false };
    void (async () => {
      const stored = await readStoredSecret(account);
      const blob = stored ? blobFromSecret(stored) : null;
      if (!stored || !blob) {
        flash = { text: translate(config.lang ?? "en", "oauth.badCode"), warn: true };
        publish();
        return;
      }
      absorbDisk();
      const document = credentialsDocument(blob);
      writeCredentialsFile(home(), document);
      const plan = keychainPlan(process.platform, userInfo().username, document.trim());
      if (plan) {
        execFile(plan.command, plan.args, () => undefined);
      }
      account.lineage = lineageOf(blob.refreshToken) ?? account.lineage;
      config.syncedAccountId = account.id;
      flash = { text: translate(config.lang ?? "en", "oauth.swapped") };
      persist();
      publish();
    })();
    return { ok: true };
  });
  ipcMain.handle("pilot:restoreClaudeCredentials", () => {
    const ok = restoreCredentialsFile(home());
    if (ok) config.syncedAccountId = null;
    flash = { text: translate(config.lang ?? "en", ok ? "oauth.restored" : "oauth.noBackup"), warn: !ok };
    persist();
    publish();
  });
  ipcMain.handle("pilot:setAntigravityClient", (_event, input: { clientId?: string; clientSecret?: string }) => {
    config.antigravityClientId = (input.clientId ?? "").trim();
    const secret = (input.clientSecret ?? "").trim();
    if (secret) secrets.set(ANTIGRAVITY_CLIENT_SECRET, secret);
    persist();
    flash = { text: translate(config.lang ?? "en", "status.saved") };
    publish();
  });
  ipcMain.handle("pilot:startAntigravityLogin", async () => {
    const login = createGoogleLogin();
    let loop: Awaited<ReturnType<typeof listenForOAuthCode>>;
    try {
      loop = await listenForOAuthCode(ANTIGRAVITY.callbackPort, ANTIGRAVITY.callbackPath);
    } catch (error) {
      flash = { text: error instanceof Error ? error.message : "callback", warn: true };
      publish();
      return { ok: false };
    }
    const client = googleClient();
    if (!client.clientId || !client.clientSecret) {
      loop.close();
      flash = { text: translate(config.lang ?? "en", "oauth.antigravityMissing"), warn: true };
      publish();
      return { ok: false };
    }
    await shell.openExternal(buildAntigravityAuthorizeUrl(login, client));
    flash = { text: translate(config.lang ?? "en", "oauth.opened") };
    publish();
    try {
      const callback = await loop.done;
      if (callback.state && callback.state !== login.state) throw new Error("state");
      const request = googleExchangeRequest(login, callback.code, googleClient());
      const response = await nodeHttp(request);
      const exchanged = applyGoogleToken({ accessToken: "" }, response.status, response.body);
      if (!exchanged.tokens?.refreshToken && !exchanged.tokens?.accessToken) throw new Error("token");
      const tokens = exchanged.tokens;
      const id = randomUUID();
      secrets.set(id, googleTokensDocument({ ...tokens, accessToken: tokens.accessToken }));
      config.accounts.push({
        id,
        provider: "antigravity",
        label: tokens.email || "Antigravity",
        enabled: true,
        secretRef: id,
        authKind: "oauth",
        email: tokens.email,
        expiresAt: tokens.expiresAt,
        externalId: tokens.projectId,
      });
      config.providersEnabled.antigravity = true;
      flash = { text: translate(config.lang ?? "en", "oauth.saved") };
      persist();
      publish();
      return { ok: true };
    } catch {
      loop.close();
      flash = { text: translate(config.lang ?? "en", "oauth.badCode"), warn: true };
      publish();
      return { ok: false };
    }
  });
  ipcMain.handle("pilot:openMain", () => showMain());
}

function absorbDisk(): void {
  const raw = readCredentialsRaw(home());
  const captured = captureDisk(raw);
  if (!raw || !captured.diskBlob || !captured.diskLineage) return;
  const owner = config.accounts.find((account) => account.lineage && account.lineage === captured.diskLineage);
  if (!owner || owner.secretRef.startsWith("discovered:")) return;
  secrets.set(owner.secretRef, raw.endsWith("\n") ? raw : `${raw}\n`);
  owner.expiresAt = captured.diskBlob.expiresAt ?? owner.expiresAt;
  owner.email = captured.diskBlob.email ?? owner.email;
}

function addManagedClaude(blob: NonNullable<ReturnType<typeof blobFromSecret>>, label: string): void {
  const lineage = lineageOf(blob.refreshToken);
  const existing = lineage ? config.accounts.find((account) => account.lineage === lineage) : undefined;
  if (existing && !existing.secretRef.startsWith("discovered:")) {
    secrets.set(existing.secretRef, credentialsDocument(blob));
    existing.expiresAt = blob.expiresAt;
    existing.email = blob.email ?? existing.email;
    existing.enabled = true;
    return;
  }
  const id = randomUUID();
  secrets.set(id, credentialsDocument(blob));
  config.accounts.push({
    id,
    provider: "claude",
    label: label.slice(0, 80),
    enabled: true,
    secretRef: id,
    authKind: "oauth",
    email: blob.email,
    expiresAt: blob.expiresAt,
    lineage,
    externalId: blob.accountUuid,
  });
  config.providersEnabled.claude = true;
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
    const raw = readCredentialsRaw(home());
    const blob = raw ? blobFromSecret(raw) : null;
    config.accounts.push({
      id: randomUUID(),
      provider: "claude",
      label: blob?.email || "Claude Code",
      enabled: true,
      secretRef: DISCOVERED_CLAUDE,
      authKind: "oauth",
      email: blob?.email,
      expiresAt: blob?.expiresAt,
      lineage: lineageOf(blob?.refreshToken),
      externalId: blob?.accountUuid,
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
    runtimePath = join(dir, "runtime.json");
    config = loadConfig(configPath);
    if (!config.lang) config.lang = detectLang(app.getLocale());
    runtime.config = config;
    const stored = loadRuntime(runtimePath);
    runtime.activeByProvider = stored.activeByProvider;
    runtime.percentByAccount = stored.percentByAccount;
    for (const [id, quota] of Object.entries(stored.quotas)) quotaNotes.set(id, quota);
    activity.push(...stored.activity);
    history = stored.history ?? [];
    alertSeen = Object.fromEntries((stored.alertSeen ?? []).map((key) => [key, true as const]));
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
