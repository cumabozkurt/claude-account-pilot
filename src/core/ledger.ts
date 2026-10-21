import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { UsageLedgerEntry } from "./types.js";
import { estimateCostUsd, type TokenUsage } from "./cost.js";

export interface LedgerFile {
  version: 1;
  byAccount: Record<string, UsageLedgerEntry>;
}

export function emptyLedger(): LedgerFile {
  return { version: 1, byAccount: {} };
}

export function loadLedger(path: string): LedgerFile {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LedgerFile;
    if (parsed && parsed.version === 1 && parsed.byAccount) return parsed;
  } catch {
    /* a missing ledger just means nothing has been counted yet */
  }
  return emptyLedger();
}

export function saveLedger(path: string, ledger: LedgerFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
}

export function recordUsage(ledger: LedgerFile, accountId: string, model: string, usage: TokenUsage): UsageLedgerEntry {
  const current = ledger.byAccount[accountId] ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    requests: 0,
  };
  const next: UsageLedgerEntry = {
    inputTokens: current.inputTokens + usage.inputTokens,
    outputTokens: current.outputTokens + usage.outputTokens,
    cacheReadTokens: current.cacheReadTokens + usage.cacheReadTokens,
    cacheWriteTokens: current.cacheWriteTokens + usage.cacheWriteTokens,
    costUsd: Math.round((current.costUsd + estimateCostUsd(model, usage)) * 1_000_000) / 1_000_000,
    requests: current.requests + 1,
  };
  ledger.byAccount[accountId] = next;
  return next;
}
