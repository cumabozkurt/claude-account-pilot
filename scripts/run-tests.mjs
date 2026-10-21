import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = readdirSync("dist/test")
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => `dist/test/${name}`);

if (files.length === 0) {
  console.error("no compiled tests");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
