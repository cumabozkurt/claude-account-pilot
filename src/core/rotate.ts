export interface RotateAccount {
  id: string;
  enabled: boolean;
  /** Null means the quota percentage is unknown and the account is still usable. */
  percent: number | null;
  cooldownUntil?: number;
}

export type RotateReason = "none" | "sticky" | "next-available" | "all-hot-least-used";

export interface RotateDecision {
  id: string | null;
  switched: boolean;
  reason: RotateReason;
}

function mod(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function usable(account: RotateAccount, threshold: number): boolean {
  return account.percent == null || account.percent < threshold;
}

function cooling(account: RotateAccount, now: number): boolean {
  return (account.cooldownUntil ?? 0) > now;
}

/**
 * Stay on the active account until a quota window reaches the threshold
 * (default 98%). Then take the next enabled account that is still under it.
 * A short per-minute cooldown is skipped without treating the quota as full,
 * so a burst limit does not drain every account in the pool.
 */
export function pickAccount(
  accounts: RotateAccount[],
  activeId: string | null,
  threshold: number,
  now = Date.now(),
): RotateDecision {
  const enabled = accounts.filter((account) => account.enabled);
  if (enabled.length === 0) return { id: null, switched: false, reason: "none" };

  const activeIndex = enabled.findIndex((account) => account.id === activeId);
  const active = activeIndex >= 0 ? enabled[activeIndex] : undefined;
  if (active && usable(active, threshold) && !cooling(active, now)) {
    return { id: active.id, switched: false, reason: "sticky" };
  }

  const next = (predicate: (account: RotateAccount) => boolean): RotateAccount | undefined => {
    for (let step = 1; step <= enabled.length; step += 1) {
      const index = mod(activeIndex + step, enabled.length);
      const candidate = enabled[index];
      if (candidate && predicate(candidate)) return candidate;
    }
    return undefined;
  };

  const ready = next((account) => usable(account, threshold) && !cooling(account, now));
  if (ready) {
    return { id: ready.id, switched: ready.id !== activeId, reason: "next-available" };
  }

  const ignoringCooldown = next((account) => usable(account, threshold));
  if (ignoringCooldown) {
    return {
      id: ignoringCooldown.id,
      switched: ignoringCooldown.id !== activeId,
      reason: "next-available",
    };
  }

  // A null percent is usable, so it is chosen above. This sort runs only when every
  // enabled account is already at the threshold. Unknown is treated as the lowest
  // number so a probe that has not landed yet is preferred over a fuller window.
  const least = [...enabled].sort(
    (a, b) => (a.percent ?? 0) - (b.percent ?? 0) || a.id.localeCompare(b.id),
  )[0];
  if (!least) return { id: null, switched: false, reason: "none" };
  return { id: least.id, switched: least.id !== activeId, reason: "all-hot-least-used" };
}
