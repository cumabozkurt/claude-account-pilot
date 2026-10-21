import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

const MAX_BYTES = 1_000_000;

/** Append one line. Prompts must never be passed in. A file past 1 MB is rotated once. */
export function appendLog(path: string, line: string): void {
  mkdirSync(dirname(path), { recursive: true });
  try {
    if (statSync(path).size > MAX_BYTES) renameSync(path, `${path}.1`);
  } catch {
    /* the file does not exist yet */
  }
  appendFileSync(path, `${line}\n`, { mode: 0o600 });
}
