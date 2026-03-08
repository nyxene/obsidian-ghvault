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
	},
});
