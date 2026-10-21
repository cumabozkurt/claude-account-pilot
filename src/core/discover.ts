import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readClaudeOauth, readCodexAuth } from "./credentials.js";
import type { ProviderId } from "./types.js";

export interface Discovery {
  provider: ProviderId;
  found: boolean;
  /** Non-secret description safe to show in the UI. */
  detail: string;
  canImport: boolean;
  expired: boolean;
}

export function discoverInstalls(home: string, now = Date.now()): Discovery[] {
  const found: Discovery[] = [];

  const codexPath = join(home, ".codex", "auth.json");
  if (existsSync(codexPath)) {
    let login = null;
    try {
      login = readCodexAuth(JSON.parse(readFileSync(codexPath, "utf8")), now);
    } catch {
      login = null;
    }
    found.push({
      provider: "codex",
      found: true,
      detail: login ? `~/.codex/auth.json (${login.kind})` : "~/.codex/auth.json",
      canImport: Boolean(login),
      expired: false,
    });
  }

  const claudeCandidates = [join(home, ".claude", ".credentials.json"), join(home, ".claude.json")];
  for (const candidate of claudeCandidates) {
    if (!existsSync(candidate)) continue;
    let login = null;
    try {
      login = readClaudeOauth(JSON.parse(readFileSync(candidate, "utf8")), now);
    } catch {
      login = null;
    }
    if (!login) continue;
    found.push({
      provider: "claude",
      found: true,
      detail: candidate.endsWith(".credentials.json") ? "~/.claude/.credentials.json" : "~/.claude.json",
      canImport: true,
      expired: login.expired,
    });
    break;
  }

  const cursorMarkers = [
    join(home, ".cursor"),
    join(home, "Library", "Application Support", "Cursor"),
    join(home, "AppData", "Roaming", "Cursor"),
    join(home, ".config", "Cursor"),
  ];
  if (cursorMarkers.some((path) => existsSync(path))) {
    found.push({
      provider: "cursor",
      found: true,
      detail: "Cursor data directory",
      canImport: false,
      expired: false,
    });
  }

  const antigravityMarkers = [
    join(home, ".antigravity"),
    join(home, ".gemini", "antigravity"),
    join(home, ".config", "antigravity"),
  ];
  if (antigravityMarkers.some((path) => existsSync(path))) {
    found.push({
      provider: "antigravity",
      found: true,
      detail: "Antigravity config",
      canImport: false,
      expired: false,
    });
  }

  return found;
}
