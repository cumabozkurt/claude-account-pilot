import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { applyClaudeBaseUrl, claudeEnvSnippet, LOCAL_CLIENT_KEY, restoreClaudeSettings } from "../core/claude-settings.js";
import { loadConfig, saveConfig } from "../core/config.js";
import { discoverInstalls } from "../core/discover.js";
import { defaultConfig } from "../core/types.js";
import { detectLang, I18N } from "../core/i18n.js";
import { recordUsage, emptyLedger } from "../core/ledger.js";

describe("language", () => {
  it("follows Turkish locales and otherwise uses English", () => {
    assert.equal(detectLang("tr-TR"), "tr");
    assert.equal(detectLang("tr"), "tr");
    assert.equal(detectLang("en-US"), "en");
    assert.equal(detectLang(""), "en");
    assert.deepEqual(Object.keys(I18N.en).sort(), Object.keys(I18N.tr).sort());
  });
});

describe("config", () => {
  it("round-trips without ever writing a secret field", () => {
    const dir = mkdtempSync(join(tmpdir(), "pilot-config-"));
    const path = join(dir, "config.json");
    const config = defaultConfig();
    config.lang = "tr";
    config.accounts.push({
      id: "a",
      provider: "claude",
      label: "work",
      enabled: true,
      secretRef: "keyring:a",
      authKind: "api-key",
    });
    saveConfig(path, config);
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes("sk-"), false);
    const loaded = loadConfig(path);
    assert.equal(loaded.lang, "tr");
    assert.equal(loaded.accounts[0]?.secretRef, "keyring:a");
    assert.equal(loadConfig(join(dir, "missing.json")).proxyPort, 15721);
  });
});

describe("claude settings", () => {
  it("points Claude Code at the proxy and can restore the backup", () => {
    const home = mkdtempSync(join(tmpdir(), "pilot-home-"));
    const settingsDir = join(home, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      join(settingsDir, "settings.json"),
      JSON.stringify({ theme: "dark", env: { ANTHROPIC_API_KEY: "sk-real", OTHER: "keep" } }),
    );
    applyClaudeBaseUrl(home, "http://127.0.0.1:15721");
    const doc = JSON.parse(readFileSync(join(settingsDir, "settings.json"), "utf8")) as {
      theme: string;
      env: Record<string, string>;
    };
    assert.equal(doc.theme, "dark");
    assert.equal(doc.env.OTHER, "keep");
    assert.equal(doc.env.ANTHROPIC_API_KEY, "sk-real");
    assert.equal(doc.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:15721");
    assert.match(claudeEnvSnippet("http://127.0.0.1:15721"), new RegExp(LOCAL_CLIENT_KEY));
    restoreClaudeSettings(home);
    const restored = JSON.parse(readFileSync(join(settingsDir, "settings.json"), "utf8")) as { env: Record<string, string> };
    assert.equal(restored.env.ANTHROPIC_BASE_URL, undefined);
    assert.equal(restored.env.ANTHROPIC_API_KEY, "sk-real");
  });
});

describe("discover", () => {
  it("imports nothing secret into the description and finds a Codex login", () => {
    const home = mkdtempSync(join(tmpdir(), "pilot-discover-"));
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "auth.json"),
      JSON.stringify({ tokens: { access_token: "secret-token-value", account_id: "acc" } }),
    );
    const found = discoverInstalls(home);
    const codex = found.find((item) => item.provider === "codex");
    assert.equal(codex?.canImport, true);
    assert.equal(JSON.stringify(found).includes("secret-token-value"), false);
    assert.equal(found.some((item) => item.provider === "cursor" && item.canImport === false), true);
  });
});

describe("ledger", () => {
  it("adds tokens and estimated cost per account", () => {
    const ledger = emptyLedger();
    const entry = recordUsage(ledger, "a", "claude-haiku-4-5", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    assert.equal(entry.costUsd, 1);
    assert.equal(entry.requests, 1);
    const again = recordUsage(ledger, "a", "claude-haiku-4-5", {
      inputTokens: 0,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    assert.equal(again.inputTokens, 1_000_000);
    assert.equal(again.costUsd, 6);
  });
});
