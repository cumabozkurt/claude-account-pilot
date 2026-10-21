import { createHash, randomBytes } from "node:crypto";

/**
 * Antigravity signs in with the public Google OAuth client shipped in the
 * desktop app (the same client CLIProxyAPI publishes). The client secret is
 * not a credential of this project. Consumer accounts must call
 * daily-cloudcode-pa.googleapis.com only. The prod host
 * cloudcode-pa.googleapis.com answers consumer accounts with 429 and is
 * never used as a fallback.
 */
export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

/**
 * The Antigravity desktop client id and secret are public in other tools, but
 * GitHub secret scanning rejects committing them. The user pastes them into
 * settings; they are not shipped in this repository.
 */
export const ANTIGRAVITY = {
  authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  redirectUri: "http://127.0.0.1:51121/oauth-callback",
  callbackPort: 51121,
  callbackPath: "/oauth-callback",
  baseUrl: "https://daily-cloudcode-pa.googleapis.com",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/cclog",
    "https://www.googleapis.com/auth/experimentsandconfigs",
  ],
} as const;

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  email?: string;
  projectId?: string;
}

export interface GoogleRefreshResult {
  tokens: GoogleTokens | null;
  error: "invalid_grant" | "transient" | "no_refresh_token" | null;
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function expiryMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/** Read a Gemini CLI creds file or an Antigravity `token` envelope. */
export function parseGoogleTokens(payload: unknown): GoogleTokens | null {
  const root = record(payload);
  if (!root) return null;
  const nested = record(root.token);
  const source = nested && (typeof nested.access_token === "string" || typeof nested.accessToken === "string") ? nested : root;
  const access = source.access_token ?? source.accessToken;
  if (typeof access !== "string" || access.length < 8) return null;
  const refresh = source.refresh_token ?? source.refreshToken ?? root.refresh_token ?? root.refreshToken;
  const expires = expiryMs(source.expiresAt ?? source.expiry_date ?? source.expiry ?? root.expiresAt ?? root.expiry_date);
  const email = source.email ?? root.email;
  const project = source.projectId ?? source.project_id ?? root.projectId ?? root.project_id;
  return {
    accessToken: access,
    refreshToken: typeof refresh === "string" && refresh ? refresh : undefined,
    expiresAt: expires,
    email: typeof email === "string" ? email : undefined,
    projectId: typeof project === "string" ? project : undefined,
  };
}

/** Write a refreshed token back into whichever shape the file already used. */
export function patchGoogleCredentialFile(raw: string, tokens: GoogleTokens): string {
  const parsed = JSON.parse(raw) as unknown;
  const root = record(parsed) ?? {};
  const nested = record(root.token);
  if (nested) {
    nested.access_token = tokens.accessToken;
    if (tokens.refreshToken) nested.refresh_token = tokens.refreshToken;
    if (tokens.expiresAt) nested.expiry = new Date(tokens.expiresAt).toISOString();
    root.token = nested;
  } else {
    root.access_token = tokens.accessToken;
    if (tokens.refreshToken) root.refresh_token = tokens.refreshToken;
    if (tokens.expiresAt) root.expiry_date = tokens.expiresAt;
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}

export function googleNeedsRefresh(tokens: GoogleTokens, now = Date.now()): boolean {
  if (!tokens.refreshToken || !tokens.expiresAt) return false;
  return now + 60_000 >= tokens.expiresAt;
}

export function createGoogleLogin(bytes = randomBytes): { verifier: string; challenge: string; state: string } {
  const verifier = bytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, state: bytes(16).toString("base64url") };
}

export function buildAntigravityAuthorizeUrl(login: { challenge: string; state: string }, client: GoogleClient): string {
  const url = new URL(ANTIGRAVITY.authUrl);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", ANTIGRAVITY.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", ANTIGRAVITY.scopes.join(" "));
  url.searchParams.set("code_challenge", login.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", login.state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

function tokenForm(fields: Record<string, string>): { url: string; method: "POST"; headers: Record<string, string>; body: string } {
  return {
    url: ANTIGRAVITY.tokenUrl,
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
  };
}

export function googleRefreshRequest(tokens: GoogleTokens, client: GoogleClient) {
  if (!tokens.refreshToken || !client.clientId || !client.clientSecret) return null;
  return tokenForm({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
  });
}

export function googleExchangeRequest(login: { verifier: string }, code: string, client: GoogleClient) {
  return tokenForm({
    grant_type: "authorization_code",
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: ANTIGRAVITY.redirectUri,
    code_verifier: login.verifier,
  });
}

export function applyGoogleToken(previous: GoogleTokens, status: number, body: string, now = Date.now()): GoogleRefreshResult {
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
    const expiresIn = Number(parsed?.expires_in);
    const refresh = parsed?.refresh_token;
    return {
      tokens: {
        ...previous,
        accessToken: access,
        refreshToken: typeof refresh === "string" && refresh ? refresh : previous.refreshToken,
        expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : previous.expiresAt,
      },
      error: null,
    };
  } catch {
    return { tokens: null, error: "transient" };
  }
}

export function googleTokensDocument(tokens: GoogleTokens): string {
  return `${JSON.stringify(
    {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      email: tokens.email,
      projectId: tokens.projectId,
    },
    null,
    2,
  )}\n`;
}
