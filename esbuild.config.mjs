import { build, context } from "esbuild";
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import process from "node:process";

const production = process.argv[2] === "production";
const DEV_PLUGIN_DIR = "test-vault/.obsidian/plugins/ghvault";

const config = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2020",
  outfile: production ? "main.js" : `${DEV_PLUGIN_DIR}/main.js`,
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  logLevel: "info",
};

if (production) {
  await build(config);
} else {
  mkdirSync(DEV_PLUGIN_DIR, { recursive: true });
  copyFileSync("manifest.json", `${DEV_PLUGIN_DIR}/manifest.json`);

  const ctx = await context(config);
  await ctx.watch();
  console.log("Watching for changes...");
  console.log(`Output: ${DEV_PLUGIN_DIR}/`);
  console.log("Open test-vault/ in Obsidian to test the plugin.");
}
