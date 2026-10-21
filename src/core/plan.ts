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

export function planRequest(state: RuntimeSnapshot, requestedModel: string, now = Date.now()): RoutePlan {
  const { config } = state;
  const route = config.routes.find(
    (item) => item.enabled && config.providersEnabled[item.provider] && globMatch(item.match, requestedModel),
  );
  const provider: ProviderId = route?.provider ?? "claude";
  if (!config.providersEnabled[provider]) return { kind: "provider-off" };

  const spec = providerSpec(provider);
  if (spec.protocol === "unsupported") return { kind: "unsupported", provider };

  const accounts = config.accounts.filter((account) => account.provider === provider);
  const decision = pickAccount(
    accounts.map((account) => ({
      id: account.id,
      enabled: account.enabled,
      percent: state.percentByAccount[account.id] ?? null,
      cooldownUntil: state.cooldownUntil[account.id],
    })),
    state.activeByProvider[provider] ?? null,
    config.switchThreshold,
    now,
  );
  if (!decision.id) return { kind: "no-account", provider };
  const account = accounts.find((item) => item.id === decision.id);
  if (!account) return { kind: "no-account", provider };
  return {
    kind: "forward",
    provider,
    protocol: spec.protocol,
    account,
    model: route?.targetModel || requestedModel,
    switched: decision.switched,
    reason: decision.reason,
  };
}
