import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildExport } from "../core/export-data.js";
import { appendLog } from "../core/log-file.js";
import { compareVersions, newerRelease } from "../core/update-check.js";
import { defaultConfig } from "../core/types.js";
import { emptyLedger } from "../core/ledger.js";

describe("export", () => {
  it("drops secret handles and refresh fingerprints", () => {
    const config = defaultConfig();
    config.accounts.push({
      id: "a",
      provider: "claude",
      label: "work",
      enabled: true,
      secretRef: "sk-live-secret",
      authKind: "oauth",
      lineage: "sha256-of-refresh",
      email: "a@example.com",
    });
    const text = buildExport({
      version: "1.0.0",
      config,
      ledger: emptyLedger(),
      history: [],
      activity: [{ at: "2026-10-21T00:00:00Z", key: "log.request", vars: { requested: "haiku" } }],
    });
    assert.equal(text.includes("sk-live-secret"), false);
    assert.equal(text.includes("sha256-of-refresh"), false);
    assert.match(text, /a@example.com/);
    assert.match(text, /haiku/);
  });
});

describe("updates", () => {
  it("compares versions and ignores the current release", () => {
    assert.equal(compareVersions("1.0.0", "0.5.0") > 0, true);
    assert.equal(compareVersions("v0.9.0", "0.10.0") < 0, true);
    assert.equal(newerRelease("1.0.0", { tag_name: "v1.0.0", html_url: "https://example.test/r" }), null);
    assert.deepEqual(newerRelease("0.5.0", { tag_name: "v1.0.0", html_url: "https://example.test/r" }), {
      version: "1.0.0",
      url: "https://example.test/r",
    });
  });
});

describe("log file", () => {
  it("appends a line the owner can read back", () => {
    const dir = mkdtempSync(join(tmpdir(), "pilot-log-"));
    const path = join(dir, "pilot.log");
    appendLog(path, "proxy listening");
    assert.match(readFileSync(path, "utf8"), /proxy listening/);
    assert.ok(statSync(path).size > 0);
  });
});
