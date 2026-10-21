import { scanHome, type ScanResult } from "./scan.js";
import type { ProviderId } from "./types.js";

export interface Discovery {
  provider: ProviderId;
  found: boolean;
  /** Non-secret description safe to show in the UI. */
  detail: string;
  canImport: boolean;
  expired: boolean;
}

export function discoveriesFromScan(scan: ScanResult): Discovery[] {
  const items: Discovery[] = scan.accounts.map((account) => ({
    provider: account.provider,
    found: true,
    detail: account.detail,
    canImport: true,
    expired: false,
  }));
  if (scan.notes.includes("cursor-unroutable")) {
    items.push({ provider: "cursor", found: true, detail: "Cursor data directory", canImport: false, expired: false });
  }
  return items;
}

export function discoverInstalls(home: string, now = Date.now()): Discovery[] {
  return discoveriesFromScan(scanHome(home, process.platform, {}, null, now));
}
