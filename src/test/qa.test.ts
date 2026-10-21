import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  fetchReleaseBytes,
  macAppBundle,
  redirectAllowed,
  releaseAssetUrl,
  windowsSwapScript,
  type ManualResponse,
} from "../core/auto-update.js";
import { applyClaudeBaseUrl, claudeSettingsNeedUpdate, restoreClaudeSettings } from "../core/claude-settings.js";
import { loadConfig, quarantineConfig, saveConfig } from "../core/config.js";
import { percentAfterReset } from "../core/monitor.js";
import { detectLang } from "../core/i18n.js";
import { scanHome, scanMachine } from "../core/scan.js";
import { singleFlight } from "../core/single-flight.js";
import { defaultConfig } from "../core/types.js";
import { startProxy, type Upstream } from "../core/proxy.js";
import type { Account } from "../core/types.js";
import type { RuntimeSnapshot } from "../core/plan.js";

describe("token refresh single-flight", () => {
  it("runs one refresh when many callers share a key", async () => {
    const run = singleFlight();
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = run("codex", async () => {
      calls += 1;
      await gate;
      return "access-1";
    });
    const second = run("codex", async () => {
      calls += 1;
      return "access-2";
    });
    const other = run("google", async () => {
      calls += 1;
      return "other";
    });
    release();
    assert.equal(await first, "access-1");
    assert.equal(await second, "access-1");
    assert.equal(await other, "other");
    assert.equal(calls, 2);
    assert.equal(await run("codex", async () => "access-3"), "access-3");
  });
});

describe("settings recovery", () => {
  it("puts a drifted proxy address back and restores the backup", () => {
    const home = mkdtempSync(join(tmpdir(), "pilot-qa-home-"));
    const settings = join(home, ".claude", "settings.json");
    mkdirSync(join(home, ".claude"), { recursive: true });
    const original = `${JSON.stringify({ theme: "qa", env: { KEEP: "yes" } }, null, 2)}\n`;
    writeFileSync(settings, original);
    applyClaudeBaseUrl(home, "http://127.0.0.1:15721");
    const drifted = JSON.parse(readFileSync(settings, "utf8")) as { env: Record<string, string> };
    drifted.env.ANTHROPIC_BASE_URL = "https://example.invalid";
    writeFileSync(settings, JSON.stringify(drifted));
    assert.equal(claudeSettingsNeedUpdate(home, "http://127.0.0.1:15721"), true);
    applyClaudeBaseUrl(home, "http://127.0.0.1:15721");
    const repaired = JSON.parse(readFileSync(settings, "utf8")) as { env: Record<string, string> };
    assert.equal(repaired.env.ANTHROPIC_BASE_URL, "http://127.0.0.1:15721");
    assert.equal(repaired.env.KEEP, "yes");
    assert.equal(restoreClaudeSettings(home), true);
    assert.equal(readFileSync(settings, "utf8"), original);
  });

  it("refuses a settings symlink and a directory symlink that leaves the home", { skip: process.platform === "win32" }, () => {
    const home = mkdtempSync(join(tmpdir(), "pilot-qa-link-"));
    const outside = mkdtempSync(join(tmpdir(), "pilot-qa-outside-"));
    const outsideFile = join(outside, "settings.json");
    writeFileSync(outsideFile, '{"env":{"SECRET":"do-not-touch"}}\n');
    mkdirSync(join(home, ".claude"), { recursive: true });
    symlinkSync(outsideFile, join(home, ".claude", "settings.json"));
    assert.throws(() => applyClaudeBaseUrl(home, "http://127.0.0.1:1"), /symlink/);
    assert.match(readFileSync(outsideFile, "utf8"), /do-not-touch/);

    const home2 = mkdtempSync(join(tmpdir(), "pilot-qa-dirlink-"));
    symlinkSync(outside, join(home2, ".claude"));
    assert.throws(() => applyClaudeBaseUrl(home2, "http://127.0.0.1:1"), /symlink/);
    assert.equal(readFileSync(outsideFile, "utf8").includes("ANTHROPIC_BASE_URL"), false);
  });

  it("refuses a hard link to a file outside the home", { skip: process.platform === "win32" }, () => {
    const home = mkdtempSync(join(tmpdir(), "pilot-qa-hard-"));
    const outside = mkdtempSync(join(tmpdir(), "pilot-qa-hard-out-"));
    const outsideFile = join(outside, "settings.json");
    writeFileSync(outsideFile, "{\"keep\":true}\n");
    mkdirSync(join(home, ".claude"), { recursive: true });
    linkSync(outsideFile, join(home, ".claude", "settings.json"));
    assert.throws(() => applyClaudeBaseUrl(home, "http://127.0.0.1:1"), /hard-linked/);
    assert.equal(readFileSync(outsideFile, "utf8").includes("ANTHROPIC_BASE_URL"), false);
  });

  it("quarantines a corrupt config instead of parsing it as settings", () => {
    const dir = mkdtempSync(join(tmpdir(), "pilot-qa-config-"));
    const path = join(dir, "config.json");
    writeFileSync(path, "{ this is not json");
    assert.equal(quarantineConfig(path), "quarantined");
    assert.equal(loadConfig(path).proxyPort, 15721);
    assert.match(readFileSync(`${path}.broken`, "utf8"), /not json/);
    const config = defaultConfig();
    config.lang = "tr";
    saveConfig(path, config);
    assert.equal(loadConfig(path).lang, "tr");
    config.lang = "en";
    saveConfig(path, config);
    assert.equal(loadConfig(path).lang, "en");
    assert.equal(detectLang("tr_TR.UTF-8"), "tr");
    assert.equal(detectLang("en-GB"), "en");
  });
});

