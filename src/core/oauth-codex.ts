/**
 * Codex CLI (ChatGPT login) refresh. The client id is the public Codex CLI
 * id. Refresh tokens rotate, so a successful refresh has to be written back
 * to ~/.codex/auth.json or the next refresh from either process fails.
 */
export const CODEX_OAUTH = {
  clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
  tokenUrl: "https://auth.openai.com/oauth/token",
  responsesUrl: "https://chatgpt.com/backend-api/codex/responses",
  originator: "codex_cli_rs",
  version: "0.131.0",
} as const;

export interface CodexTokens {
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  idToken?: string;
}

export interface CodexRefreshResult {
  tokens: CodexTokens | null;
  error: "invalid_grant" | "transient" | "no_refresh_token" | null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseCodexTokens(payload: unknown): CodexTokens | null {
  const root = record(payload);
  if (!root) return null;
  const tokens = record(root.tokens) ?? root;
  const access = tokens.access_token ?? tokens.accessToken;
  if (typeof access !== "string" || access.length < 8) return null;
  const refresh = tokens.refresh_token ?? tokens.refreshToken;
  const account = tokens.account_id ?? tokens.accountId ?? root.account_id;
  const idToken = tokens.id_token ?? tokens.idToken;
  return {
    accessToken: access,
    refreshToken: typeof refresh === "string" && refresh ? refresh : undefined,
    accountId: typeof account === "string" ? account : undefined,
    idToken: typeof idToken === "string" ? idToken : undefined,
  };
}

/** Read `exp` from a JWT payload. The signature is not checked; this is only a clock hint. */
export function jwtExpiryMs(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return undefined;
  try {
    const json = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { exp?: unknown };
    const exp = Number(json.exp);
    if (!Number.isFinite(exp) || exp <= 0) return undefined;
    return exp * 1000;
  } catch {
    return undefined;
  }
}

export function codexNeedsRefresh(tokens: CodexTokens, now = Date.now()): boolean {
  if (!tokens.refreshToken) return false;
  const exp = jwtExpiryMs(tokens.accessToken);
  if (!exp) return false;
  return now + 60_000 >= exp;
}

export function codexRefreshRequest(tokens: CodexTokens): { url: string; method: "POST"; headers: Record<string, string>; body: string } | null {
  if (!tokens.refreshToken) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: CODEX_OAUTH.clientId,
  });
  return {
    url: CODEX_OAUTH.tokenUrl,
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: body.toString(),
  };
}

export function applyCodexRefresh(previous: CodexTokens, status: number, body: string): CodexRefreshResult {
  if (!previous.refreshToken) return { tokens: null, error: "no_refresh_token" };
  if (status < 200 || status >= 300) {
    let error: string | undefined;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === "string") error = parsed.error;
    } catch {
      error = undefined;
    }
    return { tokens: null, error: error === "invalid_grant" ? "invalid_grant" : "transient" };
  }
  try {
    const parsed = record(JSON.parse(body) as unknown);
    const access = parsed?.access_token;
    if (typeof access !== "string" || access.length < 8) return { tokens: null, error: "transient" };
    const refresh = parsed?.refresh_token;
    return {
      tokens: {
        accessToken: access,
        refreshToken: typeof refresh === "string" && refresh ? refresh : previous.refreshToken,
        accountId: previous.accountId,
        idToken: typeof parsed?.id_token === "string" ? parsed.id_token : previous.idToken,
      },
      error: null,
    };
  } catch {
    return { tokens: null, error: "transient" };
  }
}

/** Put refreshed tokens back into the original auth.json shape, keeping every other field. */
export function mergeCodexTokens(original: unknown, tokens: CodexTokens): Record<string, unknown> {
  const root = record(original) ?? {};
  const current = record(root.tokens) ?? {};
  return {
    ...root,
    tokens: {
      ...current,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken ?? current.refresh_token,
      account_id: tokens.accountId ?? current.account_id,
      id_token: tokens.idToken ?? current.id_token,
    },
  };
}
