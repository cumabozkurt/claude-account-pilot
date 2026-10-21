import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickAccount } from "../core/rotate.js";

describe("pickAccount", () => {
  const now = 1_000_000;

  it("stays on the active account while it is under the threshold", () => {
    const decision = pickAccount(
      [
        { id: "a", enabled: true, percent: 97.9 },
        { id: "b", enabled: true, percent: 1 },
      ],
      "a",
      98,
      now,
    );
    assert.equal(decision.id, "a");
    assert.equal(decision.switched, false);
    assert.equal(decision.reason, "sticky");
  });

  it("switches to the next available account at 98%", () => {
    const decision = pickAccount(
      [
        { id: "a", enabled: true, percent: 98 },
        { id: "b", enabled: true, percent: 10 },
        { id: "c", enabled: true, percent: 0 },
      ],
      "a",
      98,
      now,
    );
    assert.equal(decision.id, "b");
    assert.equal(decision.switched, true);
    assert.equal(decision.reason, "next-available");
  });

  it("wraps around and skips disabled accounts", () => {
    const decision = pickAccount(
      [
        { id: "a", enabled: true, percent: 99 },
        { id: "b", enabled: false, percent: 0 },
        { id: "c", enabled: true, percent: 20 },
      ],
      "a",
      98,
      now,
    );
    assert.equal(decision.id, "c");
  });

  it("does not treat an unknown percent as full", () => {
    const decision = pickAccount(
      [
        { id: "a", enabled: true, percent: null },
        { id: "b", enabled: true, percent: 10 },
      ],
      "a",
      98,
      now,
    );
    assert.equal(decision.id, "a");
    assert.equal(decision.reason, "sticky");
  });

  it("skips a short cooldown without declaring the quota full", () => {
    const decision = pickAccount(
      [
        { id: "a", enabled: true, percent: 10, cooldownUntil: now + 1000 },
        { id: "b", enabled: true, percent: 40 },
      ],
      "a",
      98,
      now,
    );
    assert.equal(decision.id, "b");
    assert.equal(decision.reason, "next-available");
  });

  it("picks the least-used account when every account is at the threshold", () => {
    const decision = pickAccount(
      [
        { id: "b", enabled: true, percent: 99 },
        { id: "a", enabled: true, percent: 98 },
      ],
      "b",
      98,
      now,
    );
    assert.equal(decision.id, "a");
    assert.equal(decision.reason, "all-hot-least-used");
  });

  it("starts at the first account when nothing is active yet", () => {
    const decision = pickAccount(
      [
        { id: "a", enabled: true, percent: 0 },
        { id: "b", enabled: true, percent: 0 },
      ],
      null,
      98,
      now,
    );
    assert.equal(decision.id, "a");
    assert.equal(decision.switched, true);
  });

  it("returns none when every account is off", () => {
    const decision = pickAccount([{ id: "a", enabled: false, percent: 0 }], null, 98, now);
    assert.equal(decision.id, null);
    assert.equal(decision.reason, "none");
  });
});
