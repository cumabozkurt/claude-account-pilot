import { createHash, randomBytes } from "node:crypto";

/**
 * Claude subscription OAuth, matching the public client Claude Code and
 * claude-swap use. The token endpoint must be JSON (a form body is rejected)
 * and must send a User-Agent. Refresh tokens rotate: a successful refresh
 * replaces both the access token and, when the server sends one, the refresh
 * token. Callers persist the whole blob or the previous refresh token is dead.
 */
export const CLAUDE_OAUTH = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authorizeUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://platform.claude.com/v1/oauth/token",
  redirectUri: "https://platform.claude.com/oauth/code/callback",
  usageUrl: "https://api.anthropic.com/api/oauth/usage",
  profileUrl: "https://api.anthropic.com/api/oauth/profile",
  beta: "oauth-2025-04-20",
  userAgent: "claude-code/1.0",
  scopes: ["org:create_api_key", "user:profile", "user:inference"],
  expiryBufferMs: 5 * 60 * 1000,
} as const;

export interface ClaudeOauthBlob {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshTokenExpiresAt?: number;
  scopes?: string[];
  email?: string;
  accountUuid?: string;
  organizationUuid?: string;
  subscriptionType?: string;
}

export interface PkceLogin {
  verifier: string;
  challenge: string;
  state: string;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export type HttpClient = (request: {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}) => Promise<HttpResponse>;

export type RefreshError = "invalid_grant" | "invalid_client" | "no_refresh_token" | "transient";

export interface RefreshResult {
  blob: ClaudeOauthBlob | null;
  error: RefreshError | null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

export function createPkce(bytes = randomBytes): PkceLogin {
  const verifier = base64url(bytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(bytes(16));
  return { verifier, challenge, state };
}

export function buildAuthorizeUrl(login: PkceLogin): string {
  const url = new URL(CLAUDE_OAUTH.authorizeUrl);
  url.searchParams.set("code", "true");
  url.searchParams.set("client_id", CLAUDE_OAUTH.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", CLAUDE_OAUTH.redirectUri);
  url.searchParams.set("scope", CLAUDE_OAUTH.scopes.join(" "));
  url.searchParams.set("code_challenge", login.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", login.state);
  return url.toString();
}

/** Accept a pasted `code`, `code#state`, or the callback URL. */
export function parsePastedCode(pasted: string): { code: string; state?: string } | null {
  const text = pasted.trim();
  if (!text) return null;
  try {
    if (text.startsWith("http://") || text.startsWith("https://")) {
      const url = new URL(text);
      const code = url.searchParams.get("code") ?? "";
      const state = url.searchParams.get("state") ?? undefined;
      const split = splitCode(code);
      return split.code ? { code: split.code, state: split.state ?? state } : null;
    }
  } catch {
    return null;
  }
  const split = splitCode(text);
  return split.code ? split : null;
}

function splitCode(value: string): { code: string; state?: string } {
  const [code, state] = value.trim().split("#");
  return { code: code ?? "", state: state || undefined };
}

export function lineageOf(refreshToken: string | undefined): string | undefined {
  if (!refreshToken) return undefined;
  return createHash("sha256").update(refreshToken).digest("hex");
}

export function isAccessExpired(expiresAt: number | undefined, now = Date.now()): boolean {
  if (!expiresAt || !Number.isFinite(expiresAt)) return false;
  return now + CLAUDE_OAUTH.expiryBufferMs >= expiresAt;
}

export function parseClaudeCredentials(payload: unknown): ClaudeOauthBlob | null {
  const root = record(payload);
  if (!root) return null;
  const oauth = record(root.claudeAiOauth) ?? root;
  const access = oauth.accessToken ?? oauth.access_token;
  if (typeof access !== "string" || access.length < 8) return null;
  const refresh = oauth.refreshToken ?? oauth.refresh_token;
  const expires = Number(oauth.expiresAt ?? oauth.expires_at ?? 0);
  const refreshExpires = Number(oauth.refreshTokenExpiresAt ?? 0);
  const scopes = Array.isArray(oauth.scopes)
    ? oauth.scopes.filter((item): item is string => typeof item === "string")
    : typeof oauth.scope === "string"
      ? oauth.scope.split(/\s+/).filter(Boolean)
      : undefined;
  return {
    accessToken: access,
    refreshToken: typeof refresh === "string" && refresh ? refresh : undefined,
    expiresAt: Number.isFinite(expires) && expires > 0 ? expires : undefined,
    refreshTokenExpiresAt: Number.isFinite(refreshExpires) && refreshExpires > 0 ? refreshExpires : undefined,
    scopes,
    email: typeof oauth.email === "string" ? oauth.email : undefined,
    accountUuid: typeof oauth.accountUuid === "string" ? oauth.accountUuid : undefined,
    organizationUuid: typeof oauth.organizationUuid === "string" ? oauth.organizationUuid : undefined,
    subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : undefined,
  };
}

export function credentialsDocument(blob: ClaudeOauthBlob): string {
  return `${JSON.stringify({ claudeAiOauth: blob }, null, 2)}\n`;
}

/** A stored secret is either a raw access token or a credentials JSON document. */
export function blobFromSecret(secret: string): ClaudeOauthBlob | null {
  const trimmed = secret.trim();
  if (trimmed.startsWith("{")) {
    try {
      return parseClaudeCredentials(JSON.parse(trimmed) as unknown);
    } catch {
      return null;
    }
  }
  if (trimmed.length < 8) return null;
  return { accessToken: trimmed };
}

export function accessTokenFromSecret(secret: string): string | null {
  return blobFromSecret(secret)?.accessToken ?? null;
}

function tokenHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": CLAUDE_OAUTH.userAgent,
  };
}

export function refreshRequest(blob: ClaudeOauthBlob): { url: string; method: "POST"; headers: Record<string, string>; body: string } | null {
  if (!blob.refreshToken) return null;
  return {
    url: CLAUDE_OAUTH.tokenUrl,
    method: "POST",
    headers: tokenHeaders(),
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: blob.refreshToken,
      client_id: CLAUDE_OAUTH.clientId,
    }),
  };
}

export function exchangeRequest(login: PkceLogin, pasted: { code: string; state?: string }): {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
} {
  return {
    url: CLAUDE_OAUTH.tokenUrl,
    method: "POST",
    headers: tokenHeaders(),
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: pasted.code,
      redirect_uri: CLAUDE_OAUTH.redirectUri,
      client_id: CLAUDE_OAUTH.clientId,
      code_verifier: login.verifier,
      state: pasted.state ?? login.state,
    }),
  };
}

