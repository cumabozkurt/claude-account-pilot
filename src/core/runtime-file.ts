import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ActivityEvent, ProviderId, QuotaSource, QuotaWindow } from "./types.js";

export interface StoredQuota {
  windows: QuotaWindow[];
  percent: number | null;
  source: QuotaSource;
  note?: string;
}

/** Quota and activity that should survive a restart. Never includes secrets. */
export interface PersistedRuntime {
  version: 1;
  activeByProvider: Partial<Record<ProviderId, string>>;
  percentByAccount: Record<string, number | null>;
  quotas: Record<string, StoredQuota>;
  activity: ActivityEvent[];
}

export function emptyRuntime(): PersistedRuntime {
  return { version: 1, activeByProvider: {}, percentByAccount: {}, quotas: {}, activity: [] };
}

export function loadRuntime(path: string): PersistedRuntime {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistedRuntime;
    if (parsed?.version !== 1) return emptyRuntime();
    return {
      version: 1,
      activeByProvider: parsed.activeByProvider ?? {},
      percentByAccount: parsed.percentByAccount ?? {},
      quotas: parsed.quotas ?? {},
      activity: Array.isArray(parsed.activity) ? parsed.activity.slice(0, 40) : [],
    };
  } catch {
    return emptyRuntime();
  }
}

export function saveRuntime(path: string, state: PersistedRuntime): void {
  mkdirSync(dirname(path), { recursive: true });
  const safe: PersistedRuntime = {
    version: 1,
    activeByProvider: state.activeByProvider,
    percentByAccount: state.percentByAccount,
    quotas: state.quotas,
    activity: state.activity.slice(0, 40),
  };
  writeFileSync(path, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
}
