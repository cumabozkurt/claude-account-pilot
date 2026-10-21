import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lineageOf, parseClaudeCredentials, type ClaudeOauthBlob } from "./oauth-claude.js";

/** Claude Code's on-disk session. The CLI and the VS Code extension read it when they are not pointed at the proxy. */
export function claudeCredentialsPath(home: string): string {
  return join(home, ".claude", ".credentials.json");
}

export function claudeCredentialsBackupPath(home: string): string {
  return join(home, ".claude", ".credentials.claude-account-pilot.bak.json");
}

export const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";

export interface KeychainPlan {
  command: string;
  args: string[];
}

/**
 * macOS Claude Code also mirrors the credentials JSON into the login keychain.
 * Other platforms keep the file only. Returns null when this OS has no
 * documented keychain item to update.
 */
export function keychainPlan(platform: NodeJS.Platform, accountName: string, document: string): KeychainPlan | null {
  if (platform !== "darwin") return null;
  return {
    command: "security",
    args: ["add-generic-password", "-U", "-s", CLAUDE_KEYCHAIN_SERVICE, "-a", accountName, "-w", document],
  };
}

export function readCredentialsFile(home: string): ClaudeOauthBlob | null {
  try {
    return parseClaudeCredentials(JSON.parse(readFileSync(claudeCredentialsPath(home), "utf8")) as unknown);
  } catch {
    return null;
  }
}

export function readCredentialsRaw(home: string): string | null {
  try {
    return readFileSync(claudeCredentialsPath(home), "utf8");
  } catch {
    return null;
  }
}

/**
 * Write a credential document for Claude Code. The previous file is copied
 * aside once per swap so Restore can put it back. The document is the
 * caller's own subscription login, not a secret this app generated.
 */
export function writeCredentialsFile(home: string, document: string): { path: string; backupPath: string } {
  const path = claudeCredentialsPath(home);
  const backupPath = claudeCredentialsBackupPath(home);
  mkdirSync(join(home, ".claude"), { recursive: true });
  if (existsSync(path)) copyFileSync(path, backupPath);
  writeFileSync(path, document.endsWith("\n") ? document : `${document}\n`, { mode: 0o600 });
  return { path, backupPath };
}

export function restoreCredentialsFile(home: string): boolean {
  const backupPath = claudeCredentialsBackupPath(home);
  if (!existsSync(backupPath)) return false;
  copyFileSync(backupPath, claudeCredentialsPath(home));
  return true;
}

export interface SwapCapture {
  /** Lineage currently on disk, when the file has a refresh token. */
  diskLineage?: string;
  diskBlob: ClaudeOauthBlob | null;
}

export function captureDisk(raw: string | null): SwapCapture {
  if (!raw) return { diskBlob: null };
  const blob = parseClaudeCredentials(safeParse(raw));
  return { diskBlob: blob, diskLineage: lineageOf(blob?.refreshToken) };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * True when this stored login is the same refresh lineage Claude Code
 * currently has on disk. Refreshing it would rotate the token out from
 * under the official client, so the monitor must leave it alone.
 */
export function claudeCodeOwns(storedLineage: string | undefined, diskLineage: string | undefined): boolean {
  return Boolean(storedLineage && diskLineage && storedLineage === diskLineage);
}