export function usageRequest(accessToken: string): { url: string; method: "GET"; headers: Record<string, string> } {
  return {
    url: CLAUDE_OAUTH.usageUrl,
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "anthropic-beta": CLAUDE_OAUTH.beta,
      "user-agent": CLAUDE_OAUTH.userAgent,
      accept: "application/json",
    },
  };
}

export function profileRequest(accessToken: string): { url: string; method: "GET"; headers: Record<string, string> } {
  return {
    url: CLAUDE_OAUTH.profileUrl,
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "user-agent": CLAUDE_OAUTH.userAgent,
      accept: "application/json",
    },
  };
}

function classifyTokenError(status: number, body: string): RefreshError {
  let error: string | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") error = parsed.error;
  } catch {
    error = undefined;
  }
  if (error === "invalid_grant" || error === "invalid_client") return error;
  if (status === 400 || status === 401 || status === 403) return "transient";
  return "transient";
}

export function applyTokenResponse(previous: ClaudeOauthBlob, status: number, body: string, now = Date.now()): RefreshResult {
  if (status < 200 || status >= 300) return { blob: null, error: classifyTokenError(status, body) };
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(body) as unknown;
    const rec = record(value);
    if (!rec) return { blob: null, error: "transient" };
    parsed = rec;
  } catch {
    return { blob: null, error: "transient" };
  }
  const access = parsed.access_token;
  if (typeof access !== "string" || access.length < 8) return { blob: null, error: "transient" };
  const expiresIn = Number(parsed.expires_in);
  const refresh = parsed.refresh_token;
  const scope = parsed.scope;
  const account = record(parsed.account);
  const organization = record(parsed.organization);
  const next: ClaudeOauthBlob = {
    ...previous,
    accessToken: access,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : previous.expiresAt,
    refreshToken: typeof refresh === "string" && refresh ? refresh : previous.refreshToken,
    scopes: typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : previous.scopes,
  };
  const uuid = account?.uuid;
  if (typeof uuid === "string" && uuid.trim()) next.accountUuid = uuid.trim();
  const email = account?.email_address ?? account?.email;
  if (typeof email === "string" && email) next.email = email;
  const org = organization?.uuid;
  if (typeof org === "string" && org) next.organizationUuid = org;
  return { blob: next, error: null };
}

export async function refreshClaudeOauth(blob: ClaudeOauthBlob, http: HttpClient, now = Date.now()): Promise<RefreshResult> {
  const request = refreshRequest(blob);
  if (!request) return { blob: null, error: "no_refresh_token" };
  try {
    const response = await http(request);
    return applyTokenResponse(blob, response.status, response.body, now);
  } catch {
    return { blob: null, error: "transient" };
  }
}

export async function exchangeClaudeCode(login: PkceLogin, pasted: string, http: HttpClient, now = Date.now()): Promise<RefreshResult> {
  const code = parsePastedCode(pasted);
  if (!code) return { blob: null, error: "transient" };
  if (code.state && code.state !== login.state) return { blob: null, error: "transient" };
  try {
    const response = await http(exchangeRequest(login, code));
    return applyTokenResponse({ accessToken: "" }, response.status, response.body, now);
  } catch {
    return { blob: null, error: "transient" };
  }
}

export interface ProfileIdentity {
  accountUuid: string;
  email?: string;
  organizationUuid?: string;
}

export function parseProfile(status: number, body: string): ProfileIdentity | null {
  if (status < 200 || status >= 300) return null;
  try {
    const root = record(JSON.parse(body) as unknown);
    const account = record(root?.account);
    const uuid = account?.uuid;
    if (typeof uuid !== "string" || !uuid.trim()) return null;
    const email = account?.email ?? account?.email_address;
    const organization = record(root?.organization);
    const org = organization?.uuid;
    return {
      accountUuid: uuid.trim(),
      email: typeof email === "string" ? email : undefined,
      organizationUuid: typeof org === "string" ? org : undefined,
    };
  } catch {
    return null;
  }
}

export async function fetchClaudeProfile(accessToken: string, http: HttpClient): Promise<ProfileIdentity | null> {
  try {
    const response = await http(profileRequest(accessToken));
    return parseProfile(response.status, response.body);
  } catch {
    return null;
  }
}
