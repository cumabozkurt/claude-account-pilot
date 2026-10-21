import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { safeStorage } from "electron";

interface SecretFile {
  v: 1;
  entries: Record<string, { enc: "safe" | "plain"; data: string }>;
}

export interface SecretStore {
  set: (id: string, secret: string) => void;
  get: (id: string) => string | null;
  delete: (id: string) => void;
  /** True when the OS keychain/DPAPI store could not be used. */
  plainWarning: () => boolean;
}

export function createSecretStore(path: string): SecretStore {
  const load = (): SecretFile => {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as SecretFile;
      if (parsed?.v === 1 && parsed.entries) return parsed;
    } catch {
      /* first run */
    }
    return { v: 1, entries: {} };
  };
  const save = (file: SecretFile): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(file), { mode: 0o600 });
  };
  let usedPlain = false;
  return {
    plainWarning: () => usedPlain || !safeStorage.isEncryptionAvailable(),
    set: (id, secret) => {
      const file = load();
      if (safeStorage.isEncryptionAvailable()) {
        file.entries[id] = { enc: "safe", data: safeStorage.encryptString(secret).toString("base64") };
      } else {
        usedPlain = true;
        file.entries[id] = { enc: "plain", data: Buffer.from(secret, "utf8").toString("base64") };
      }
      save(file);
    },
    get: (id) => {
      const entry = load().entries[id];
      if (!entry) return null;
      try {
        const buffer = Buffer.from(entry.data, "base64");
        if (entry.enc === "safe") {
          if (!safeStorage.isEncryptionAvailable()) return null;
          return safeStorage.decryptString(buffer);
        }
        usedPlain = true;
        return buffer.toString("utf8");
      } catch {
        return null;
      }
    },
    delete: (id) => {
      const file = load();
      delete file.entries[id];
      save(file);
    },
  };
}
