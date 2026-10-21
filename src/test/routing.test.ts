import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anthropicToCloudCode, cloudCodeToAnthropic } from "../core/cloudcode.js";
import { ANTIGRAVITY, applyGoogleToken, buildAntigravityAuthorizeUrl, createGoogleLogin, googleRefreshRequest } from "../core/oauth-google.js";
import { applyCodexRefresh, codexNeedsRefresh, codexRefreshRequest, CODEX_OAUTH, jwtExpiryMs, mergeCodexTokens } from "../core/oauth-codex.js";
import { openRouterPercent } from "../core/openrouter.js";
import { planRequest, type RuntimeSnapshot } from "../core/plan.js";
import { messagesUrl, providerSpec } from "../core/providers.js";
import { startProxy, type Upstream } from "../core/proxy.js";
import { defaultConfig, type Account } from "../core/types.js";
import { listenForOAuthCode } from "../core/oauth-loopback.js";

function account(partial: Partial<Account> & Pick<Account, "id" | "provider">): Account {
  return { label: partial.id, enabled: true, secretRef: partial.id, authKind: "api-key", ...partial };
}

describe("fallback routing", () => {
  it("skips Cursor and uses the next hop", () => {
    const snapshot: RuntimeSnapshot = {
      config: defaultConfig(),
      activeByProvider: {},
      percentByAccount: {},
      cooldownUntil: {},
    };
    snapshot.config.providersEnabled.cursor = true;
    snapshot.config.providersEnabled.deepseek = true;
    snapshot.config.routes.unshift({
      id: "all",
      enabled: true,
      match: "*",
      provider: "cursor",
      targetModel: "cursor-small",
      fallbacks: [{ provider: "deepseek", targetModel: "deepseek-chat" }],
    });
    snapshot.config.accounts = [account({ id: "d", provider: "deepseek" })];
    const plan = planRequest(snapshot, "claude-opus-4-5");
    assert.equal(plan.kind, "forward");
    if (plan.kind === "forward") {
      assert.equal(plan.provider, "deepseek");
      assert.equal(plan.model, "deepseek-chat");
      assert.equal(plan.protocol, "openai-chat");
    }
  });

  it("moves to the fallback after the primary account is avoided", () => {
    const snapshot: RuntimeSnapshot = {
      config: defaultConfig(),
      activeByProvider: { claude: "a" },
      percentByAccount: { a: 10 },
      cooldownUntil: {},
    };
    snapshot.config.providersEnabled.gemini = true;
    snapshot.config.routes.unshift({
      id: "sonnet",
      enabled: true,
      match: "*sonnet*",
      provider: "claude",
      targetModel: "claude-sonnet-4-5",
      fallbacks: [{ provider: "gemini", targetModel: "gemini-2.5-flash" }],
    });
    snapshot.config.accounts = [
      account({ id: "a", provider: "claude" }),
      account({ id: "g", provider: "gemini" }),
    ];
    const plan = planRequest(snapshot, "claude-sonnet-4-5", Date.now(), ["a"]);
    assert.equal(plan.kind, "forward");
    if (plan.kind === "forward") {
      assert.equal(plan.provider, "gemini");
      assert.equal(plan.model, "gemini-2.5-flash");
      assert.equal(messagesUrl(providerSpec("gemini")).endsWith("/chat/completions"), true);
    }
  });
});

