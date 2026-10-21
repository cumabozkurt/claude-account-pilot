import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MANAGED_URL = "ANTHROPIC_BASE_URL";
const MANAGED_KEY = "ANTHROPIC_API_KEY";
export const LOCAL_CLIENT_KEY = "pilot-local";

export function claudeSettingsPath(home: string): string {
  return join(home, ".claude", "settings.json");
}

export function claudeBackupPath(home: string): string {
  return join(home, ".claude", "settings.claude-account-pilot.bak.json");
}

function readJson(path: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* missing or invalid — start from an empty document */
  }
  return {};
}

/**
 * Point Claude Code (and the VS Code extension, which reads the same file)
 * at the local proxy. An existing API key or auth token is left in place.
 * The first write keeps a one-time backup next to the file.
 */
export function applyClaudeBaseUrl(home: string, baseUrl: string): { settingsPath: string; backupPath: string } {
  const settingsPath = claudeSettingsPath(home);
  const backupPath = claudeBackupPath(home);
  mkdirSync(join(home, ".claude"), { recursive: true });
  if (existsSync(settingsPath) && !existsSync(backupPath)) {
    copyFileSync(settingsPath, backupPath);
  }
  const doc = readJson(settingsPath);
  const env =
    doc.env && typeof doc.env === "object" && !Array.isArray(doc.env)
      ? { ...(doc.env as Record<string, unknown>) }
      : {};
  env[MANAGED_URL] = baseUrl;
  const hasKey = typeof env[MANAGED_KEY] === "string" && String(env[MANAGED_KEY]).length > 0;
  const hasToken = typeof env.ANTHROPIC_AUTH_TOKEN === "string" && String(env.ANTHROPIC_AUTH_TOKEN).length > 0;
  if (!hasKey && !hasToken) env[MANAGED_KEY] = LOCAL_CLIENT_KEY;
  doc.env = env;
  writeFileSync(settingsPath, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  return { settingsPath, backupPath };
}

export function restoreClaudeSettings(home: string): boolean {
  const backupPath = claudeBackupPath(home);
  if (!existsSync(backupPath)) return false;
  copyFileSync(backupPath, claudeSettingsPath(home));
  return true;
}

export function claudeEnvSnippet(baseUrl: string): string {
  return `ANTHROPIC_BASE_URL=${baseUrl}\nANTHROPIC_API_KEY=${LOCAL_CLIENT_KEY}\n`;
}

/** True when Claude Code's settings are missing the proxy address or a client key. */
export function claudeSettingsNeedUpdate(home: string, baseUrl: string): boolean {
  const doc = readJson(claudeSettingsPath(home));
  const env =
    doc.env && typeof doc.env === "object" && !Array.isArray(doc.env) ? (doc.env as Record<string, unknown>) : {};
  if (env[MANAGED_URL] !== baseUrl) return true;
  const key = typeof env[MANAGED_KEY] === "string" && String(env[MANAGED_KEY]).length > 0;
  const token = typeof env.ANTHROPIC_AUTH_TOKEN === "string" && String(env.ANTHROPIC_AUTH_TOKEN).length > 0;
  return !key && !token;
}
