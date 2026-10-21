import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/renderer", { recursive: true });
mkdirSync("dist/preload", { recursive: true });
cpSync("src/renderer/index.html", "dist/renderer/index.html");
cpSync("src/renderer/styles.css", "dist/renderer/styles.css");
cpSync("src/preload/preload.cjs", "dist/preload/preload.cjs");
cpSync("build/icon.png", "dist/icon.png");
