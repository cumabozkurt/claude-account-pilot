import type { Account, AppConfig, ProviderId } from "./types.js";
import { globMatch } from "./glob.js";
import { pickAccount, type RotateReason } from "./rotate.js";
import { providerSpec, type UpstreamProtocol } from "./providers.js";

export interface RuntimeSnapshot {
  config: AppConfig;
  /** Last chosen account id per provider. */
  activeByProvider: Partial<Record<ProviderId, string>>;
  /** Highest known quota percent per account. Null means unknown. */
  percentByAccount: Record<string, number | null>;
  cooldownUntil: Record<string, number>;
}

export type RoutePlan =
  | {
      kind: "forward";
      provider: ProviderId;
      protocol: Exclude<UpstreamProtocol, "unsupported">;
      account: Account;
      model: string;
      switched: boolean;
      reason: RotateReason;
    }
  | { kind: "no-account"; provider: ProviderId }
  | { kind: "unsupported"; provider: ProviderId }
  | { kind: "provider-off" };

interface Hop {
  provider: ProviderId;
  targetModel: string;
}

function hopsFor(state: RuntimeSnapshot, requestedModel: string): Hop[] {
  const route = state.config.routes.find(
    (item) => item.enabled && state.config.providersEnabled[item.provider] && globMatch(item.match, requestedModel),
  );
  if (!route) return [{ provider: "claude", targetModel: requestedModel }];
  const hops: Hop[] = [{ provider: route.provider, targetModel: route.targetModel || requestedModel }];
  for (const fallback of route.fallbacks ?? []) {
    if (!fallback || !fallback.provider || !fallback.targetModel) continue;
    hops.push({ provider: fallback.provider, targetModel: fallback.targetModel });
  }
  return hops;
}

/**
 * First matching route, then its fallbacks. An unsupported provider (Cursor)
 * or a provider with no usable account is skipped in favor of the next hop.
 * `avoid` drops accounts that already failed this request.
 */
export function planRequest(
  state: RuntimeSnapshot,
  requestedModel: string,
  now = Date.now(),
  avoid: readonly string[] = [],
): RoutePlan {
  const { config } = state;
  const hops = hopsFor(state, requestedModel);
  let unsupported: ProviderId | null = null;
  let missing: ProviderId | null = null;
  let sawEnabled = false;
  for (const hop of hops) {
    if (!config.providersEnabled[hop.provider]) continue;
    sawEnabled = true;
    const spec = providerSpec(hop.provider);
    if (spec.protocol === "unsupported") {
      unsupported = hop.provider;
      continue;
    }
    const accounts = config.accounts.filter((account) => account.provider === hop.provider && !avoid.includes(account.id));
    const decision = pickAccount(
      accounts.map((account) => ({
        id: account.id,
        enabled: account.enabled,
        percent: state.percentByAccount[account.id] ?? null,
        cooldownUntil: state.cooldownUntil[account.id],
      })),
      state.activeByProvider[hop.provider] ?? null,
      config.switchThreshold,
      now,
    );
    if (!decision.id) {
      missing = hop.provider;
      continue;
    }
    const account = accounts.find((item) => item.id === decision.id);
    if (!account) {
      missing = hop.provider;
      continue;
    }
    return {
      kind: "forward",
      provider: hop.provider,
      protocol: spec.protocol,
      account,
      model: hop.targetModel,
      switched: decision.switched || avoid.length > 0,
      reason: avoid.length > 0 ? "next-available" : decision.reason,
    };
  }
  if (!sawEnabled) return { kind: "provider-off" };
  if (unsupported && !missing) return { kind: "unsupported", provider: unsupported };
  return { kind: "no-account", provider: missing ?? unsupported ?? "claude" };
}
