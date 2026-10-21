import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig, type Account } from "../core/types.js";
import { planRequest, type RuntimeSnapshot } from "../core/plan.js";

function account(partial: Partial<Account> & Pick<Account, "id" | "provider">): Account {
  return {
    label: partial.id,
    enabled: true,
    secretRef: `keyring:${partial.id}`,
    authKind: "api-key",
    ...partial,
  };
}

function state(setup: (snapshot: RuntimeSnapshot) => void): RuntimeSnapshot {
  const snapshot: RuntimeSnapshot = {
    config: defaultConfig(),
    activeByProvider: {},
    percentByAccount: {},
    cooldownUntil: {},
  };
  setup(snapshot);
  return snapshot;
}

describe("planRequest", () => {
  it("keeps a Claude model on the account under 98%", () => {
    const snapshot = state((current) => {
      current.config.accounts = [
        account({ id: "a", provider: "claude" }),
        account({ id: "b", provider: "claude" }),
      ];
      current.percentByAccount = { a: 99, b: 10 };
      current.activeByProvider.claude = "a";
    });
    const plan = planRequest(snapshot, "claude-sonnet-4-5");
    assert.equal(plan.kind, "forward");
    if (plan.kind === "forward") {
      assert.equal(plan.account.id, "b");
      assert.equal(plan.model, "claude-sonnet-4-5");
      assert.equal(plan.switched, true);
    }
  });

  it("sends a matching Haiku request to OpenCode Go DeepSeek", () => {
    const snapshot = state((current) => {
      current.config.providersEnabled["opencode-go"] = true;
      current.config.routes[0]!.enabled = true;
      current.config.accounts = [
        account({ id: "c", provider: "claude" }),
        account({ id: "d", provider: "opencode-go" }),
      ];
    });
    const plan = planRequest(snapshot, "claude-haiku-4-5");
    assert.equal(plan.kind, "forward");
    if (plan.kind === "forward") {
      assert.equal(plan.provider, "opencode-go");
      assert.equal(plan.protocol, "openai-chat");
      assert.equal(plan.model, "deepseek-v4-flash");
    }
  });

  it("does not rewrite traffic when the route is off", () => {
    const snapshot = state((current) => {
      current.config.providersEnabled["opencode-go"] = true;
      current.config.accounts = [account({ id: "c", provider: "claude" })];
    });
    const plan = planRequest(snapshot, "claude-haiku-4-5");
    assert.equal(plan.kind, "forward");
    if (plan.kind === "forward") assert.equal(plan.provider, "claude");
  });

  it("refuses Cursor routing instead of pretending the call succeeded", () => {
    const snapshot = state((current) => {
      current.config.providersEnabled.cursor = true;
      current.config.routes.unshift({
        id: "all-cursor",
        enabled: true,
        match: "*",
        provider: "cursor",
        targetModel: "composer",
      });
    });
    const plan = planRequest(snapshot, "claude-sonnet-4-5");
    assert.deepEqual(plan, { kind: "unsupported", provider: "cursor" });
  });
});
