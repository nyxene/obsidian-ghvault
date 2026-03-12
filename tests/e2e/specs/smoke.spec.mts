import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

describe("GHVault plugin — smoke test", () => {
	it("plugin is loaded and active", async () => {
		const loaded = await browser.executeObsidian(({ app }) => {
			return app.plugins.enabledPlugins.has("ghvault");
		});
		expect(loaded).toBe(true);
	});

	it("plugin has default settings (no token configured)", async () => {
		const settings = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return {
				githubToken: plugin.settings.githubToken,
				owner: plugin.settings.owner,
				repo: plugin.settings.repo,
				branch: plugin.settings.branch,
				syncFolder: plugin.settings.syncFolder,
				logLevel: plugin.settings.logLevel,
			};
		});
		expect(settings.githubToken).toBe("");
		expect(settings.owner).toBe("");
		expect(settings.repo).toBe("");
		expect(settings.branch).toBe("main");
		expect(settings.syncFolder).toBe("");
		expect(settings.logLevel).toBe("info");
	});

	it("syncEngine is null when settings are not configured", async () => {
		const hasEngine = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.syncEngine !== null;
		});
		expect(hasEngine).toBe(false);
	});

	it("settings tab is registered", async () => {
		const hasTab = await browser.executeObsidian(({ app }) => {
			return (app as any).setting.pluginTabs.some(
				(t: any) => t.id === "ghvault",
			);
		});
		expect(hasTab).toBe(true);
	});

	it("vault contains the test file", async () => {
		const content = await obsidianPage.read("Welcome.md");
		expect(content).toContain("# Welcome");
	});
});
