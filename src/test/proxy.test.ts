import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig, type Account } from "../core/types.js";
import { startProxy, type Upstream, type UpstreamRequest } from "../core/proxy.js";
import type { RuntimeSnapshot } from "../core/plan.js";

function account(partial: Partial<Account> & Pick<Account, "id" | "provider">): Account {
  return {
    label: partial.label ?? partial.id,
    enabled: true,
    secretRef: `keyring:${partial.id}`,
    authKind: "api-key",
    ...partial,
  };
}

function anthropicBody(text: string, utilization: string) {
  return {
    status: 200,
    headers: {
      "content-type": "application/json",
      "anthropic-ratelimit-unified-5h-utilization": utilization,
    },
    body: Buffer.from(
      JSON.stringify({
        id: "msg_up",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    ),
  };
}

describe("proxy", () => {
  it("rotates to the next Claude account once a response shows 99%", async () => {
    const seen: string[] = [];
    const snapshot: RuntimeSnapshot = {
      config: defaultConfig(),
      activeByProvider: {},
      percentByAccount: {},
      cooldownUntil: {},
    };
    snapshot.config.accounts = [
      account({ id: "a", provider: "claude", label: "work" }),
      account({ id: "b", provider: "claude", label: "personal" }),
    ];
    const secrets: Record<string, string> = { a: "key-a", b: "key-b" };
    const upstream: Upstream = async (request: UpstreamRequest) => {
      seen.push(request.headers["x-api-key"] ?? "");
      assert.equal(request.url, "https://api.anthropic.com/v1/messages");
      assert.equal(request.headers["x-api-key"] === "key-a" || request.headers["x-api-key"] === "key-b", true);
      const utilization = request.headers["x-api-key"] === "key-a" ? "0.99" : "0.10";
      return anthropicBody(request.headers["x-api-key"] ?? "", utilization);
    };
    const proxy = await startProxy({
      getState: () => snapshot,
      getSecret: async (item) => secrets[item.id] ?? null,
      upstream,
      onQuota: (id, percent) => {
        snapshot.percentByAccount[id] = percent;
      },
      onUsage: () => undefined,
      onSwitch: () => undefined,
      onActivity: () => undefined,
      onCooldown: (id, until) => {
        snapshot.cooldownUntil[id] = until;
      },
      rememberActive: (provider, id) => {
        snapshot.activeByProvider[provider] = id;
      },
    });
    try {
      const first = await post(proxy.port, { model: "claude-sonnet-4-5", max_tokens: 16, messages: [{ role: "user", content: "a" }] });
      const second = await post(proxy.port, { model: "claude-sonnet-4-5", max_tokens: 16, messages: [{ role: "user", content: "b" }] });
      assert.equal(JSON.parse(first).content[0].text, "key-a");
      assert.equal(JSON.parse(second).content[0].text, "key-b");
      assert.deepEqual(seen, ["key-a", "key-b"]);
      assert.equal(snapshot.percentByAccount.a, 99);
    } finally {
      await proxy.close();
    }
  });

  it("translates a Haiku request into an OpenCode Go chat completion", async () => {
    const snapshot: RuntimeSnapshot = {
      config: defaultConfig(),
      activeByProvider: {},
      percentByAccount: {},
      cooldownUntil: {},
    };
    snapshot.config.providersEnabled["opencode-go"] = true;
    snapshot.config.routes[0]!.enabled = true;
    snapshot.config.accounts = [account({ id: "go", provider: "opencode-go", label: "go" })];
    let forwarded = "";
    const upstream: Upstream = async (request) => {
      forwarded = request.url;
      const body = JSON.parse(request.body.toString("utf8")) as { model: string; messages: unknown[] };
      assert.equal(body.model, "deepseek-v4-flash");
      assert.equal(request.headers.authorization, "Bearer go-key");
      assert.equal(body.messages.length > 0, true);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            id: "chatcmpl_1",
            choices: [{ finish_reason: "stop", message: { role: "assistant", content: "deep" } }],
            usage: { prompt_tokens: 8, completion_tokens: 3 },
          }),
        ),
      };
    };
    let costModel = "";
    const proxy = await startProxy({
      getState: () => snapshot,
      getSecret: async () => "go-key",
      upstream,
      onQuota: () => undefined,
      onUsage: (_id, model, usage) => {
        costModel = model;
        assert.equal(usage.inputTokens, 8);
        assert.equal(usage.outputTokens, 3);
      },
      onSwitch: () => undefined,
      onActivity: () => undefined,
      onCooldown: () => undefined,
      rememberActive: () => undefined,
    });
    try {
      const response = await post(proxy.port, {
        model: "claude-haiku-4-5",
        max_tokens: 32,
        messages: [{ role: "user", content: "replace me" }],
      });
      const json = JSON.parse(response) as { content: Array<{ text: string }>; model: string };
      assert.equal(forwarded, "https://opencode.ai/zen/go/v1/chat/completions");
      assert.equal(json.content[0]?.text, "deep");
      assert.equal(json.model, "deepseek-v4-flash");
      assert.equal(costModel, "deepseek-v4-flash");
    } finally {
      await proxy.close();
    }
  });

  it("streams a translated response as Anthropic events", async () => {
    const snapshot: RuntimeSnapshot = {
      config: defaultConfig(),
      activeByProvider: {},
      percentByAccount: {},
      cooldownUntil: {},
    };
    snapshot.config.providersEnabled.deepseek = true;
    snapshot.config.routes[1]!.enabled = true;
    snapshot.config.routes[0]!.enabled = false;
    snapshot.config.accounts = [account({ id: "ds", provider: "deepseek" })];
    async function* chunks() {
      yield Buffer.from('data: {"choices":[{"index":0,"delta":{"content":"x"}}]}\n\n');
      yield Buffer.from('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\n');
      yield Buffer.from("data: [DONE]\n\n");
    }
    const upstream: Upstream = async (request) => {
      assert.match(request.url, /api\.deepseek\.com/);
      return { status: 200, headers: { "content-type": "text/event-stream" }, stream: chunks() };
    };
    const proxy = await startProxy({
      getState: () => snapshot,
      getSecret: async () => "ds-key",
      upstream,
      onQuota: () => undefined,
      onUsage: (_id, _model, usage) => {
        assert.equal(usage.outputTokens, 1);
      },
      onSwitch: () => undefined,
      onActivity: () => undefined,
      onCooldown: () => undefined,
      rememberActive: () => undefined,
    });
    try {
      const text = await post(proxy.port, {
        model: "claude-3-5-haiku-latest",
        max_tokens: 16,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      });
      assert.match(text, /event: message_start/);
      assert.match(text, /"text":"x"/);
      assert.match(text, /event: message_stop/);
    } finally {
      await proxy.close();
    }
  });

  it("returns a clear error instead of routing tools through Cursor", async () => {
    const snapshot: RuntimeSnapshot = {
      config: defaultConfig(),
      activeByProvider: {},
      percentByAccount: {},
      cooldownUntil: {},
    };
    snapshot.config.lang = "en";
    snapshot.config.providersEnabled.cursor = true;
    snapshot.config.routes.unshift({
      id: "cursor",
      enabled: true,
      match: "*",
      provider: "cursor",
      targetModel: "composer",
    });
    const proxy = await startProxy({
      getState: () => snapshot,
      getSecret: async () => null,
      upstream: async () => {
        throw new Error("should not call upstream");
      },
      onQuota: () => undefined,
      onUsage: () => undefined,
      onSwitch: () => undefined,
      onActivity: () => undefined,
      onCooldown: () => undefined,
      rememberActive: () => undefined,
    });
    try {
      const text = await post(proxy.port, { model: "claude-sonnet-4-5", max_tokens: 8, messages: [] }, true);
      assert.match(text.body ?? "", /no public chat API/i);
      assert.equal(text.status, 409);
    } finally {
      await proxy.close();
    }
  });
});

async function post(port: number, body: unknown, withStatus = false): Promise<string & { status?: number; body?: string }> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "pilot-local" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!withStatus) return text;
  return Object.assign(text, { status: response.status, body: text });
}
