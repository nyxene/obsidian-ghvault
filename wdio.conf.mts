import type { ObsidianCapabilityOptions } from "wdio-obsidian-service";

export const config: WebdriverIO.Config = {
	runner: "local",
	specs: ["./tests/e2e/specs/**/*.spec.mts"],
	exclude: ["./tests/e2e/specs/screenshots.spec.mts"],
	maxInstances: 1,

	capabilities: [
		{
			browserName: "obsidian",
			browserVersion: "latest",
			"wdio:obsidianOptions": {
				installerVersion: "latest",
				plugins: ["."],
				vault: "./tests/e2e/vaults/basic",
			} satisfies ObsidianCapabilityOptions,
		},
	],

	framework: "mocha",
	mochaOpts: {
		timeout: 60_000,
		ui: "bdd",
	},

	reporters: ["obsidian"],
	services: ["obsidian"],

	waitforTimeout: 5000,
	waitforInterval: 250,

	logLevel: "warn",
};
