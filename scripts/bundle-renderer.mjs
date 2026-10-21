import { build } from "esbuild";

await build({
  entryPoints: ["src/renderer/renderer.ts"],
  bundle: true,
  outfile: "dist/renderer/renderer.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
});
