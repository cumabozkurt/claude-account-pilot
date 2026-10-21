import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyTokenResponse,
  buildAuthorizeUrl,
  CLAUDE_OAUTH,
  createPkce,
  credentialsDocument,
  exchangeClaudeCode,
  isAccessExpired,
  lineageOf,
  parseClaudeCredentials,
  parsePastedCode,
  refreshClaudeOauth,
  refreshRequest,
} from "../core/oauth-claude.js";
import { pollClaudeSubscription } from "../core/subscription.js";

describe("Claude OAuth", () => {
  it("builds a PKCE authorize URL for the public Claude Code client", () => {
    const login = createPkce(() => Buffer.from("0123456789abcdef0123456789abcdef"));
    const url = new URL(buildAuthorizeUrl(login));
    assert.equal(url.origin + url.pathname, CLAUDE_OAUTH.authorizeUrl);
    assert.equal(url.searchParams.get("client_id"), CLAUDE_OAUTH.clientId);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("redirect_uri"), CLAUDE_OAUTH.redirectUri);
    assert.ok(url.searchParams.get("code_challenge"));
  });

  it("parses a pasted code#state and a callback URL", () => {
    assert.deepEqual(parsePastedCode("abc#state1"), { code: "abc", state: "state1" });
    assert.deepEqual(parsePastedCode("https://platform.claude.com/oauth/code/callback?code=abc&state=s"), {
      code: "abc",
      state: "s",
    });
    assert.equal(parsePastedCode("   "), null);
  });

  it("rotates both tokens and classifies invalid_grant without a substring scan", () => {
    const previous = { accessToken: "access-old-token", refreshToken: "refresh-old-token", expiresAt: 1 };
    const ok = applyTokenResponse(
      previous,
      200,
      JSON.stringify({
        access_token: "access-new-token",
        refresh_token: "refresh-new-token",
        expires_in: 3600,
        scope: "user:inference user:profile",
        account: { uuid: "acct-1", email_address: "a@example.com" },
      }),
      1_000,
    );
    assert.equal(ok.error, null);
    assert.equal(ok.blob?.accessToken, "access-new-token");
    assert.equal(ok.blob?.refreshToken, "refresh-new-token");
    assert.equal(ok.blob?.expiresAt, 1_000 + 3_600_000);
    assert.equal(ok.blob?.email, "a@example.com");
    assert.notEqual(lineageOf(previous.refreshToken), lineageOf(ok.blob?.refreshToken));

    const dead = applyTokenResponse(previous, 400, JSON.stringify({ error: "invalid_grant", error_description: "expired" }));
    assert.equal(dead.error, "invalid_grant");
    assert.equal(dead.blob, null);
    const ambiguous = applyTokenResponse(previous, 400, "invalid_grant mentioned in html");
    assert.equal(ambiguous.error, "transient");
  });

  it("sends a JSON refresh body and a User-Agent", () => {
    const request = refreshRequest({ accessToken: "access-token-value", refreshToken: "refresh-token-value" });
    assert.ok(request);
    assert.equal(request?.headers["content-type"], "application/json");
    assert.equal(request?.headers["user-agent"], CLAUDE_OAUTH.userAgent);
    const body = JSON.parse(request!.body) as { grant_type: string; client_id: string };
    assert.equal(body.grant_type, "refresh_token");
    assert.equal(body.client_id, CLAUDE_OAUTH.clientId);
  });

  it("refreshes an expired blob through the injected client and then reads usage", async () => {
    const calls: string[] = [];
    const secret = credentialsDocument({
      accessToken: "access-old-token",
      refreshToken: "refresh-old-token",
      expiresAt: 1,
    });
    const result = await pollClaudeSubscription(
      secret,
      async (request) => {
        calls.push(request.url);
        if (request.url === CLAUDE_OAUTH.tokenUrl) {
          return {
            status: 200,
            body: JSON.stringify({ access_token: "access-new-token", refresh_token: "refresh-new-token", expires_in: 60 }),
          };
        }
        if (request.url === CLAUDE_OAUTH.profileUrl) {
          return { status: 200, body: JSON.stringify({ account: { uuid: "u1", email: "a@example.com" } }) };
        }
        return { status: 200, body: JSON.stringify({ five_hour: { utilization: 0.4, resets_at: "2026-10-21T12:00:00Z" } }) };
      },
      false,
      10_000,
    );
    assert.equal(result.rotated, true);
    assert.equal(result.blob?.accessToken, "access-new-token");
    assert.equal(result.usageStatus, 200);
    assert.match(result.stored ?? "", /refresh-new-token/);
    assert.deepEqual(calls[0], CLAUDE_OAUTH.tokenUrl);
    const parsed = parseClaudeCredentials(JSON.parse(result.stored ?? "{}"));
    assert.equal(parsed?.email, "a@example.com");
  });

  it("does not refresh a login Claude Code still has on disk", async () => {
    const calls: string[] = [];
    const secret = credentialsDocument({
      accessToken: "access-live-token",
      refreshToken: "refresh-live-token",
      expiresAt: 1,
      email: "a@example.com",
      accountUuid: "acct",
    });
    const result = await pollClaudeSubscription(
      secret,
      async (request) => {
        calls.push(request.url);
        return { status: 200, body: JSON.stringify({ five_hour: { utilization: 10 } }) };
      },
      true,
      10_000,
    );
    assert.equal(result.rotated, false);
    assert.equal(calls.includes(CLAUDE_OAUTH.tokenUrl), false);
    assert.deepEqual(calls, [CLAUDE_OAUTH.usageUrl]);
    assert.equal(isAccessExpired(1, 10_000), true);
  });

  it("rejects a pasted code whose state does not match the login that was opened", async () => {
    const login = createPkce(() => Buffer.from("0123456789abcdef0123456789abcdef"));
    const result = await exchangeClaudeCode(login, "code#other-state", async () => {
      throw new Error("should not be called");
    });
    assert.equal(result.blob, null);
  });
});
