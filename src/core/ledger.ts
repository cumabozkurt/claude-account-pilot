import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { UsageLedgerEntry } from "./types.js";
import { estimateCostUsd, type TokenUsage } from "./cost.js";

export interface LedgerRow {
  at: string;
  accountId: string;
  model: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface LedgerFile {
  version: 1;
  byAccount: Record<string, UsageLedgerEntry>;
  rows?: LedgerRow[];
}

export function emptyLedger(): LedgerFile {
  return { version: 1, byAccount: {} };
}

export function loadLedger(path: string): LedgerFile {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LedgerFile;
    if (parsed && parsed.version === 1 && parsed.byAccount) {
      return { version: 1, byAccount: parsed.byAccount, rows: Array.isArray(parsed.rows) ? parsed.rows.slice(-2000) : [] };
    }
  } catch {
    /* a missing ledger just means nothing has been counted yet */
  }
  return emptyLedger();
}

export function saveLedger(path: string, ledger: LedgerFile): void {
  mkdirSync(dirname(path), { recursive: true });
  const safe: LedgerFile = { version: 1, byAccount: ledger.byAccount, rows: (ledger.rows ?? []).slice(-2000) };
  writeFileSync(path, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
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
  const cost = Math.round(estimateCostUsd(model, usage) * 1_000_000) / 1_000_000;
  const rows = ledger.rows ?? [];
  rows.push({
    at: new Date().toISOString(),
    accountId,
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    costUsd: cost,
  });
  ledger.rows = rows.slice(-2000);
  return next;
}
