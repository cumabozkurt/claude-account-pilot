import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateCostUsd } from "../core/cost.js";

describe("estimateCostUsd", () => {
  it("prices haiku and deepseek differently", () => {
    const haiku = estimateCostUsd("claude-haiku-4-5", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const deepseek = estimateCostUsd("deepseek-v4-flash", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    assert.equal(haiku, 1);
    assert.equal(deepseek, 0.42);
  });

  it("includes cache tokens", () => {
    const cost = estimateCostUsd("claude-sonnet-4-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    });
    assert.equal(cost, 0.3);
  });
});
