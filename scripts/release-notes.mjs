import { readFileSync } from "node:fs";

const version = (process.argv[2] ?? "").replace(/^v/, "");
const text = readFileSync("CHANGELOG.md", "utf8");
const parts = text.split(/\n(?=## )/);
const section = parts.find((part) => part.startsWith(`## [${version}]`) || part.startsWith(`## ${version}`));
process.stdout.write(section ? section.trim() + "\n" : text);
