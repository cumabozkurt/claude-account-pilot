import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asPercent, percentUsed, windowsFromHeaders, windowsFromUsageJson, worstPercent } from "../core/quota.js";

describe("quota parsing", () => {
  it("reads fractions and whole percents", () => {
    assert.equal(asPercent("0.98"), 98);
    assert.equal(asPercent("98"), 98);
    assert.equal(asPercent(1), 100);
    assert.equal(asPercent("0"), 0);
    assert.equal(asPercent("nope"), null);
  });

  it("computes percent used from remaining and limit", () => {
    assert.equal(percentUsed(100, 2), 98);
    assert.equal(percentUsed(0, 0), null);
  });

  it("prefers 5h and 7d utilization headers", () => {
    const windows = windowsFromHeaders({
      "anthropic-ratelimit-unified-5h-utilization": "0.42",
      "anthropic-ratelimit-unified-7d-utilization": "11",
      "anthropic-ratelimit-unified-5h-reset": "2026-10-21T12:00:00Z",
      "anthropic-ratelimit-requests-limit": "100",
      "anthropic-ratelimit-requests-remaining": "10",
    });
    assert.deepEqual(
      windows.map((window) => window.label),
      ["5h", "7d", "requests"],
    );
    assert.equal(worstPercent(windows), 42);
    assert.equal(windows[0]?.resetsAt, "2026-10-21T12:00:00Z");
  });

  it("parses OAuth usage documents", () => {
    const windows = windowsFromUsageJson({
      five_hour: { utilization: 0.5, resets_at: "soon" },
      seven_day: { used_percentage: 12 },
    });
    assert.equal(windows.length, 2);
    assert.equal(worstPercent(windows), 50);
  });

  it("reads per-model weekly windows and extra usage without letting spend win the switch", () => {
    const windows = windowsFromUsageJson({
      five_hour: { utilization: 10 },
      extra_usage: { is_enabled: true, utilization: 90, resets_at: "2026-11-01T00:00:00Z" },
      limits: [{ percent: 99, resets_at: "2026-10-28T00:00:00Z", scope: { model: { display_name: "Fable" } } }],
    });
    assert.equal(windows.find((window) => window.label === "model")?.name, "Fable");
    assert.equal(windows.find((window) => window.label === "balance")?.percent, 90);
    assert.equal(worstPercent(windows), 99);
  });
});
