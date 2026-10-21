import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appendSample, usageByDay, usageByModel, type QuotaSample } from "../core/history.js";

describe("quota history", () => {
  it("skips a sample that did not move and is inside five minutes", () => {
    const first: QuotaSample = { at: "2026-10-21T10:00:00.000Z", accountId: "a", percent: 10, windows: [] };
    const quiet: QuotaSample = { at: "2026-10-21T10:02:00.000Z", accountId: "a", percent: 10.4, windows: [] };
    const moved: QuotaSample = { at: "2026-10-21T10:02:00.000Z", accountId: "a", percent: 12, windows: [] };
    assert.equal(appendSample([first], quiet).length, 1);
    assert.equal(appendSample([first], moved).length, 2);
  });

  it("keeps the newest samples per account", () => {
    const samples: QuotaSample[] = [];
    let series = samples;
    for (let i = 0; i < 5; i += 1) {
      series = appendSample(
        series,
        { at: new Date(Date.UTC(2026, 9, 21, 10, i * 10)).toISOString(), accountId: "a", percent: i, windows: [] },
        Date.now(),
        3,
      );
    }
    assert.deepEqual(series.map((sample) => sample.percent), [2, 3, 4]);
  });

  it("rolls tokens and cost up by day and by model", () => {
    const rows = [
      { day: "2026-10-21", model: "claude-haiku", inputTokens: 10, outputTokens: 5, costUsd: 0.1, requests: 1 },
      { day: "2026-10-21", model: "deepseek-chat", inputTokens: 4, outputTokens: 4, costUsd: 0.2, requests: 2 },
      { day: "2026-10-22", model: "claude-haiku", inputTokens: 1, outputTokens: 1, costUsd: 0.05, requests: 1 },
    ];
    const days = usageByDay(rows);
    assert.equal(days[0]?.requests, 3);
    assert.equal(days[0]?.costUsd, 0.3);
    assert.equal(days[1]?.day, "2026-10-22");
    const models = usageByModel(rows);
    assert.equal(models[0]?.model, "deepseek-chat");
    assert.equal(models[1]?.inputTokens, 11);
  });
});
