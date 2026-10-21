export interface CodexLogin {
  kind: "chatgpt" | "apikey";
  token: string;
  accountId?: string;
}

export interface ClaudeLogin {
  token: string;
  expiresAt?: number;
  expired: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

/** Read a Codex CLI auth.json document. The token never leaves this function's return value. */
export function readCodexAuth(payload: unknown, now = Date.now()): CodexLogin | null {
  const root = record(payload);
  if (!root) return null;
  const apiKey = root.OPENAI_API_KEY;
  if (typeof apiKey === "string" && apiKey.length > 8) {
    return { kind: "apikey", token: apiKey };
  }
  const tokens = record(root.tokens);
  const access = tokens?.access_token;
  if (typeof access !== "string" || access.length < 8) return null;
  const account = tokens?.account_id;
  return {
    kind: "chatgpt",
    token: access,
    accountId: typeof account === "string" ? account : undefined,
  };
}

export function readClaudeOauth(payload: unknown, now = Date.now()): ClaudeLogin | null {
  const root = record(payload);
  if (!root) return null;
  const oauth = record(root.claudeAiOauth) ?? root;
  const token = oauth.accessToken ?? oauth.access_token;
  if (typeof token !== "string" || token.length < 8) return null;
  const expires = Number(oauth.expiresAt ?? oauth.expires_at ?? 0);
  const expired = Number.isFinite(expires) && expires > 0 && expires <= now;
  return { token, expiresAt: expires || undefined, expired };
}

export const DISCOVERED_CODEX = "discovered:codex";
export const DISCOVERED_CLAUDE = "discovered:claude";
