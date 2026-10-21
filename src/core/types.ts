export type Lang = "en" | "tr";

export type ProviderId =
  | "claude"
  | "opencode-go"
  | "deepseek"
  | "codex"
  | "cursor"
  | "antigravity"
  | "openrouter"
  | "gemini";

export type AuthKind = "api-key" | "oauth" | "discovered";

export type QuotaSource = "provider" | "headers" | "local-estimate" | "none";

export interface Account {
  id: string;
  provider: ProviderId;
  label: string;
  enabled: boolean;
  /** Opaque handle. Never a raw secret. */
  secretRef: string;
  authKind: AuthKind;
  /** Optional upstream base URL override, without a trailing path. */
  baseUrl?: string;
  /** Non-secret id forwarded to Codex (ChatGPT-Account-Id). */
  externalId?: string;
  /** Account email from the profile endpoint. Not a secret. */
  email?: string;
  /** Access-token expiry in epoch milliseconds, when known. */
  expiresAt?: number;
  /** sha256 of the refresh token. Used to avoid rotating the login Claude Code owns. */
  lineage?: string;
}

export interface RouteFallback {
  provider: ProviderId;
  targetModel: string;
}

export interface ModelRoute {
  id: string;
  enabled: boolean;
  /** Glob matched against the model Claude requested. Example: `*haiku*`. */
  match: string;
  provider: ProviderId;
  targetModel: string;
  /** Tried in order when the primary provider has no usable account or is unsupported. */
  fallbacks?: RouteFallback[];
}

export interface QuotaWindow {
  label: "5h" | "7d" | "requests" | "tokens" | "balance" | "model";
  percent: number;
  resetsAt?: string;
  /** Per-model weekly window name, when the provider sent one. */
  name?: string;
}

export interface AccountQuota {
  accountId: string;
  windows: QuotaWindow[];
  /** Highest window percent. This is what the 98% switch watches. */
  percent: number | null;
  source: QuotaSource;
  note?: string;
  updatedAt: string;
}

export interface UsageLedgerEntry {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  requests: number;
}

export interface AppConfig {
  version: 1;
  /** Null until the first launch picks a language from the OS. */
  lang: Lang | null;
  proxyPort: number;
  proxyEnabled: boolean;
  /** Switch when the active account's quota percent reaches this value. */
  switchThreshold: number;
  widgetEnabled: boolean;
  launchAtLogin: boolean;
  /** Desktop notifications when a window crosses the threshold or the pool is full. */
  notify: boolean;
  /** Account written into ~/.claude/.credentials.json for the official clients. */
  syncedAccountId: string | null;
  /** Antigravity OAuth client id. The matching secret lives in the keychain, not here. */
  antigravityClientId: string;
  /** True after the first-run wizard is dismissed or an account is added. */
  onboarded: boolean;
  providersEnabled: Record<ProviderId, boolean>;
  accounts: Account[];
  routes: ModelRoute[];
}

export interface ActivityEvent {
  at: string;
  key: string;
  vars: Record<string, string | number>;
}

export const PROVIDER_IDS: ProviderId[] = [
  "claude",
  "opencode-go",
  "deepseek",
  "codex",
  "cursor",
  "antigravity",
  "openrouter",
  "gemini",
];

export const DEFAULT_PORT = 15721;
export const DEFAULT_THRESHOLD = 98;

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    lang: null,
    proxyPort: DEFAULT_PORT,
    proxyEnabled: true,
    switchThreshold: DEFAULT_THRESHOLD,
    widgetEnabled: false,
    launchAtLogin: false,
    notify: true,
    syncedAccountId: null,
    antigravityClientId: "",
    onboarded: false,
    providersEnabled: {
      claude: true,
      "opencode-go": false,
      deepseek: false,
      codex: false,
      cursor: false,
      antigravity: false,
      openrouter: false,
      gemini: false,
    },
    accounts: [],
    routes: [
      {
        id: "haiku-opencode-deepseek",
        enabled: false,
        match: "*haiku*",
        provider: "opencode-go",
        targetModel: "deepseek-v4-flash",
      },
      {
        id: "haiku-deepseek-direct",
        enabled: false,
        match: "*haiku*",
        provider: "deepseek",
        targetModel: "deepseek-chat",
      },
    ],
  };
}
