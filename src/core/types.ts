export type Lang = "en" | "tr";

export type ProviderId =
  | "claude"
  | "opencode-go"
  | "deepseek"
  | "codex"
  | "cursor"
  | "antigravity";

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
}

export interface ModelRoute {
  id: string;
  enabled: boolean;
  /** Glob matched against the model Claude requested. Example: `*haiku*`. */
  match: string;
  provider: ProviderId;
  targetModel: string;
}

export interface QuotaWindow {
  label: "5h" | "7d" | "requests" | "tokens" | "balance";
  percent: number;
  resetsAt?: string;
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
    providersEnabled: {
      claude: true,
      "opencode-go": false,
      deepseek: false,
      codex: false,
      cursor: false,
      antigravity: false,
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
