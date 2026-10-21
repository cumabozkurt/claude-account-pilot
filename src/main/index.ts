import { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, shell, type NativeImage } from "electron";
import { execFile, execFileSync, spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { fetchReleaseBytes, installKind, looksLikeInstaller, macAppBundle, pickUpdateAsset, windowsSwapScript, type InstallKind } from "../core/auto-update.js";
import { applyAutomaticSetup } from "../core/bootstrap.js";
import { applyClaudeBaseUrl, claudeEnvSnippet, claudeSettingsNeedUpdate, restoreClaudeSettings } from "../core/claude-settings.js";
import { loadConfig, quarantineConfig, saveConfig } from "../core/config.js";
import { CLAUDE_KEYCHAIN_SERVICE, captureDisk, claudeCodeOwns, keychainPlan, readCredentialsRaw, restoreCredentialsFile, writeCredentialsFile } from "../core/credential-swap.js";
import { DISCOVERED_CLAUDE, DISCOVERED_CODEX } from "../core/credentials.js";
import { buildExport } from "../core/export-data.js";
import { appendSample, usageByDay, usageByModel, type QuotaSample } from "../core/history.js";
import { appendLog } from "../core/log-file.js";
import { newerRelease, type ReleaseNotice } from "../core/update-check.js";
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
  patchGoogleCredentialFile,
} from "../core/oauth-google.js";
import { OPENROUTER_KEY_URL, openRouterPercent } from "../core/openrouter.js";
import { listenForOAuthCode } from "../core/oauth-loopback.js";
import { discoveriesFromScan } from "../core/discover.js";
import { claudeDesktopDirs, findGoogleClient, opencodeKey, scanHome, secretFromDesktopFile } from "../core/scan.js";
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
import { singleFlight } from "../core/single-flight.js";
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
let logPath = "";
let updateNotice: ReleaseNotice | null = null;
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
let latestDiscoveries = discoveriesFromScan({ accounts: [], secretValues: {}, googleClient: null, notes: [] });
let expectProxyClose = false;
const refreshFlight = singleFlight();

function isolatedSession(): boolean {
  return process.env.PILOT_SMOKE === "1" || process.env.PILOT_SELFTEST === "1";
}

function selfTestSession(): boolean {
  return process.env.PILOT_SELFTEST === "1";
}
let healTimer: NodeJS.Timeout | null = null;
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
  const override = process.env.PILOT_HOME?.trim();
  if (override) return override;
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
  if (!logPath) return;
  const vars = Object.entries(event.vars)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  appendLog(logPath, `${event.at} ${event.key} ${vars}`.slice(0, 500));
}