describe("discovery of missing and corrupt files", () => {
  it("imports nothing and does not throw", () => {
    const home = mkdtempSync(join(tmpdir(), "pilot-qa-scan-"));
    mkdirSync(join(home, ".codex"), { recursive: true });
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".gemini"), { recursive: true });
    writeFileSync(join(home, ".codex", "auth.json"), "{not-json");
    writeFileSync(join(home, ".claude", ".credentials.json"), "");
    writeFileSync(join(home, ".gemini", "oauth_creds.json"), "[]");
    const scan = scanHome(home, "linux", { ANTHROPIC_API_KEY: "pilot-local", OPENAI_API_KEY: "${MISSING}" });
    assert.equal(scan.accounts.length, 0);
    assert.equal(JSON.stringify(scan).includes("not-json"), false);
    const missing = scanMachine({
      home,
      platform: "linux",
      env: {},
      files: {},
      dirs: {},
    });
    assert.deepEqual(missing.accounts, []);
    assert.equal(missing.googleClient, null);
  });
});

describe("reset windows", () => {
  it("drops a window whose reset time has passed", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const released = percentAfterReset(
      [
        { label: "5h", percent: 99, resetsAt: "2026-10-21T11:00:00Z" },
        { label: "7d", percent: 40, resetsAt: "2026-10-28T00:00:00Z" },
      ],
      now,
    );
    assert.equal(released.windows.length, 1);
    assert.equal(released.percent, 40);
  });
});

