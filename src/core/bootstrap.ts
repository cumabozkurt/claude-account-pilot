import type { Account, AppConfig, ModelRoute, ProviderId } from "./types.js";
import { defaultConfig } from "./types.js";
import type { ImportedAccount } from "./scan.js";

const HAIKU_CHAIN: Array<{ provider: ProviderId; model: string }> = [
  { provider: "opencode-go", model: "deepseek-v4-flash" },
  { provider: "deepseek", model: "deepseek-chat" },
  { provider: "gemini", model: "gemini-2.5-flash" },
  { provider: "openrouter", model: "deepseek/deepseek-chat" },
  { provider: "antigravity", model: "gemini-2.5-flash" },
  { provider: "codex", model: "gpt-5.3-codex" },
];

function untouchedRoutes(config: AppConfig): boolean {
  const defaults = defaultConfig().routes;
  if (config.routes.length !== defaults.length) return false;
  return config.routes.every((route, index) => route.id === defaults[index]?.id && route.enabled === false);
}

/**
 * Routes for whatever can actually take traffic. Haiku leaves Claude when a
 * cheaper provider is present, and falls back along the providers that were
 * found. Other models stay on Claude. With no Claude account, everything
 * follows the same chain. Cursor is never included.
 */
export function buildAutoRoutes(providers: Iterable<ProviderId>): ModelRoute[] {
  const have = new Set(providers);
  const chain = HAIKU_CHAIN.filter((hop) => have.has(hop.provider));
  if (chain.length === 0) return [];
  const [first, ...rest] = chain;
  if (!first) return [];
  const fallbacks = rest.map((hop) => ({ provider: hop.provider, targetModel: hop.model }));
  const routes: ModelRoute[] = [];
  if (have.has("claude")) {
    routes.push({
      id: "auto-haiku",
      enabled: true,
      match: "*haiku*",
      provider: first.provider,
      targetModel: first.model,
      fallbacks: [...fallbacks, { provider: "claude", targetModel: "claude-haiku-4-5" }],
    });
    return routes;
  }
  routes.push({
    id: "auto-all",
    enabled: true,
    match: "*",
    provider: first.provider,
    targetModel: first.model,
    fallbacks,
  });
  return routes;
}

function accountFromImport(found: ImportedAccount): Account {
  return {
    id: found.secretRef,
    provider: found.provider,
    label: found.label,
    enabled: true,
    secretRef: found.secretRef,
    authKind: found.authKind,
    baseUrl: found.baseUrl,
    externalId: found.externalId,
    email: found.email,
    expiresAt: found.expiresAt,
    lineage: found.lineage,
  };
}

export interface SetupResult {
  added: number;
  /** True when this call turned the automatic defaults on for an older config. */
  upgraded: boolean;
}

/**
 * Import logins that are not already listed and were not dismissed.
 * An older config is switched to launch-at-login and automatic routes once.
 * A login the user turned off stays off. A provider the user turned off stays off
 * unless this call is adding that provider's first account.
 */
export function applyAutomaticSetup(config: AppConfig, found: ImportedAccount[]): SetupResult {
  let upgraded = false;
  if (config.setupRevision < 1) {
    config.launchAtLogin = true;
    config.autoManageClaude = true;
    config.autoUpdate = true;
    config.routesManaged = untouchedRoutes(config);
    config.setupRevision = 1;
    upgraded = true;
  }
  const dismissed = new Set(config.dismissedRefs);
  let added = 0;
  for (const item of found) {
    if (dismissed.has(item.secretRef)) continue;
    const existing = config.accounts.find((account) => account.secretRef === item.secretRef || (item.lineage && account.lineage === item.lineage));
    if (existing) {
      existing.email = item.email ?? existing.email;
      existing.expiresAt = item.expiresAt ?? existing.expiresAt;
      existing.externalId = item.externalId ?? existing.externalId;
      existing.baseUrl = item.baseUrl ?? existing.baseUrl;
      continue;
    }
    const firstOfProvider = !config.accounts.some((account) => account.provider === item.provider);
    config.accounts.push(accountFromImport(item));
    if (firstOfProvider) config.providersEnabled[item.provider] = true;
    added += 1;
  }
  if (config.accounts.length > 0) config.onboarded = true;
  if (config.routesManaged) {
    const ready = new Set<ProviderId>();
    for (const account of config.accounts) {
      if (account.enabled && config.providersEnabled[account.provider]) ready.add(account.provider);
    }
    config.routes = buildAutoRoutes(ready);
  }
  return { added, upgraded };
}
