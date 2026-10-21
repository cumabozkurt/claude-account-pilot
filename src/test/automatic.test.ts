import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { looksLikeInstaller, pickUpdateAsset, releaseAssetUrl } from "../core/auto-update.js";
import { applyAutomaticSetup, buildAutoRoutes } from "../core/bootstrap.js";
import { claudeSettingsNeedUpdate } from "../core/claude-settings.js";
import { loadConfig, saveConfig } from "../core/config.js";
import { discoverInstalls } from "../core/discover.js";
import { patchGoogleCredentialFile, parseGoogleTokens } from "../core/oauth-google.js";
import { scanMachine } from "../core/scan.js";
import { defaultConfig } from "../core/types.js";

const SECRET = "sk-test-secret-value";
const TOKEN = "ya29.test-access-token-value";

function input(home: string, files: Record<string, string>, dirs: Record<string, string[]> = {}, env: Record<string, string> = {}) {
  return { home, platform: "linux" as const, env, files, dirs, now: Date.parse("2026-10-21T12:00:00Z") };
}

describe("automatic scan", () => {
  it("imports file logins and env keys without putting secrets in the description", () => {
    const home = "/home/ada";
    const creds = JSON.stringify({
      claudeAiOauth: { accessToken: TOKEN, refreshToken: "refresh-token-value", expiresAt: Date.parse("2026-10-21T18:00:00Z") },
    });
    const codex = JSON.stringify({ tokens: { access_token: TOKEN, account_id: "acc_1" } });
    const agy = JSON.stringify({ token: { access_token: TOKEN, refresh_token: "1//refresh", expiry: "2026-10-21T18:00:00Z" }, auth_method: "consumer" });
    const opencode = JSON.stringify({
      deepseek: { type: "api", key: SECRET },
      opencode: { type: "api", key: "oc-test-key-value" },
    });
    const desktopDir = join(home, ".config", "Claude");
    const scan = scanMachine(
      input(
        home,
        {
          [join(home, ".claude", ".credentials.json")]: creds,
          [join(home, ".codex", "auth.json")]: codex,
          [join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token")]: agy,
          [join(home, ".local", "share", "opencode", "auth.json")]: opencode,
          [join(desktopDir, "config.json")]: JSON.stringify({ "oauth:tokenCache": "v10-encrypted-blob" }),
          [join(desktopDir, "host-creds-live.json")]: JSON.stringify({ env: { ANTHROPIC_API_KEY: SECRET } }),
          [join(home, ".gemini", "client.json")]: JSON.stringify({
            installed: { client_id: "123-abc.apps.googleusercontent.com", client_secret: "test-client-secret" },
          }),
        },
        { [desktopDir]: ["config.json", "host-creds-live.json"], [join(home, ".cursor")]: [] },
        { OPENROUTER_API_KEY: "sk-or-test-value", ANTHROPIC_API_KEY: "pilot-local" },
      ),
    );
    const refs = scan.accounts.map((account) => account.secretRef).sort();
    assert.deepEqual(refs, [
      "discovered:antigravity",
      "discovered:claude",
      "discovered:codex",
      "discovered:desktop:host-creds-live.json",
      "discovered:opencode:deepseek",
      "discovered:opencode:opencode",
      "env:OPENROUTER_API_KEY",
    ]);
    const described = JSON.stringify(scan.accounts.map((account) => account.detail));
    assert.equal(described.includes(SECRET), false);
    assert.equal(described.includes(TOKEN), false);
    assert.equal(described.includes("test-client-secret"), false);
    assert.equal(scan.secretValues["env:OPENROUTER_API_KEY"], "sk-or-test-value");
    assert.equal(scan.secretValues["discovered:desktop:host-creds-live.json"], SECRET);
    assert.equal(scan.googleClient?.clientId, "123-abc.apps.googleusercontent.com");
    assert.equal(scan.notes.includes("desktop-encrypted"), false);
    assert.equal(scan.notes.includes("cursor-unroutable"), true);
    assert.equal(scan.notes.includes("antigravity-no-client"), false);
  });

  it("reports an encrypted Claude Desktop session and a missing Antigravity client", () => {
    const home = "/home/ada";
    const dir = join(home, ".config", "Claude");
    const scan = scanMachine(
      input(home, {
        [join(dir, "config.json")]: JSON.stringify({ "oauth:tokenCache": "v10-encrypted" }),
        [join(home, ".gemini", "antigravity-cli", "antigravity-oauth-token")]: JSON.stringify({
          token: { access_token: TOKEN, expiry: "2026-10-21T18:00:00Z" },
        }),
      }, { [dir]: ["config.json"] }),
    );
    assert.equal(scan.notes.includes("desktop-encrypted"), true);
    assert.equal(scan.notes.includes("antigravity-no-client"), true);
    assert.equal(scan.accounts.some((account) => account.secretRef === "discovered:antigravity"), true);
  });

  it("does not import the local proxy placeholder as an account", () => {
    const home = "/home/ada";
    const scan = scanMachine(
      input(home, {}, {}, { ANTHROPIC_API_KEY: "pilot-local", DEEPSEEK_API_KEY: "short" }),
    );
    assert.equal(scan.accounts.length, 0);
  });
});

describe("automatic routes", () => {
  it("sends Haiku off Claude and leaves other models on Claude", () => {
    const routes = buildAutoRoutes(["claude", "deepseek", "openrouter"]);
    assert.equal(routes.length, 1);
    assert.equal(routes[0]?.match, "*haiku*");
    assert.equal(routes[0]?.provider, "deepseek");
    assert.equal(routes[0]?.targetModel, "deepseek-chat");
    assert.deepEqual(routes[0]?.fallbacks, [
      { provider: "openrouter", targetModel: "deepseek/deepseek-chat" },
      { provider: "claude", targetModel: "claude-haiku-4-5" },
    ]);
  });

  it("covers every model when Claude itself was not found", () => {
    const routes = buildAutoRoutes(["opencode-go"]);
    assert.equal(routes[0]?.match, "*");
    assert.equal(routes[0]?.provider, "opencode-go");
  });

  it("leaves Claude traffic alone when Claude is the only account", () => {
    assert.deepEqual(buildAutoRoutes(["claude"]), []);
  });

  it("imports once, keeps a disabled account off, and does not revive a dismissed login", () => {
    const config = defaultConfig();
    config.setupRevision = 0;
    config.launchAtLogin = false;
    const found = [
      {
        provider: "deepseek" as const,
        label: "DeepSeek",
        secretRef: "env:DEEPSEEK_API_KEY",
        authKind: "api-key" as const,
        detail: "DEEPSEEK_API_KEY",
      },
      {
        provider: "claude" as const,
        label: "Claude Code",
        secretRef: "discovered:claude",
        authKind: "oauth" as const,
        detail: "~/.claude/.credentials.json",
      },
    ];
    const first = applyAutomaticSetup(config, found);
    assert.equal(first.upgraded, true);
    assert.equal(first.added, 2);
    assert.equal(config.launchAtLogin, true);
    assert.equal(config.routes[0]?.id, "auto-haiku");
    const claude = config.accounts.find((account) => account.secretRef === "discovered:claude");
    assert.ok(claude);
    claude.enabled = false;
    config.dismissedRefs.push("env:DEEPSEEK_API_KEY");
    config.accounts = config.accounts.filter((account) => account.secretRef !== "env:DEEPSEEK_API_KEY");
    const second = applyAutomaticSetup(config, found);
    assert.equal(second.added, 0);
    assert.equal(config.accounts.find((account) => account.secretRef === "discovered:claude")?.enabled, false);
    assert.equal(config.accounts.some((account) => account.secretRef === "env:DEEPSEEK_API_KEY"), false);
  });

  it("does not replace routes a person already edited", () => {
    const config = defaultConfig();
    config.setupRevision = 0;
    config.routes = [{ id: "mine", enabled: true, match: "*opus*", provider: "openrouter", targetModel: "custom" }];
    applyAutomaticSetup(config, [
      { provider: "claude", label: "Claude", secretRef: "discovered:claude", authKind: "oauth", detail: "file" },
    ]);
    assert.equal(config.routesManaged, false);
    assert.equal(config.routes[0]?.id, "mine");
  });
});

describe("settings drift", () => {
  it("notices when the proxy address was removed", () => {
    const home = mkdtempSync(join(tmpdir(), "pilot-drift-"));
    mkdirSync(join(home, ".claude"), { recursive: true });
    assert.equal(claudeSettingsNeedUpdate(home, "http://127.0.0.1:15721"), true);
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:15721", ANTHROPIC_API_KEY: "pilot-local" } }),
    );
    assert.equal(claudeSettingsNeedUpdate(home, "http://127.0.0.1:15721"), false);
    assert.equal(claudeSettingsNeedUpdate(home, "http://127.0.0.1:9"), true);
  });
});

