import type { ActivityEvent, AppConfig } from "./types.js";
import type { LedgerFile } from "./ledger.js";
import type { QuotaSample } from "./history.js";

/** A downloadable snapshot. Secret handles and refresh-token fingerprints are removed. */
export function buildExport(input: {
  version: string;
  config: AppConfig;
  ledger: LedgerFile;
  history: QuotaSample[];
  activity: ActivityEvent[];
}): string {
  const accounts = input.config.accounts.map((account) => ({
    id: account.id,
    provider: account.provider,
    label: account.label,
    enabled: account.enabled,
    authKind: account.authKind,
    email: account.email,
    baseUrl: account.baseUrl,
  }));
  return `${JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      version: input.version,
      threshold: input.config.switchThreshold,
      providersEnabled: input.config.providersEnabled,
      accounts,
      routes: input.config.routes,
      ledger: { byAccount: input.ledger.byAccount, rows: input.ledger.rows ?? [] },
      history: input.history,
      activity: input.activity,
    },
    null,
    2,
  )}\n`;
}
