import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

const MANAGED_URL = "ANTHROPIC_BASE_URL";
const MANAGED_KEY = "ANTHROPIC_API_KEY";
export const LOCAL_CLIENT_KEY = "pilot-local";

export function claudeSettingsPath(home: string): string {
  return join(home, ".claude", "settings.json");
}

export function claudeBackupPath(home: string): string {
  return join(home, ".claude", "settings.claude-account-pilot.bak.json");
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT");
}

/** Refuse a symlink, and refuse a path that resolves outside this home directory. */
function assertContained(home: string, path: string): void {
  const homeReal = realpathSync(home);
  const prefix = homeReal.endsWith(sep) ? homeReal : homeReal + sep;
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error("refusing to follow a symlink in ~/.claude");
  if (!stat.isDirectory() && stat.nlink > 1) throw new Error("refusing to write a hard-linked settings file");
  const real = realpathSync(path);
  if (real !== homeReal && !real.startsWith(prefix)) throw new Error("refusing a settings path outside the home directory");
}

function prepareClaudeDir(home: string): void {
  const dir = join(home, ".claude");
  assertContained(home, dir);
  mkdirSync(dir, { recursive: true });
  assertContained(home, dir);
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
  prepareClaudeDir(home);
  assertContained(home, settingsPath);
  assertContained(home, backupPath);
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
  const settingsPath = claudeSettingsPath(home);
  if (!existsSync(backupPath)) return false;
  assertContained(home, backupPath);
  assertContained(home, settingsPath);
  copyFileSync(backupPath, settingsPath);
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
