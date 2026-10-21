import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { lineageOf, parseClaudeCredentials } from "./oauth-claude.js";
import { parseGoogleTokens } from "./oauth-google.js";
import { readCodexAuth } from "./credentials.js";
import { LOCAL_CLIENT_KEY } from "./claude-settings.js";
import type { AuthKind, ProviderId } from "./types.js";

export interface ImportedAccount {
  provider: ProviderId;
  label: string;
  secretRef: string;
  authKind: AuthKind;
  email?: string;
  expiresAt?: number;
  lineage?: string;
  externalId?: string;
  baseUrl?: string;
  /** Shown in the UI. Never a token or key. */
  detail: string;
}

export interface GoogleClientFound {
  clientId: string;
  clientSecret: string;
}

export interface ScanResult {
  accounts: ImportedAccount[];
  /** Values that have no durable file. The caller stores them in the keychain. */
  secretValues: Record<string, string>;
  googleClient: GoogleClientFound | null;
  /** Stable codes. The UI translates them. */
  notes: Array<"desktop-encrypted" | "cursor-unroutable" | "antigravity-no-client">;
}

export interface ScanInput {
  home: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** path -> file text. Only files the scanner is allowed to open. */
  files: Record<string, string>;
  /** Directories that exist, mapped to their entry names. */
  dirs: Record<string, string[]>;
  keychainClaude?: string | null;
  now?: number;
}

const ENV_KEYS: Array<{ name: string; provider: ProviderId; authKind: AuthKind; baseUrl?: string; label: string }> = [
  { name: "ANTHROPIC_API_KEY", provider: "claude", authKind: "api-key", label: "Anthropic API key" },
  { name: "ANTHROPIC_AUTH_TOKEN", provider: "claude", authKind: "oauth", label: "Anthropic token" },
  { name: "OPENAI_API_KEY", provider: "codex", authKind: "api-key", baseUrl: "https://api.openai.com/v1", label: "OpenAI API key" },
  { name: "DEEPSEEK_API_KEY", provider: "deepseek", authKind: "api-key", label: "DeepSeek API key" },
  { name: "OPENROUTER_API_KEY", provider: "openrouter", authKind: "api-key", label: "OpenRouter API key" },
  { name: "GEMINI_API_KEY", provider: "gemini", authKind: "api-key", label: "Gemini API key" },
  { name: "GOOGLE_API_KEY", provider: "gemini", authKind: "api-key", label: "Google API key" },
  { name: "GOOGLE_GENERATIVE_AI_API_KEY", provider: "gemini", authKind: "api-key", label: "Gemini API key" },
  { name: "OPENCODE_API_KEY", provider: "opencode-go", authKind: "api-key", label: "OpenCode API key" },
];

const OPENCODE_PROVIDERS: Record<string, { provider: ProviderId; baseUrl?: string; label: string }> = {
  opencode: { provider: "opencode-go", label: "OpenCode" },
  "opencode-go": { provider: "opencode-go", label: "OpenCode Go" },
  deepseek: { provider: "deepseek", label: "DeepSeek" },
  openrouter: { provider: "openrouter", label: "OpenRouter" },
  google: { provider: "gemini", label: "Gemini" },
  gemini: { provider: "gemini", label: "Gemini" },
  anthropic: { provider: "claude", label: "Anthropic" },
  openai: { provider: "codex", baseUrl: "https://api.openai.com/v1", label: "OpenAI" },
};

export function claudeDesktopDirs(home: string, platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return [join(home, "Library", "Application Support", "Claude"), join(home, "Library", "Application Support", "Claude-3p")];
  }
  if (platform === "win32") {
    return [
      join(home, "AppData", "Roaming", "Claude"),
      join(home, "AppData", "Local", "Claude"),
      join(home, "AppData", "Roaming", "Claude-3p"),
      join(home, "AppData", "Local", "Claude-3p"),
    ];
  }
  return [join(home, ".config", "Claude"), join(home, ".config", "Claude-3p")];
}

