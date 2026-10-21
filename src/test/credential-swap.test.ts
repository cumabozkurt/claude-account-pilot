import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  captureDisk,
  claudeCodeOwns,
  CLAUDE_KEYCHAIN_SERVICE,
  keychainPlan,
  restoreCredentialsFile,
  writeCredentialsFile,
} from "../core/credential-swap.js";
import { credentialsDocument, lineageOf } from "../core/oauth-claude.js";

describe("credential swap", () => {
  it("backs up the previous Claude Code file and can restore it", () => {
    const home = mkdtempSync(join(tmpdir(), "pilot-swap-"));
    const first = credentialsDocument({ accessToken: "access-first-token", refreshToken: "refresh-first-token" });
    writeCredentialsFile(home, first);
    const second = credentialsDocument({ accessToken: "access-second-token", refreshToken: "refresh-second-token" });
    const written = writeCredentialsFile(home, second);
    assert.match(readFileSync(written.path, "utf8"), /access-second-token/);
    assert.match(readFileSync(written.backupPath, "utf8"), /access-first-token/);
    assert.equal(restoreCredentialsFile(home), true);
    assert.match(readFileSync(written.path, "utf8"), /access-first-token/);
  });

  it("treats the on-disk lineage as owned by Claude Code", () => {
    const raw = credentialsDocument({ accessToken: "access-live-token", refreshToken: "refresh-live-token" });
    const disk = captureDisk(raw);
    assert.equal(claudeCodeOwns(lineageOf("refresh-live-token"), disk.diskLineage), true);
    assert.equal(claudeCodeOwns(lineageOf("refresh-other-token"), disk.diskLineage), false);
    assert.equal(claudeCodeOwns(undefined, disk.diskLineage), false);
  });

  it("updates the macOS keychain item and skips platforms that have no documented item", () => {
    const plan = keychainPlan("darwin", "cuma", "{\"claudeAiOauth\":{}}");
    assert.equal(plan?.command, "security");
    assert.ok(plan?.args.includes(CLAUDE_KEYCHAIN_SERVICE));
    assert.equal(keychainPlan("linux", "cuma", "{}"), null);
    assert.equal(keychainPlan("win32", "cuma", "{}"), null);
  });
});