describe("update asset", () => {
  it("accepts only this repo's matching installer", () => {
    const version = "1.1.0";
    const name = "Claude.Account.Pilot-1.1.0-mac-arm64.zip";
    const url = releaseAssetUrl(version, name);
    const picked = pickUpdateAsset(version, "mac-zip", "arm64", [{ name, browser_download_url: url }]);
    assert.equal(picked?.url, url);
    assert.equal(pickUpdateAsset(version, "mac-zip", "arm64", [{ name, browser_download_url: "https://evil.example/app.zip" }]), null);
    assert.equal(pickUpdateAsset(version, null, "x64", [{ name, browser_download_url: url }]), null);
    const bytes = new Uint8Array(1_000_000);
    bytes[0] = 0x50;
    bytes[1] = 0x4b;
    assert.equal(looksLikeInstaller("mac-zip", bytes), true);
    bytes[0] = 0x3c;
    assert.equal(looksLikeInstaller("mac-zip", bytes), false);
  });
});

describe("google credential file", () => {
  it("refreshes an Antigravity envelope without dropping the other fields", () => {
    const raw = JSON.stringify({ auth_method: "consumer", token: { access_token: "old-access-token", refresh_token: "1//keep", expiry: "2020-01-01T00:00:00Z" } });
    const tokens = parseGoogleTokens(JSON.parse(raw) as unknown);
    assert.equal(tokens?.refreshToken, "1//keep");
    assert.ok(tokens);
    const next = patchGoogleCredentialFile(raw, { ...tokens, accessToken: "new-access-token-value", expiresAt: Date.parse("2026-10-21T13:00:00Z") });
    const parsed = JSON.parse(next) as { auth_method: string; token: { access_token: string; refresh_token: string } };
    assert.equal(parsed.auth_method, "consumer");
    assert.equal(parsed.token.access_token, "new-access-token-value");
    assert.equal(parsed.token.refresh_token, "1//keep");
  });
});

describe("config upgrade fields", () => {
  it("keeps an explicit launch-at-login choice and defaults a new file to on", () => {
    const dir = mkdtempSync(join(tmpdir(), "pilot-auto-config-"));
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ version: 1, launchAtLogin: false, accounts: [] }));
    const old = loadConfig(path);
    assert.equal(old.launchAtLogin, false);
    assert.equal(old.setupRevision, 0);
    assert.equal(old.routesManaged, false);
    const fresh = defaultConfig();
    saveConfig(path, fresh);
    assert.equal(loadConfig(path).launchAtLogin, true);
    assert.equal(loadConfig(path).autoUpdate, true);
    const raw = readFileSync(path, "utf8");
    assert.equal(raw.includes("test-client-secret"), false);
  });
});
