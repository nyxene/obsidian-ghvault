import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, "src/__mocks__/obsidian.ts"),
		},
	},
	test: {
		globals: false,
		exclude: ["node_modules/**", "tests/e2e/**"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/**/*.bench.ts", "src/__mocks__/**"],
			reporter: ["text", "text-summary"],
		},
	},
});