async function checkForUpdate(): Promise<void> {
  try {
    const response = await fetch("https://api.github.com/repos/cumabozkurt/claude-account-pilot/releases/latest", {
      headers: { accept: "application/vnd.github+json", "user-agent": "claude-account-pilot" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { assets?: Array<{ name?: string; browser_download_url?: string }> };
    updateNotice = newerRelease(pkg.version, payload);
    updateAssets = Array.isArray(payload.assets) ? payload.assets : [];
  } catch {
    /* offline or rate limited: keep the current build */
  }
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
    autoManageClaude: config.autoManageClaude,
    autoUpdate: config.autoUpdate,
    routesManaged: config.routesManaged,
    syncedAccountId: config.syncedAccountId,
    antigravityClientId: config.antigravityClientId,
    antigravityClientReady: Boolean(config.antigravityClientId && secrets.get(ANTIGRAVITY_CLIENT_SECRET)),
    routes: config.routes,
    discoveries: latestDiscoveries,
    activity,
    activeLabel: active?.label ?? "",
    activePercent: activeQuota?.percent ?? (active ? runtime.percentByAccount[active.id] ?? null : null),
    message: flash,
    updateNotice,
    onboarded: config.onboarded,
    days: usageByDay(
      (ledger.rows ?? []).map((row) => ({
        day: row.at.slice(0, 10),
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsd: row.costUsd,
        requests: 1,
      })),
    ),
    models: usageByModel(
      (ledger.rows ?? []).map((row) => ({
        day: row.at.slice(0, 10),
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        costUsd: row.costUsd,
        requests: 1,
      })),
    ),
    requests: (ledger.rows ?? []).slice(-40).reverse(),
    history,
  };
}

function publish(): void {
  const state = publicState();
  for (const window of [mainWindow, widgetWindow, popoverWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("pilot:state", state);
  }
  refreshTray(state.lang, state.activePercent, state.activeLabel);
}

async function readStoredSecret(account: Account): Promise<string | null> {
  try {
    if (account.secretRef === DISCOVERED_CODEX) {
      return await refreshFlight(account.secretRef, async () => {
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
      });
    }
    if (account.secretRef === DISCOVERED_CLAUDE || account.secretRef === "discovered:claude-keychain") {
      return account.secretRef === DISCOVERED_CLAUDE ? readCredentialsRaw(home()) : readKeychainClaude();
    }
    if (account.secretRef === "discovered:antigravity" || account.secretRef === "discovered:gemini") {
      return await readGoogleCredentialFile(account);
    }
    if (account.secretRef.startsWith("discovered:opencode:")) {
      const id = account.secretRef.slice("discovered:opencode:".length);
      for (const path of [join(home(), ".local", "share", "opencode", "auth.json"), join(home(), ".config", "opencode", "auth.json")]) {
        try {
          const key = opencodeKey(readFileSync(path, "utf8"), id);
          if (key) return key;
        } catch {
          /* the other path may exist */
        }
      }
      return null;
    }
    if (account.secretRef.startsWith("discovered:desktop:")) {
      return readDesktopSecret(account.secretRef.slice("discovered:desktop:".length));
    }
    if (account.secretRef.startsWith("env:")) {
      const name = account.secretRef.slice(4);
      const live = process.env[name];
      if (live && live.trim().length >= 8 && live.trim() !== "pilot-local") return live.trim();
      return secrets.get(account.secretRef);
    }
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
    return refreshFlight(`google:${account.secretRef}`, async () => {
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
      return tokens.accessToken;
    });
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
  await refreshFlight("proxy-listen", async () => {
    if (proxy || !config.proxyEnabled) return;
    let started: RunningProxy | null = null;
    try {
      started = await startProxy(
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
      if (quitting || !config.proxyEnabled) {
        await started.close().catch(() => undefined);
        return;
      }
      proxy = started;
      if (proxy.port !== config.proxyPort) {
        config.proxyPort = proxy.port;
        persist();
      }
      const server = started.server;
      server.on("close", () => {
        if (proxy?.server === server) proxy = null;
        if (!expectProxyClose && !quitting && config.proxyEnabled) {
          setTimeout(() => void startListening(), 1000);
        }
      });
    } catch (error) {
      if (started) await started.close().catch(() => undefined);
      if (proxy === started) proxy = null;
      flash = { text: error instanceof Error ? error.message : "proxy", warn: true };
    }
  });
}

async function stopListening(): Promise<void> {
  const running = proxy;
  proxy = null;
  expectProxyClose = true;
  try {
    if (running) await running.close();
  } finally {
    expectProxyClose = false;
  }
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
        const polled = await refreshFlight(`claude:${account.secretRef}`, () => pollClaudeSubscription(stored, nodeHttp, owns, now));
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

let popoverWindow: BrowserWindow | null = null;

function togglePopover(): void {
  if (popoverWindow && !popoverWindow.isDestroyed() && popoverWindow.isVisible()) {
    popoverWindow.hide();
    return;
  }
  if (!popoverWindow || popoverWindow.isDestroyed()) {
    popoverWindow = new BrowserWindow({
      width: 320,
      height: 420,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#fffdf8",
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    void popoverWindow.loadFile(rendererHtml, { query: { popover: "1" } });
    popoverWindow.on("blur", () => popoverWindow?.hide());
  }
  popoverWindow.show();
  popoverWindow.focus();
}

function showMain(): void {
  if (process.platform === "darwin" && app.dock) app.dock.show();
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow(true);
  mainWindow?.show();
  mainWindow?.focus();
}

async function runSelfTest(): Promise<number> {
  const reportPath = process.env.PILOT_REPORT;
  const baseUrl = `http://127.0.0.1:${proxy?.port ?? config.proxyPort}`;
  const homeDir = home();
  let healthOk = false;
  let detail = "";
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(4000) });
    const body = (await response.json()) as { ok?: boolean; proxy?: boolean };
    healthOk = response.ok && body.ok === true && body.proxy === true;
  } catch (error) {
    detail = error instanceof Error ? error.message : "health";
  }
  let settingsWritten = false;
  try {
    settingsWritten = !claudeSettingsNeedUpdate(homeDir, baseUrl);
  } catch (error) {
    detail = error instanceof Error ? error.message : detail;
  }
  const configExists = Boolean(configPath) && existsSync(configPath);
  let updateName: string | null = null;
  let evilRejected = true;
  let detectedKind: InstallKind | null = null;
  const fakePath = process.env.PILOT_FAKE_RELEASE;
  if (fakePath) {
    try {
      const payload = JSON.parse(readFileSync(fakePath, "utf8")) as {
        tag_name?: string;
        assets?: Array<{ name?: string; browser_download_url?: string }>;
      };
      const version = String(payload.tag_name ?? "").replace(/^v/, "");
      detectedKind = installKind({
        platform: process.platform,
        arch: process.arch,
        packaged: app.isPackaged,
        appImage: process.env.APPIMAGE,
        portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
      });
      const assets = payload.assets ?? [];
      const picked = pickUpdateAsset(version, detectedKind, process.arch, assets);
      updateName = picked?.name ?? null;
      if (picked) {
        evilRejected =
          pickUpdateAsset(version, detectedKind, process.arch, [
            { name: picked.name, browser_download_url: "https://evil.example/payload" },
          ]) === null;
      }
    } catch (error) {
      detail = error instanceof Error ? error.message : detail;
      evilRejected = false;
    }
  }
  let restored = false;
  try {
    restored = restoreClaudeSettings(homeDir);
  } catch {
    restored = false;
  }
  const forced = process.env.PILOT_LANG;
  const langOk = forced === "tr" || forced === "en" ? config.lang === forced : true;
  const requireKind = process.env.PILOT_REQUIRE_INSTALL_KIND === "1";
  const updateOk = requireKind || detectedKind ? Boolean(detectedKind && updateName && evilRejected) : evilRejected;
  const ok = healthOk && settingsWritten && configExists && Boolean(tray) && restored && updateOk && langOk;
  const report = {
    ok,
    healthOk,
    detail,
    settingsWritten,
    configExists,
    tray: Boolean(tray),
    restored,
    installKind: detectedKind,
    updateName,
    evilRejected,
    lang: config.lang,
    port: proxy?.port ?? null,
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    home: homeDir,
  };
  if (reportPath) writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return ok ? 0 : 1;
}

function createMainWindow(visible = true): void {
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
    if (visible) mainWindow?.show();
    if (!isolatedSession()) return;
    const window = mainWindow;
    setTimeout(() => {
      void (async () => {
        const finish = async () => {
          if (selfTestSession()) {
            const code = await runSelfTest();
            app.exit(code);
            return;
          }
          app.exit(0);
        };
        if (!window || window.isDestroyed()) {
          await finish();
          return;
        }
        const { mkdirSync, writeFileSync } = await import("node:fs");
        const save = async (path: string) => {
          const image = await window.webContents.capturePage();
          writeFileSync(path, image.toPNG());
        };
        const shot = process.env.PILOT_SHOT;
        if (shot) {
          mkdirSync(join(shot, ".."), { recursive: true });
          await save(shot);
        }
        const frames = process.env.PILOT_FRAMES;
        if (frames) {
          mkdirSync(frames, { recursive: true });
          const panels = ["dashboard", "accounts", "routes", "log", "settings"] as const;
          for (let index = 0; index < panels.length; index += 1) {
            const panel = panels[index];
            const scroll =
              panel === "accounts"
                ? "document.querySelector('#accounts')?.scrollIntoView({block:'start'});"
                : "window.scrollTo(0,0);";
            await window.webContents.executeJavaScript(
              `document.querySelector('.nav button[data-panel="${panel}"]')?.click(); ${scroll}`,
            );
            await new Promise((resolve) => setTimeout(resolve, 450));
            await save(join(frames, `frame-${String(index).padStart(2, "0")}.png`));
          }
        }
        await finish();
      })();
    }, 900);
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
    applyLoginItem();
    persist();
    publish();
  });
  ipcMain.handle("pilot:setAutoManage", (_event, enabled: boolean) => {
    config.autoManageClaude = Boolean(enabled);
    if (config.autoManageClaude) syncManagedSettings();
    persist();
    publish();
  });
  ipcMain.handle("pilot:setAutoUpdate", (_event, enabled: boolean) => {
    config.autoUpdate = Boolean(enabled);
    persist();
    publish();
  });
  ipcMain.handle("pilot:setRoutesManaged", (_event, enabled: boolean) => {
    config.routesManaged = Boolean(enabled);
    if (config.routesManaged) applyAutomaticSetup(config, []);
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
    config.onboarded = true;
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
    if (!account.secretRef.startsWith("discovered:") || account.secretRef.startsWith("discovered:desktop:")) secrets.delete(account.secretRef);
    if (account.secretRef.startsWith("env:")) secrets.delete(account.secretRef);
    if (account.secretRef.startsWith("discovered:") || account.secretRef.startsWith("env:")) {
      if (!config.dismissedRefs.includes(account.secretRef)) config.dismissedRefs.push(account.secretRef);
    }
    config.accounts = config.accounts.filter((item) => item.id !== id);
    delete runtime.percentByAccount[id];
    quotaNotes.delete(id);
    persist();
    publish();
  });
  ipcMain.handle("pilot:toggleRoute", (_event, id: string, enabled: boolean) => {
    config.routesManaged = false;
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
      config.routesManaged = false;
      persist();
      publish();
    },
  );
  ipcMain.handle("pilot:removeRoute", (_event, id: string) => {
    config.routesManaged = false;
    config.routes = config.routes.filter((route) => route.id !== id);
    persist();
    publish();
  });
  ipcMain.handle("pilot:moveRoute", (_event, id: string, direction: number) => {
    config.routesManaged = false;
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
    config.autoManageClaude = true;
    const baseUrl = `http://127.0.0.1:${proxy?.port ?? config.proxyPort}`;
    applyClaudeBaseUrl(home(), baseUrl);
    persist();
    flash = { text: translate(config.lang ?? "en", "proxy.applied") };
    publish();
  });
  ipcMain.handle("pilot:restoreClaude", () => {
    config.autoManageClaude = false;
    const ok = restoreClaudeSettings(home());
    persist();
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
      config.onboarded = true;
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
  ipcMain.handle("pilot:export", async () => {
    const result = await dialog.showSaveDialog({
      defaultPath: "claude-account-pilot-export.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    writeFileSync(
      result.filePath,
      buildExport({ version: pkg.version, config, ledger, history, activity }),
      { mode: 0o600 },
    );
    flash = { text: translate(config.lang ?? "en", "export.done") };
    publish();
    return { ok: true };
  });
  ipcMain.handle("pilot:checkUpdate", async () => {
    await maybeInstallUpdate();
    if (!updateNotice) await checkForUpdate();
    flash = {
      text: updateNotice
        ? translate(config.lang ?? "en", "update.available", { version: updateNotice.version })
        : translate(config.lang ?? "en", "update.none"),
      warn: false,
    };
    publish();
    return updateNotice;
  });
  ipcMain.handle("pilot:dismissWizard", () => {
    config.onboarded = true;
    persist();
    publish();
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
  config.onboarded = true;
}

function importDiscovered(provider: ProviderId): void {
  const scan = scanHome(home(), process.platform, process.env, readKeychainClaude());
  latestDiscoveries = discoveriesFromScan(scan);
  const mine = scan.accounts.filter((account) => account.provider === provider);
  config.dismissedRefs = config.dismissedRefs.filter((ref) => !mine.some((account) => account.secretRef === ref));
  for (const account of mine) {
    const value = scan.secretValues[account.secretRef];
    if (value) secrets.set(account.secretRef, value);
  }
  applyAutomaticSetup(config, mine);
}

/** Screenshot runs set the language here. Electron's locale ignores LANG in this environment. */
function applySmokeOverrides(): void {
  const forced = process.env.PILOT_LANG;
  if (forced === "en" || forced === "tr") config.lang = forced;
  if (process.env.PILOT_DEMO !== "1") return;
  config.onboarded = true;
  config.widgetEnabled = false;
  config.switchThreshold = 98;
  config.providersEnabled = {
    claude: true,
    "opencode-go": true,
    deepseek: true,
    codex: true,
    cursor: false,
    antigravity: true,
    openrouter: true,
    gemini: true,
  };
  config.accounts = [
    {
      id: "demo-pro",
      provider: "claude",
      label: "Claude Pro",
      enabled: true,
      secretRef: "demo:pro",
      authKind: "oauth",
      email: "ada@example.com",
    },
    {
      id: "demo-max",
      provider: "claude",
      label: "Claude Max",
      enabled: true,
      secretRef: "demo:max",
      authKind: "oauth",
      email: "max@example.com",
    },
    { id: "demo-ds", provider: "deepseek", label: "DeepSeek", enabled: true, secretRef: "demo:ds", authKind: "api-key" },
    { id: "demo-or", provider: "openrouter", label: "OpenRouter", enabled: true, secretRef: "demo:or", authKind: "api-key" },
  ];
  config.syncedAccountId = "demo-pro";
  config.routes = [
    {
      id: "haiku-opencode-deepseek",
      enabled: true,
      match: "*haiku*",
      provider: "opencode-go",
      targetModel: "deepseek-v4-flash",
      fallbacks: [{ provider: "deepseek", targetModel: "deepseek-chat" }],
    },
    {
      id: "opus-openrouter",
      enabled: true,
      match: "*opus*",
      provider: "openrouter",
      targetModel: "anthropic/claude-opus-4",
      fallbacks: [{ provider: "claude", targetModel: "claude-opus-4" }],
    },
    {
      id: "haiku-deepseek-direct",
      enabled: false,
      match: "*haiku*",
      provider: "deepseek",
      targetModel: "deepseek-chat",
    },
  ];
  runtime.activeByProvider = { claude: "demo-pro" };
  const resetsAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  quotaNotes.clear();
  quotaNotes.set("demo-pro", {
    windows: [
      { label: "5h", percent: 41, resetsAt },
      { label: "7d", percent: 62, resetsAt },
    ],
    percent: 62,
    source: "provider",
  });
  quotaNotes.set("demo-max", {
    windows: [
      { label: "5h", percent: 97, resetsAt },
      { label: "7d", percent: 44, resetsAt },
    ],
    percent: 97,
    source: "provider",
  });
  quotaNotes.set("demo-or", {
    windows: [{ label: "balance", percent: 18, name: "credits" }],
    percent: 18,
    source: "provider",
    note: "credits",
  });
  runtime.percentByAccount = { "demo-pro": 62, "demo-max": 97, "demo-or": 18 };
  const now = Date.now();
  history = [];
  for (let index = 0; index < 12; index += 1) {
    const at = new Date(now - (11 - index) * 60 * 60 * 1000).toISOString();
    history.push({ at, accountId: "demo-pro", percent: 28 + index * 3, windows: [] });
    history.push({ at, accountId: "demo-max", percent: 74 + Math.min(index, 23), windows: [] });
  }
  ledger = emptyLedger();
  const samples: Array<[string, string, number, number, number]> = [
    ["demo-pro", "claude-sonnet-4-5", 18000, 4200, 0],
    ["demo-pro", "claude-haiku-4-5", 9000, 1600, 0],
    ["demo-max", "claude-opus-4", 6000, 2100, 1],
    ["demo-ds", "deepseek-chat", 24000, 8000, 1],
    ["demo-or", "anthropic/claude-opus-4", 3000, 900, 2],
  ];
  for (const [accountId, model, inputTokens, outputTokens, days] of samples) {
    recordUsage(ledger, accountId, model, { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const row = ledger.rows?.[ledger.rows.length - 1];
    if (row) {
      const at = new Date();
      at.setUTCHours(12, 0, 0, 0);
      at.setUTCDate(at.getUTCDate() - days);
      row.at = at.toISOString();
    }
  }
  activity.splice(0, activity.length);
  activity.push(
    {
      at: new Date(now - 20 * 60 * 1000).toISOString(),
      key: "log.switch",
      vars: { provider: "claude", from: "Claude Max", to: "Claude Pro", reason: "97%" },
    },
    {
      at: new Date(now - 50 * 60 * 1000).toISOString(),
      key: "log.request",
      vars: { requested: "claude-haiku-4-5", target: "deepseek-v4-flash", provider: "opencode-go", account: "DeepSeek" },
    },
    {
      at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
      key: "log.proxy",
      vars: { state: "listening", address: "127.0.0.1:15721" },
    },
  );
}

function readKeychainClaude(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    return execFileSync("security", ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
      timeout: 5000,
    });
  } catch {
    return null;
  }
}

function readDesktopSecret(name: string): string | null {
  if (!/^host-creds-[A-Za-z0-9._-]+\.json$/.test(name)) return null;
  for (const dir of claudeDesktopDirs(home(), process.platform)) {
    try {
      const secret = secretFromDesktopFile(readFileSync(join(dir, name), "utf8"));
      if (secret) return secret;
    } catch {
      /* another directory may hold it */
    }
  }
  return null;
}

async function readGoogleCredentialFile(account: Account): Promise<string | null> {
  return refreshFlight(account.secretRef, async () => readGoogleCredentialFileBody(account));
}

async function readGoogleCredentialFileBody(account: Account): Promise<string | null> {
  const path =
    account.secretRef === "discovered:antigravity"
      ? join(home(), ".gemini", "antigravity-cli", "antigravity-oauth-token")
      : join(home(), ".gemini", "oauth_creds.json");
  const raw = readFileSync(path, "utf8");
  let tokens = parseGoogleTokens(JSON.parse(raw) as unknown);
  if (!tokens) return null;
  let own: { clientId: string; clientSecret: string } | null = null;
  try {
    own = findGoogleClient(JSON.parse(raw) as unknown);
  } catch {
    own = null;
  }
  const client = own ?? (account.secretRef === "discovered:antigravity" ? googleClient() : null);
  if (tokens.refreshToken && googleNeedsRefresh(tokens) && client?.clientId && client.clientSecret) {
    const request = googleRefreshRequest(tokens, client);
    if (request) {
      const response = await nodeHttp(request);
      const refreshed = applyGoogleToken(tokens, response.status, response.body);
      if (refreshed.tokens) {
        tokens = refreshed.tokens;
        writeFileSync(path, patchGoogleCredentialFile(raw, tokens), { mode: 0o600 });
        account.expiresAt = tokens.expiresAt;
        pushActivity({ at: new Date().toISOString(), key: "log.refreshed", vars: { label: account.label } });
      }
    }
  }
  if (tokens.projectId) account.externalId = tokens.projectId;
  return tokens.accessToken;
}

function rememberScanSecrets(values: Record<string, string>): void {
  for (const [ref, value] of Object.entries(values)) {
    if (value.trim().length >= 8) secrets.set(ref, value.trim());
  }
}

/** Import logins that are already on this computer and keep Claude Code pointed at the proxy. */
function adoptMachine(): void {
  const scan = scanHome(home(), process.platform, process.env, readKeychainClaude());
  latestDiscoveries = discoveriesFromScan(scan);
  rememberScanSecrets(scan.secretValues);
  if (scan.googleClient) {
    config.antigravityClientId = scan.googleClient.clientId;
    secrets.set(ANTIGRAVITY_CLIENT_SECRET, scan.googleClient.clientSecret);
  }
  const result = applyAutomaticSetup(config, scan.accounts);
  if (result.added > 0) {
    pushActivity({ at: new Date().toISOString(), key: "log.imported", vars: { count: result.added } });
  }
  for (const note of scan.notes) {
    const key = `note:${note}`;
    if (alertSeen[key]) continue;
    alertSeen[key] = true;
    pushActivity({ at: new Date().toISOString(), key: `note.${note}`, vars: {} });
  }
}

function applyLoginItem(): void {
  try {
    app.setLoginItemSettings({ openAtLogin: config.launchAtLogin, openAsHidden: true });
  } catch {
    /* a session without an autostart directory still runs the proxy */
  }
}

function syncManagedSettings(): void {
  if (!config.autoManageClaude || !proxy) return;
  const baseUrl = `http://127.0.0.1:${proxy.port}`;
  if (!claudeSettingsNeedUpdate(home(), baseUrl)) return;
  applyClaudeBaseUrl(home(), baseUrl);
  pushActivity({ at: new Date().toISOString(), key: "log.managed", vars: { address: baseUrl } });
}

async function maybeInstallUpdate(): Promise<void> {
  if (isolatedSession() || !config.autoUpdate || !app.isPackaged) return;
  await checkForUpdate();
  if (!updateNotice) return;
  const kind = installKind({
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    appImage: process.env.APPIMAGE,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  });
  const asset = pickUpdateAsset(updateNotice.version, kind, process.arch, updateAssets);
  if (!asset) return;
  try {
    const bytes = await fetchReleaseBytes(asset.url, (input, init) => fetch(input, init), AbortSignal.timeout(120_000));
    if (!bytes || !looksLikeInstaller(asset.kind, bytes)) return;
    const dir = join(app.getPath("temp"), "claude-account-pilot-update");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, asset.name);
    writeFileSync(file, bytes);
    if (asset.kind === "appimage" && process.env.APPIMAGE) {
      copyFileSync(file, process.env.APPIMAGE);
      chmodSync(process.env.APPIMAGE, 0o755);
      relaunchUpdated(updateNotice.version);
      return;
    }
    if (asset.kind === "mac-zip") {
      const appPath = macAppBundle(process.execPath);
      if (!appPath) return;
      execFileSync("unzip", ["-qo", file, "-d", dir], { timeout: 120_000 });
      const unpacked = join(dir, "Claude Account Pilot.app");
      execFileSync("rm", ["-rf", appPath], { timeout: 60_000 });
      execFileSync("mv", [unpacked, appPath], { timeout: 60_000 });
      relaunchUpdated(updateNotice.version);
      return;
    }
    if (asset.kind === "win-setup") {
      spawn(file, ["/S"], { detached: true, stdio: "ignore" }).unref();
      relaunchUpdated(updateNotice.version);
      return;
    }
    if (asset.kind === "win-portable") {
      const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
      const script = join(dir, "swap.cmd");
      writeFileSync(script, windowsSwapScript(file, target));
      spawn("cmd.exe", ["/c", script], { detached: true, stdio: "ignore" }).unref();
      relaunchUpdated(updateNotice.version);
    }
  } catch {
    /* keep the download link; a failed install must not take the proxy down */
  }
}

function relaunchUpdated(version: string): void {
  pushActivity({ at: new Date().toISOString(), key: "log.updated", vars: { version } });
  persistRuntime();
  app.relaunch();
  app.exit(0);
}

let updateAssets: Array<{ name?: string; browser_download_url?: string }> = [];

if (isolatedSession()) {
  const tag = process.env.PILOT_LANG === "tr" ? "tr" : "en";
  app.setPath("userData", process.env.PILOT_USER_DATA?.trim() || join(tmpdir(), `pilot-smoke-${tag}`));
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
    logPath = join(dir, "pilot.log");
    quarantineConfig(configPath);
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
    applySmokeOverrides();
    if (!isolatedSession() || selfTestSession()) adoptMachine();
    persist();
    icon = nativeImage.createFromPath(join(here, "../icon.png"));
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
    else icon = icon.resize({ width: 18, height: 18 });
    try {
      tray = new Tray(icon);
      tray.on("click", () => togglePopover());
    } catch {
      tray = null;
    }
    registerIpc();
    if (!isolatedSession()) applyLoginItem();
    if (selfTestSession()) config.proxyPort = 0;
    await startListening();
    if (!isolatedSession() || selfTestSession()) syncManagedSettings();
    const visible = isolatedSession() || config.accounts.length === 0;
    if (process.platform === "darwin" && !visible && app.dock) app.dock.hide();
    createMainWindow(visible);
    syncWidget();
    publish();
    void probeQuotas();
    void maybeInstallUpdate().then(() => publish());
    probeTimer = setInterval(() => void probeQuotas(), 60_000);
    probeTimer.unref();
    healTimer = setInterval(() => {
      if (quitting) return;
      if (config.proxyEnabled && !proxy) void startListening();
      if (!isolatedSession() || selfTestSession()) syncManagedSettings();
    }, 30_000);
    healTimer.unref();
  });
}

app.on("before-quit", () => {
  quitting = true;
  if (probeTimer) clearInterval(probeTimer);
  if (healTimer) clearInterval(healTimer);
});

app.on("will-quit", () => {
  void stopListening();
});

app.on("window-all-closed", () => {
  /* stay in the tray */
});
