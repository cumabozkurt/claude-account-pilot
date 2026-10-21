import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadRuntime, saveRuntime } from "../core/runtime-file.js";

describe("runtime file", () => {
  it("restores quota and activity and refuses to keep a secret-looking extra", () => {
    const dir = mkdtempSync(join(tmpdir(), "pilot-runtime-"));
    const path = join(dir, "runtime.json");
    saveRuntime(path, {
      version: 1,
      activeByProvider: { claude: "acc-1" },
      percentByAccount: { "acc-1": 42 },
      quotas: {
        "acc-1": { windows: [{ label: "5h", percent: 42 }], percent: 42, source: "headers" },
      },
      activity: [{ at: "2026-10-21T00:00:00Z", key: "log.request", vars: { requested: "haiku", target: "haiku", provider: "claude", account: "work" } }],
      history: [],
      alertSeen: [],
    });
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes("sk-"), false);
    const loaded = loadRuntime(path);
    assert.equal(loaded.activeByProvider.claude, "acc-1");
    assert.equal(loaded.percentByAccount["acc-1"], 42);
    assert.equal(loaded.quotas["acc-1"]?.windows[0]?.label, "5h");
    assert.equal(loaded.activity.length, 1);
    assert.equal(loadRuntime(join(dir, "missing.json")).activity.length, 0);
  });
});