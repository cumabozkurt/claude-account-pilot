import type { QuotaWindow } from "./types.js";
import { worstPercent } from "./quota.js";

export interface AlertInput {
  id: string;
  label: string;
  enabled: boolean;
  previousPercent: number | null;
  percent: number | null;
  resetsAt?: string;
}

export interface Alert {
  id: string;
  kind: "threshold" | "reset-soon" | "pool-full";
  vars: Record<string, string | number>;
}

const RESET_SOON_MS = 15 * 60 * 1000;

/**
 * Notifications fire once per crossing. A reset-soon notice is keyed by the
 * reset timestamp so the same window does not announce itself on every poll.
 * `seen` holds those keys and is returned with the new ones added.
 */
export function evaluateAlerts(
  accounts: AlertInput[],
  threshold: number,
  seen: Record<string, true>,
  now = Date.now(),
): { alerts: Alert[]; seen: Record<string, true> } {
  const nextSeen = { ...seen };
  const alerts: Alert[] = [];
  const enabled = accounts.filter((account) => account.enabled);
  for (const account of enabled) {
    const crossed =
      account.percent != null &&
      account.percent >= threshold &&
      (account.previousPercent == null || account.previousPercent < threshold);
    const crossKey = `${account.id}:threshold`;
    if (crossed && !nextSeen[crossKey]) {
      nextSeen[crossKey] = true;
      alerts.push({
        id: account.id,
        kind: "threshold",
        vars: { label: account.label, percent: account.percent ?? 0, threshold },
      });
    }
    if (account.percent != null && account.percent < threshold) delete nextSeen[crossKey];

    if (account.resetsAt && account.percent != null && account.percent >= Math.min(threshold, 80)) {
      const resetMs = Date.parse(account.resetsAt);
      if (Number.isFinite(resetMs) && resetMs > now && resetMs - now <= RESET_SOON_MS) {
        const key = `${account.id}:reset:${account.resetsAt}`;
        if (!nextSeen[key]) {
          nextSeen[key] = true;
          alerts.push({
            id: account.id,
            kind: "reset-soon",
            vars: { label: account.label, resetsAt: account.resetsAt },
          });
        }
      }
    }
  }
  const poolKey = "pool:full";
  const poolFull = enabled.length > 0 && enabled.every((account) => account.percent != null && account.percent >= threshold);
  if (poolFull && !nextSeen[poolKey]) {
    nextSeen[poolKey] = true;
    alerts.push({ id: "pool", kind: "pool-full", vars: { count: enabled.length, threshold } });
  }
  if (!poolFull) delete nextSeen[poolKey];
  return { alerts, seen: nextSeen };
}

/** Drop quota windows whose reset time has passed so the account can be used again before the next probe. */
export function releaseResetWindows(windows: QuotaWindow[], now = Date.now()): QuotaWindow[] {
  return windows.filter((window) => {
    if (!window.resetsAt) return true;
    const resetMs = Date.parse(window.resetsAt);
    if (!Number.isFinite(resetMs)) return true;
    return resetMs > now;
  });
}

export function percentAfterReset(windows: QuotaWindow[], now = Date.now()): { windows: QuotaWindow[]; percent: number | null } {
  const kept = releaseResetWindows(windows, now);
  return { windows: kept, percent: worstPercent(kept) };
}

/** The binding window is the fullest 5h, 7d, or per-model window. */
export function bindingReset(windows: QuotaWindow[]): string | undefined {
  const ranked = windows.filter((window) => window.label === "5h" || window.label === "7d" || window.label === "model");
  const source = ranked.length > 0 ? ranked : windows;
  const top = [...source].sort((a, b) => b.percent - a.percent)[0];
  return top?.resetsAt;
}

export function formatCountdown(resetsAt: string, now = Date.now()): string | null {
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return null;
  const total = Math.max(0, Math.round((resetMs - now) / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