export function antigravityDirs(home: string, platform: NodeJS.Platform): string[] {
  const dirs = [join(home, ".gemini"), join(home, ".gemini", "antigravity-cli"), join(home, ".antigravity"), join(home, ".config", "antigravity")];
  if (platform === "darwin") dirs.push(join(home, "Library", "Application Support", "Antigravity"));
  if (platform === "win32") dirs.push(join(home, "AppData", "Roaming", "Antigravity"));
  return dirs;
}

export function cursorDirs(home: string): string[] {
  return [
    join(home, ".cursor"),
    join(home, "Library", "Application Support", "Cursor"),
    join(home, "AppData", "Roaming", "Cursor"),
    join(home, ".config", "Cursor"),
  ];
}

function usableSecret(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 8) return false;
  if (trimmed === LOCAL_CLIENT_KEY) return false;
  if (trimmed.includes("${")) return false;
  return true;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Pull a Google OAuth client out of an installed app's JSON. The secret is not logged by callers. */
export function findGoogleClient(payload: unknown, depth = 0): GoogleClientFound | null {
  if (depth > 6 || !payload || typeof payload !== "object") return null;
  if (Array.isArray(payload)) {
    for (const item of payload.slice(0, 20)) {
      const found = findGoogleClient(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const row = payload as Record<string, unknown>;
  const id = row.client_id ?? row.clientId;
  const secret = row.client_secret ?? row.clientSecret;
  if (typeof id === "string" && id.endsWith(".apps.googleusercontent.com") && typeof secret === "string" && secret.trim().length >= 8) {
    return { clientId: id, clientSecret: secret.trim() };
  }
  for (const value of Object.values(row)) {
    const found = findGoogleClient(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function pushAccount(list: ImportedAccount[], account: ImportedAccount): void {
  if (list.some((item) => item.secretRef === account.secretRef)) return;
  list.push(account);
}

function claudeFromDocument(raw: string, secretRef: string, detail: string): ImportedAccount | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const blob = parseClaudeCredentials(parsed);
  if (!blob?.accessToken || blob.accessToken.length < 8) return null;
  return {
    provider: "claude",
    label: blob.email || "Claude Code",
    secretRef,
    authKind: "oauth",
    email: blob.email,
    expiresAt: blob.expiresAt,
    lineage: lineageOf(blob.refreshToken),
    externalId: blob.accountUuid,
    detail,
  };
}

function googleAccount(raw: string, secretRef: string, provider: ProviderId, label: string, detail: string): ImportedAccount | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const tokens = parseGoogleTokens(parsed);
  if (!tokens) return null;
  return {
    provider,
    label: tokens.email || label,
    secretRef,
    authKind: "oauth",
    email: tokens.email,
    expiresAt: tokens.expiresAt,
    externalId: tokens.projectId,
    detail,
  };
}

function envFromSettings(text: string | undefined, into: Record<string, string>): void {
  if (!text) return;
  try {
    const doc = JSON.parse(text) as { env?: Record<string, unknown> };
    const env = doc.env;
    if (!env || typeof env !== "object") return;
    for (const spec of ENV_KEYS) {
      const value = env[spec.name];
      if (typeof value === "string" && usableSecret(value) && !into[spec.name]) into[spec.name] = value.trim();
    }
  } catch {
    /* not settings */
  }
}

function opencodeAccounts(text: string): ImportedAccount[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return [];
  }
  const root = record(parsed);
  if (!root) return [];
  const found: ImportedAccount[] = [];
  for (const [id, value] of Object.entries(root)) {
    const mapped = OPENCODE_PROVIDERS[id];
    const row = record(value);
    if (!mapped || !row) continue;
    const key = typeof row.key === "string" ? row.key : typeof row.access === "string" ? row.access : "";
    if (!usableSecret(key)) continue;
    pushAccount(found, {
      provider: mapped.provider,
      label: mapped.label,
      secretRef: `discovered:opencode:${id}`,
      authKind: row.type === "oauth" ? "oauth" : "api-key",
      baseUrl: mapped.baseUrl,
      detail: "OpenCode auth.json",
    });
  }
  return found;
}

export function secretFromDesktopFile(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  const root = record(parsed);
  if (!root) return null;
  const env = record(root.env) ?? root;
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "accessToken", "access_token"]) {
    const value = env[name];
    if (typeof value === "string" && usableSecret(value)) return value.trim();
  }
  return null;
}

/**
 * Find logins that are already on disk. File-backed accounts keep a `discovered:`
 * ref and are read again at request time. Returned details never include secret values.
 */
export function scanMachine(input: ScanInput): ScanResult {
  const accounts: ImportedAccount[] = [];
  const secretValues: Record<string, string> = {};
  const notes: ScanResult["notes"] = [];
  const home = input.home;

  const credentials = input.files[join(home, ".claude", ".credentials.json")];
  const legacy = input.files[join(home, ".claude.json")];
  const fromFile = credentials ? claudeFromDocument(credentials, "discovered:claude", "~/.claude/.credentials.json") : null;
  const fromLegacy = !fromFile && legacy ? claudeFromDocument(legacy, "discovered:claude", "~/.claude.json") : null;
  const fileAccount = fromFile ?? fromLegacy;
  if (fileAccount) pushAccount(accounts, fileAccount);

  if (input.keychainClaude) {
    const fromKeychain = claudeFromDocument(input.keychainClaude, "discovered:claude-keychain", "macOS Keychain · Claude Code-credentials");
    const sameLogin = Boolean(fileAccount) && (!fromKeychain?.lineage || fromKeychain.lineage === fileAccount?.lineage);
    if (fromKeychain && sameLogin) {
      /* the file and the keychain are the same login */
    } else if (fromKeychain && !fileAccount) {
      fromKeychain.secretRef = "discovered:claude";
      fromKeychain.detail = "macOS Keychain · Claude Code-credentials";
      pushAccount(accounts, fromKeychain);
    } else if (fromKeychain) {
      pushAccount(accounts, fromKeychain);
    }
  }

  const codex = input.files[join(home, ".codex", "auth.json")];
  if (codex) {
    try {
      const login = readCodexAuth(JSON.parse(codex) as unknown, input.now);
      if (login) {
        pushAccount(accounts, {
          provider: "codex",
          label: "Codex",
          secretRef: "discovered:codex",
          authKind: login.kind === "apikey" ? "api-key" : "oauth",
          externalId: login.accountId,
          baseUrl: login.kind === "apikey" ? "https://api.openai.com/v1" : undefined,
          detail: "~/.codex/auth.json",
        });
      }
    } catch {
      /* unreadable */
    }
  }

  const gemini = input.files[join(home, ".gemini", "oauth_creds.json")];
  if (gemini) {
    const account = googleAccount(gemini, "discovered:gemini", "gemini", "Gemini", "~/.gemini/oauth_creds.json");
    if (account) pushAccount(accounts, account);
  }

  const antigravity = input.files[join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token")];
  if (antigravity) {
    const account = googleAccount(antigravity, "discovered:antigravity", "antigravity", "Antigravity", "~/.gemini/antigravity-cli/antigravity-oauth-token");
    if (account) pushAccount(accounts, account);
  }

  for (const text of [input.files[join(home, ".local", "share", "opencode", "auth.json")], input.files[join(home, ".config", "opencode", "auth.json")]]) {
    if (!text) continue;
    for (const account of opencodeAccounts(text)) pushAccount(accounts, account);
  }

  let sawDesktopConfig = false;
  let sawDesktopCreds = false;
  for (const dir of claudeDesktopDirs(home, input.platform)) {
    const names = input.dirs[dir] ?? [];
    const configText = input.files[join(dir, "config.json")];
    if (configText && configText.includes("oauth:tokenCache")) sawDesktopConfig = true;
    for (const name of names) {
      if (!name.startsWith("host-creds-") || !name.endsWith(".json")) continue;
      const text = input.files[join(dir, name)];
      if (!text) continue;
      const secret = secretFromDesktopFile(text);
      if (!secret) continue;
      sawDesktopCreds = true;
      const ref = `discovered:desktop:${name}`;
      secretValues[ref] = secret;
      pushAccount(accounts, {
        provider: "claude",
        label: "Claude Desktop",
        secretRef: ref,
        authKind: secret.startsWith("sk-") ? "api-key" : "oauth",
        detail: "Claude Desktop session file",
      });
    }
  }
  if (sawDesktopConfig && !sawDesktopCreds) notes.push("desktop-encrypted");

  if (cursorDirs(home).some((dir) => input.dirs[dir] !== undefined)) notes.push("cursor-unroutable");

  const overlay: Record<string, string> = {};
  envFromSettings(input.files[join(home, ".claude", "settings.json")], overlay);
  envFromSettings(input.files[join(home, ".claude", "settings.local.json")], overlay);
  for (const spec of ENV_KEYS) {
    const fromProcess = input.env[spec.name];
    const value = usableSecret(fromProcess) ? fromProcess.trim() : overlay[spec.name];
    if (!usableSecret(value)) continue;
    const ref = `env:${spec.name}`;
    if (spec.name === "GOOGLE_API_KEY" && accounts.some((item) => item.secretRef === "env:GEMINI_API_KEY")) continue;
    secretValues[ref] = value.trim();
    pushAccount(accounts, {
      provider: spec.provider,
      label: spec.label,
      secretRef: ref,
      authKind: spec.authKind,
      baseUrl: spec.baseUrl,
      detail: spec.name,
    });
  }

  let googleClient: GoogleClientFound | null = null;
  for (const text of Object.values(input.files)) {
    try {
      googleClient = findGoogleClient(JSON.parse(text) as unknown);
    } catch {
      googleClient = null;
    }
    if (googleClient) break;
  }
  if (accounts.some((item) => item.provider === "antigravity") && !googleClient) notes.push("antigravity-no-client");

  return { accounts, secretValues, googleClient, notes };
}

const MAX_FILE = 200_000;

function readBounded(path: string): string | null {
  try {
    if (!existsSync(path) || statSync(path).size > MAX_FILE) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function listDir(path: string): string[] | undefined {
  try {
    if (!existsSync(path)) return undefined;
    return readdirSync(path);
  } catch {
    return undefined;
  }
}

/** Read the known credential locations. Does not walk the whole home directory. */
export function scanHome(home: string, platform: NodeJS.Platform, env: Record<string, string | undefined>, keychainClaude?: string | null, now = Date.now()): ScanResult {
  const files: Record<string, string> = {};
  const dirs: Record<string, string[]> = {};
  const wanted = [
    join(home, ".claude", ".credentials.json"),
    join(home, ".claude.json"),
    join(home, ".claude", "settings.json"),
    join(home, ".claude", "settings.local.json"),
    join(home, ".codex", "auth.json"),
    join(home, ".gemini", "oauth_creds.json"),
    join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token"),
    join(home, ".local", "share", "opencode", "auth.json"),
    join(home, ".config", "opencode", "auth.json"),
  ];
  for (const path of wanted) {
    const text = readBounded(path);
    if (text != null) files[path] = text;
  }
  for (const dir of [...claudeDesktopDirs(home, platform), ...antigravityDirs(home, platform), ...cursorDirs(home)]) {
    const names = listDir(dir);
    if (!names) continue;
    dirs[dir] = names;
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      if (name.length > 80) continue;
      const text = readBounded(join(dir, name));
      if (text != null) files[join(dir, name)] = text;
    }
  }
  return scanMachine({ home, platform, env, files, dirs, keychainClaude, now });
}

export function opencodeKey(raw: string, providerId: string): string | null {
  try {
    const root = JSON.parse(raw) as Record<string, unknown>;
    const row = record(root[providerId]);
    if (!row) return null;
    const key = typeof row.key === "string" ? row.key : typeof row.access === "string" ? row.access : "";
    return usableSecret(key) ? key.trim() : null;
  } catch {
    return null;
  }
}