describe("update integrity", () => {
  it("rejects a redirect off GitHub and a mac path that is not the running bundle", async () => {
    assert.equal(
      redirectAllowed(
        "https://github.com/cumabozkurt/claude-account-pilot/releases/download/v9.9.9/file",
        "https://objects.githubusercontent.com/github-production-release-asset/1",
      ),
      "https://objects.githubusercontent.com/github-production-release-asset/1",
    );
    assert.equal(redirectAllowed("https://github.com/cumabozkurt/claude-account-pilot/releases/download/v9.9.9/file", "https://evil.example/file"), null);
    assert.equal(redirectAllowed("https://github.com/cumabozkurt/claude-account-pilot/releases/download/v9.9.9/file", "http://objects.githubusercontent.com/file"), null);
    const calls: string[] = [];
    const bytes = await fetchReleaseBytes("https://github.com/cumabozkurt/claude-account-pilot/releases/download/v9.9.9/app", async (url) => {
      calls.push(url);
      if (calls.length === 1) {
        return response(302, { location: "https://evil.example/app" }, new Uint8Array());
      }
      return response(200, {}, new Uint8Array([1, 2, 3]));
    });
    assert.equal(bytes, null);
    assert.equal(calls.length, 1);
    const good = await fetchReleaseBytes(releaseAssetUrl("9.9.9", "Claude.Account.Pilot-9.9.9-linux-x86_64.AppImage"), async (url) => {
      if (url.includes("github.com/cumabozkurt")) {
        return response(302, { location: "https://release-assets.githubusercontent.com/asset" }, new Uint8Array());
      }
      return response(200, {}, Uint8Array.from([7, 8]));
    });
    assert.deepEqual(Array.from(good ?? []), [7, 8]);
    assert.equal(
      macAppBundle("/tmp/Decoy.app/Contents/MacOS/Claude Account Pilot.app/Contents/MacOS/Claude Account Pilot"),
      "/tmp/Decoy.app/Contents/MacOS/Claude Account Pilot.app",
    );
    assert.equal(macAppBundle("/Applications/Claude Account Pilot.app/Contents/MacOS/Claude Account Pilot"), "/Applications/Claude Account Pilot.app");
    assert.equal(macAppBundle("/tmp/Claude Account Pilot.app/MacOS/bin"), null);
    const script = windowsSwapScript("C:\\updates\\app.exe", "C:\\Apps\\Pilot.exe");
    assert.match(script, /move \/Y "C:\\updates\\app.exe" "C:\\Apps\\Pilot.exe"/);
    assert.throws(() => windowsSwapScript("C:\\a&b.exe", "C:\\c.exe"), /unsafe/);
  });
});

describe("translated tool call", () => {
  it("sends a function tool and reads the tool call back", async () => {
    const snapshot: RuntimeSnapshot = {
      config: defaultConfig(),
      activeByProvider: {},
      percentByAccount: {},
      cooldownUntil: {},
    };
    snapshot.config.providersEnabled.deepseek = true;
    snapshot.config.routes[1]!.enabled = true;
    snapshot.config.routes[0]!.enabled = false;
    const account: Account = {
      id: "ds",
      provider: "deepseek",
      label: "ds",
      enabled: true,
      secretRef: "keyring:ds",
      authKind: "api-key",
    };
    snapshot.config.accounts = [account];
    const upstream: Upstream = async (request) => {
      const body = JSON.parse(request.body.toString("utf8")) as { tools?: Array<{ function?: { name?: string } }> };
      assert.equal(body.tools?.[0]?.function?.name, "get_weather");
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(
          JSON.stringify({
            id: "chatcmpl_tool",
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Ankara\"}" } }],
                },
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 2 },
          }),
        ),
      };
    };
    const proxy = await startProxy({
      getState: () => snapshot,
      getSecret: async () => "ds-key",
      upstream,
      onQuota: () => undefined,
      onUsage: () => undefined,
      onSwitch: () => undefined,
      onActivity: () => undefined,
      onCooldown: () => undefined,
      rememberActive: () => undefined,
    });
    try {
      const response = await fetch(`http://127.0.0.1:${proxy.port}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 32,
          tools: [{ name: "get_weather", input_schema: { type: "object", properties: { city: { type: "string" } } } }],
          messages: [{ role: "user", content: "weather" }],
        }),
      });
      const json = (await response.json()) as { stop_reason: string; content: Array<{ type: string; name?: string; input?: { city?: string } }> };
      assert.equal(json.stop_reason, "tool_use");
      const tool = json.content.find((block) => block.type === "tool_use");
      assert.equal(tool?.name, "get_weather");
      assert.equal(tool?.input?.city, "Ankara");
    } finally {
      await proxy.close();
    }
  });
});

function response(status: number, headers: Record<string, string>, bytes: Uint8Array): ManualResponse {
  return {
    status,
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      },
    },
    async arrayBuffer() {
      const copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      return copy;
    },
  };
}
