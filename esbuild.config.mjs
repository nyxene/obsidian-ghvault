import { build } from "esbuild";
import process from "node:process";

const production = process.argv[2] === "production";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  logLevel: "info",
});
