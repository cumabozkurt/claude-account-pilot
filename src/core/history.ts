import type { QuotaWindow } from "./types.js";

export interface QuotaSample {
  at: string;
  accountId: string;
  percent: number | null;
  windows: QuotaWindow[];
}

const DEFAULT_CAP = 500;
const MIN_GAP_MS = 5 * 60 * 1000;

/**
 * Keep a per-account series for the dashboard. A sample is stored when the
 * percent moves by at least one point, or when five minutes have passed.
 * Prompts and tokens are not part of a sample.
 */
export function appendSample(
  samples: QuotaSample[],
  sample: QuotaSample,
  now = Date.parse(sample.at),
  cap = DEFAULT_CAP,
): QuotaSample[] {
  const previous = [...samples].reverse().find((item) => item.accountId === sample.accountId);
  if (previous) {
    const age = now - Date.parse(previous.at);
    const prevPercent = previous.percent;
    const nextPercent = sample.percent;
    const moved =
      (prevPercent == null) !== (nextPercent == null) ||
      (prevPercent != null && nextPercent != null && Math.abs(prevPercent - nextPercent) >= 1);
    if (!moved && Number.isFinite(age) && age < MIN_GAP_MS) return samples;
  }
  const next = [...samples, sample];
  return trimSamples(next, cap);
}

export function trimSamples(samples: QuotaSample[], cap: number): QuotaSample[] {
  const groups = new Map<string, QuotaSample[]>();
  for (const sample of samples) {
    const list = groups.get(sample.accountId) ?? [];
    list.push(sample);
    groups.set(sample.accountId, list);
  }
  const kept: QuotaSample[] = [];
  for (const list of groups.values()) kept.push(...list.slice(-cap));
  kept.sort((a, b) => a.at.localeCompare(b.at));
  return kept;
}

export function seriesFor(samples: QuotaSample[], accountId: string): QuotaSample[] {
  return samples.filter((sample) => sample.accountId === accountId);
}

export interface DayBucket {
  day: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  requests: number;
}

export interface ModelDayUsage {
  day: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  requests: number;
}

/** Sum request rows into UTC days. Empty input yields an empty list. */
export function usageByDay(rows: ModelDayUsage[]): DayBucket[] {
  const map = new Map<string, DayBucket>();
  for (const row of rows) {
    const current = map.get(row.day) ?? { day: row.day, inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 };
    current.inputTokens += row.inputTokens;
    current.outputTokens += row.outputTokens;
    current.costUsd = Math.round((current.costUsd + row.costUsd) * 1_000_000) / 1_000_000;
    current.requests += row.requests;
    map.set(row.day, current);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function usageByModel(rows: ModelDayUsage[]): Array<Omit<ModelDayUsage, "day">> {
  const map = new Map<string, Omit<ModelDayUsage, "day">>();
  for (const row of rows) {
    const current = map.get(row.model) ?? { model: row.model, inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 };
    current.inputTokens += row.inputTokens;
    current.outputTokens += row.outputTokens;
    current.costUsd = Math.round((current.costUsd + row.costUsd) * 1_000_000) / 1_000_000;
    current.requests += row.requests;
    map.set(row.model, current);
  }
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd || a.model.localeCompare(b.model));
}
