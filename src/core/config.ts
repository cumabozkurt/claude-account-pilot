import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { defaultConfig, PROVIDER_IDS, type AppConfig, type ProviderId } from "./types.js";

function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as string[]).includes(value);
}

/** Load config from disk. Missing or broken files fall back to defaults. Secrets are never in this file. */
export function loadConfig(path: string): AppConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return defaultConfig();
  }
  if (!parsed || typeof parsed !== "object") return defaultConfig();
  const raw = parsed as Partial<AppConfig>;
  const base = defaultConfig();
  const providers = { ...base.providersEnabled };
  if (raw.providersEnabled && typeof raw.providersEnabled === "object") {
    for (const id of PROVIDER_IDS) {
      const value = (raw.providersEnabled as Record<string, unknown>)[id];
      if (typeof value === "boolean") providers[id] = value;
    }
  }
  const threshold = Number(raw.switchThreshold);
  const port = Number(raw.proxyPort);
  return {
    version: 1,
    lang: raw.lang === "tr" || raw.lang === "en" ? raw.lang : null,
    proxyPort: Number.isFinite(port) && port > 0 && port < 65536 ? port : base.proxyPort,
    proxyEnabled: raw.proxyEnabled !== false,
    switchThreshold: Number.isFinite(threshold) ? Math.min(99, Math.max(50, threshold)) : base.switchThreshold,
    widgetEnabled: Boolean(raw.widgetEnabled),
    launchAtLogin: typeof raw.launchAtLogin === "boolean" ? raw.launchAtLogin : base.launchAtLogin,
    notify: raw.notify !== false,
    syncedAccountId: typeof raw.syncedAccountId === "string" ? raw.syncedAccountId : null,
    antigravityClientId: typeof raw.antigravityClientId === "string" ? raw.antigravityClientId : "",
    onboarded: raw.onboarded === true || (Array.isArray(raw.accounts) && raw.accounts.length > 0),
    autoManageClaude: raw.autoManageClaude !== false,
    autoUpdate: raw.autoUpdate !== false,
    routesManaged: typeof raw.routesManaged === "boolean" ? raw.routesManaged : false,
    setupRevision: Number.isFinite(Number(raw.setupRevision)) ? Number(raw.setupRevision) : 0,
    dismissedRefs: Array.isArray(raw.dismissedRefs) ? raw.dismissedRefs.filter((item): item is string => typeof item === "string") : [],
    providersEnabled: providers,
    accounts: Array.isArray(raw.accounts)
      ? raw.accounts.filter((account) => account && typeof account === "object" && isProvider(account.provider) && typeof account.id === "string")
      : [],
    routes: Array.isArray(raw.routes)
      ? raw.routes.filter((route) => route && typeof route === "object" && isProvider(route.provider) && typeof route.id === "string")
      : base.routes,
  };
}

export function saveConfig(path: string, config: AppConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  const safe = JSON.parse(JSON.stringify(config)) as AppConfig;
  writeFileSync(path, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
}
