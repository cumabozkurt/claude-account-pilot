import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bindingReset, evaluateAlerts, formatCountdown, percentAfterReset } from "../core/monitor.js";

describe("quota monitor", () => {
  it("notifies once when a window crosses the threshold and again after it recovers", () => {
    const first = evaluateAlerts(
      [{ id: "a", label: "work", enabled: true, previousPercent: 90, percent: 98.2, resetsAt: "2026-10-21T12:00:00.000Z" }],
      98,
      {},
      Date.parse("2026-10-21T10:00:00.000Z"),
    );
    assert.equal(first.alerts[0]?.kind, "threshold");
    const again = evaluateAlerts(
      [{ id: "a", label: "work", enabled: true, previousPercent: 98.2, percent: 99, resetsAt: "2026-10-21T12:00:00.000Z" }],
      98,
      first.seen,
    );
    assert.equal(again.alerts.length, 0);
    const recovered = evaluateAlerts(
      [{ id: "a", label: "work", enabled: true, previousPercent: 99, percent: 10 }],
      98,
      again.seen,
    );
    assert.equal(recovered.seen["a:threshold"], undefined);
  });

  it("warns once when the binding window resets within 15 minutes", () => {
    const now = Date.parse("2026-10-21T11:50:00.000Z");
    const result = evaluateAlerts(
      [{ id: "a", label: "work", enabled: true, previousPercent: 99, percent: 99, resetsAt: "2026-10-21T12:00:00.000Z" }],
      98,
      { "a:threshold": true },
      now,
    );
    assert.equal(result.alerts.some((alert) => alert.kind === "reset-soon"), true);
    assert.equal(formatCountdown("2026-10-21T12:00:00.000Z", now), "10m");
  });

  it("drops a window after its reset time so the account is usable before the next probe", () => {
    const now = Date.parse("2026-10-21T12:00:01.000Z");
    const released = percentAfterReset(
      [
        { label: "5h", percent: 100, resetsAt: "2026-10-21T12:00:00.000Z" },
        { label: "7d", percent: 40, resetsAt: "2026-10-28T00:00:00.000Z" },
      ],
      now,
    );
    assert.equal(released.percent, 40);
    assert.equal(released.windows.length, 1);
    assert.equal(bindingReset(released.windows), "2026-10-28T00:00:00.000Z");
  });

  it("announces a full pool once", () => {
    const accounts = [
      { id: "a", label: "a", enabled: true, previousPercent: 99, percent: 99 },
      { id: "b", label: "b", enabled: true, previousPercent: 99, percent: 100 },
    ];
    const first = evaluateAlerts(accounts, 98, {});
    assert.equal(first.alerts.some((alert) => alert.kind === "pool-full"), true);
    const second = evaluateAlerts(accounts, 98, first.seen);
    assert.equal(second.alerts.some((alert) => alert.kind === "pool-full"), false);
  });
});