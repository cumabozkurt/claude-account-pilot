import type { QuotaWindow } from "./types.js";

export function asPercent(raw: string | number | undefined | null): number | null {
  if (raw == null) return null;
  const text = String(raw).trim().replace("%", "");
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  const percent = value <= 1 ? value * 100 : value;
  if (percent > 100) return null;
  return Math.round(percent * 10) / 10;
}

export function percentUsed(limit: number, remaining: number): number | null {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  if (!Number.isFinite(remaining) || remaining < 0) return null;
  const used = Math.min(limit, Math.max(0, limit - remaining));
  return Math.round((used / limit) * 1000) / 10;
}

function headerMap(headers: Record<string, string | undefined>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (value != null) map.set(key.toLowerCase(), value);
  }
  return map;
}

/**
 * Read whichever rate-limit shape the upstream sent.
 * 5-hour and 7-day utilization headers are preferred. Otherwise a
 * remaining/limit pair is turned into a percent used.
 */
export function windowsFromHeaders(headers: Record<string, string | undefined>): QuotaWindow[] {
  const map = headerMap(headers);
  const windows: QuotaWindow[] = [];

  const named: Array<{ header: string; label: QuotaWindow["label"] }> = [
    { header: "anthropic-ratelimit-unified-5h-utilization", label: "5h" },
    { header: "anthropic-ratelimit-unified-7d-utilization", label: "7d" },
    { header: "x-codex-5h-utilization", label: "5h" },
    { header: "x-codex-7d-utilization", label: "7d" },
  ];
  for (const item of named) {
    const percent = asPercent(map.get(item.header));
    if (percent == null) continue;
    const reset = map.get(item.header.replace(/utilization$/, "reset"));
    windows.push({ label: item.label, percent, resetsAt: reset });
  }

  const pairs: Array<{ limit: string; remaining: string; label: QuotaWindow["label"] }> = [
    {
      limit: "anthropic-ratelimit-requests-limit",
      remaining: "anthropic-ratelimit-requests-remaining",
      label: "requests",
    },
    {
      limit: "anthropic-ratelimit-tokens-limit",
      remaining: "anthropic-ratelimit-tokens-remaining",
      label: "tokens",
    },
    {
      limit: "anthropic-ratelimit-input-tokens-limit",
      remaining: "anthropic-ratelimit-input-tokens-remaining",
      label: "tokens",
    },
  ];
  for (const pair of pairs) {
    const limit = Number(map.get(pair.limit));
    const remaining = Number(map.get(pair.remaining));
    const percent = percentUsed(limit, remaining);
    if (percent == null) continue;
    if (windows.some((window) => window.label === pair.label)) continue;
    windows.push({ label: pair.label, percent });
  }
  return windows;
}

export function worstPercent(windows: QuotaWindow[]): number | null {
  const ranked = windows.filter((window) => window.label === "5h" || window.label === "7d" || window.label === "model");
  const source = ranked.length > 0 ? ranked : windows.filter((window) => window.label !== "balance");
  if (source.length === 0) return null;
  return source.reduce((max, window) => Math.max(max, window.percent), 0);
}

function childNumber(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const percent = asPercent(record[key] as string | number | undefined);
    if (percent != null) return percent;
  }
  return null;
}

function childReset(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["resets_at", "resetsAt", "reset_at", "reset"]) {
    const reset = record[key];
    if (typeof reset === "string" && reset) return reset;
    if (typeof reset === "number" && Number.isFinite(reset)) return new Date(reset).toISOString();
  }
  return undefined;
}

/**
 * Accept the few JSON shapes published by Claude OAuth usage and similar probes.
 * Unknown documents yield an empty list rather than a guessed percent.
 */
export function windowsFromUsageJson(payload: unknown): QuotaWindow[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const windows: QuotaWindow[] = [];
  const groups: Array<{ keys: string[]; label: QuotaWindow["label"] }> = [
    { keys: ["five_hour", "fiveHour", "session", "five_hour_utilization"], label: "5h" },
    { keys: ["seven_day", "sevenDay", "weekly", "week", "seven_day_utilization"], label: "7d" },
  ];
  const percentKeys = ["utilization", "used_percentage", "usedPercent", "percentage", "percent"];
  for (const group of groups) {
    for (const key of group.keys) {
      const node = root[key];
      const direct = asPercent(node as string | number | undefined);
      const nested = childNumber(node, percentKeys);
      const percent = nested ?? (typeof node !== "object" ? direct : null);
      if (percent == null) continue;
      windows.push({ label: group.label, percent, resetsAt: childReset(node) });
      break;
    }
  }

  const extra = root.extra_usage ?? root.extraUsage;
  if (extra && typeof extra === "object") {
    const node = extra as Record<string, unknown>;
    if (node.is_enabled !== false) {
      const percent = childNumber(node, percentKeys);
      if (percent != null) {
        windows.push({ label: "balance", percent, resetsAt: childReset(node), name: "extra" });
      }
    }
  }

  const limits = root.limits;
  if (Array.isArray(limits)) {
    for (const item of limits) {
      if (!item || typeof item !== "object") continue;
      const node = item as Record<string, unknown>;
      const scope = node.scope;
      const model =
        scope && typeof scope === "object" ? (scope as Record<string, unknown>).model : undefined;
      const display =
        model && typeof model === "object" ? (model as Record<string, unknown>).display_name : undefined;
      const percent = asPercent(node.percent as string | number | undefined) ?? childNumber(node, percentKeys);
      if (typeof display !== "string" || !display || percent == null) continue;
      windows.push({ label: "model", percent, resetsAt: childReset(node), name: display });
    }
  }
  return windows;
}