describe("Antigravity cloud code", () => {
  it("wraps a Claude message for the daily host and never the prod host", () => {
    const body = anthropicToCloudCode(
      {
        model: "claude-sonnet-4-5",
        system: "be brief",
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "echo", description: "echo", input_schema: { type: "object" } }],
      },
      "gemini-2.5-pro",
      "project-1",
    );
    assert.equal(body.project, "project-1");
    assert.equal(body.requestType, "agent");
    assert.equal(body.userAgent, "antigravity");
    const request = body.request as { systemInstruction: { parts: Array<{ text: string }> }; tools: unknown[] };
    assert.equal(request.systemInstruction.parts[0]?.text, "be brief");
    assert.equal(request.tools.length, 1);
    const url = messagesUrl(providerSpec("antigravity"), true);
    assert.match(url, /^https:\/\/daily-cloudcode-pa\.googleapis\.com\/v1internal:streamGenerateContent/);
    assert.equal(url.startsWith("https://cloudcode-pa.googleapis.com"), false);
  });

  it("reads a generateContent response, including a function call", () => {
    const message = cloudCodeToAnthropic(
      {
        response: {
          candidates: [{ content: { parts: [{ text: "ok" }, { functionCall: { name: "echo", args: { q: 1 } } }] } }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, cachedContentTokenCount: 1 },
        },
      },
      "gemini-2.5-pro",
    );
    assert.equal(message.content[0]?.text, "ok");
    assert.equal(message.content[1]?.name, "echo");
    assert.equal(message.stop_reason, "tool_use");
    assert.equal(message.usage.input_tokens, 3);
    assert.equal(message.usage.cache_read_input_tokens, 1);
  });

  it("proxies a Claude request to the daily generateContent endpoint", async () => {
    const snapshot: RuntimeSnapshot = {
      config: defaultConfig(),
      activeByProvider: {},
      percentByAccount: {},
      cooldownUntil: {},
    };
    snapshot.config.providersEnabled.antigravity = true;
    snapshot.config.routes.unshift({
      id: "ag",
      enabled: true,
      match: "*haiku*",
      provider: "antigravity",
      targetModel: "gemini-2.5-flash",
    });
    snapshot.config.accounts = [account({ id: "g", provider: "antigravity", authKind: "oauth", externalId: "proj" })];
    let seenUrl = "";
    let seenProject = "";
    const upstream: Upstream = async (request) => {
      seenUrl = request.url;
      seenProject = (JSON.parse(request.body.toString("utf8")) as { project: string }).project;
      assert.equal(request.headers.authorization, "Bearer ya29-test");
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            response: {
              candidates: [{ content: { parts: [{ text: "from-ag" }] } }],
              usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
            },
          }),
        ),
      };
    };
    const proxy = await startProxy({
      getState: () => snapshot,
      getSecret: async () => "ya29-test",
      upstream,
      onQuota: () => undefined,
      onUsage: () => undefined,
      onSwitch: () => undefined,
      onActivity: () => undefined,
      onCooldown: () => undefined,
      rememberActive: (provider, id) => {
        snapshot.activeByProvider[provider] = id;
      },
    });
    try {
      const response = await fetch(`http://127.0.0.1:${proxy.port}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 8, messages: [{ role: "user", content: "hi" }] }),
      });
      const json = (await response.json()) as { content: Array<{ text: string }> };
      assert.equal(response.status, 200);
      assert.equal(json.content[0]?.text, "from-ag");
      assert.equal(seenUrl, "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent");
      assert.equal(seenProject, "proj");
    } finally {
      await proxy.close();
    }
  });
});

describe("Codex and Google refresh", () => {
  it("refreshes Codex with the public CLI client id and merges the auth file", () => {
    const exp = Math.floor(Date.now() / 1000) - 10;
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
    const access = `${header}.${payload}.sig`;
    assert.ok((jwtExpiryMs(access) ?? 0) < Date.now());
    const tokens = { accessToken: access, refreshToken: "refresh-codex-token", accountId: "acc" };
    assert.equal(codexNeedsRefresh(tokens), true);
    const request = codexRefreshRequest(tokens);
    assert.equal(request?.url, CODEX_OAUTH.tokenUrl);
    assert.match(request?.body ?? "", /app_EMoamEEZ73f0CkXaXp7hrann/);
    const refreshed = applyCodexRefresh(tokens, 200, JSON.stringify({ access_token: "access-new-codex", refresh_token: "refresh-new-codex" }));
    assert.equal(refreshed.tokens?.accessToken, "access-new-codex");
    const merged = mergeCodexTokens({ tokens: { access_token: access, extra: true }, other: 1 }, refreshed.tokens!);
    assert.equal((merged.tokens as { extra: boolean }).extra, true);
    assert.equal(merged.other, 1);
  });

  it("builds the Antigravity authorize URL and refreshes against Google", () => {
    const login = createGoogleLogin(() => Buffer.from("0123456789abcdef0123456789abcdef"));
    const client = { clientId: "test-client.apps.example", clientSecret: "test-client-secret" };
    const url = new URL(buildAntigravityAuthorizeUrl(login, client));
    assert.equal(url.searchParams.get("redirect_uri"), ANTIGRAVITY.redirectUri);
    assert.equal(url.searchParams.get("client_id"), client.clientId);
    const request = googleRefreshRequest({ accessToken: "ya29-old", refreshToken: "1//refresh" }, client);
    assert.equal(request?.url, ANTIGRAVITY.tokenUrl);
    assert.match(request?.body ?? "", /test-client-secret/);
    assert.equal(googleRefreshRequest({ accessToken: "ya29-old", refreshToken: "1//refresh" }, { clientId: "", clientSecret: "" }), null);
    const next = applyGoogleToken({ accessToken: "ya29-old", refreshToken: "1//refresh" }, 200, JSON.stringify({ access_token: "ya29-new", expires_in: 3600 }), 5_000);
    assert.equal(next.tokens?.accessToken, "ya29-new");
    assert.equal(next.tokens?.expiresAt, 5_000 + 3_600_000);
    assert.equal(next.tokens?.refreshToken, "1//refresh");
  });
});

describe("OpenRouter quota", () => {
  it("turns a credit limit into a percent and leaves unlimited keys without one", () => {
    assert.equal(openRouterPercent({ data: { limit: 10, usage: 4 } }).percent, 40);
    assert.equal(openRouterPercent({ data: { limit: null, usage: 4 } }).percent, null);
    assert.match(openRouterPercent({ data: { limit: null, usage: 4 } }).note ?? "", /4\.00/);
  });
});

describe("oauth loopback", () => {
  it("accepts a code on the callback path", async () => {
    const loop = await listenForOAuthCode(0, "/oauth-callback", 5_000);
    try {
      const response = await fetch(`http://127.0.0.1:${loop.port}/oauth-callback?code=abc&state=s`);
      assert.equal(response.status, 200);
      const result = await loop.done;
      assert.equal(result.code, "abc");
      assert.equal(result.state, "s");
    } finally {
      loop.close();
    }
  });
});
