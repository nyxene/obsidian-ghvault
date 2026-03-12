import { browser } from "@wdio/globals";
import * as path from "node:path";

const SCREENSHOT_DIR = path.resolve(import.meta.dirname, "../../../docs/screenshots");

async function openPluginSettings(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const setting = (app as any).setting;
		setting.open();
		setting.openTabById("ghvault");
	});
	await browser.pause(500);
}

async function closeSettings(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const setting = (app as any).setting;
		setting.close();
	});
	await browser.pause(300);
}

describe("screenshots for README", () => {
	it("captures settings tab", async () => {
		// Set some example settings for a realistic look
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			plugin.settings = {
				githubToken: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
				owner: "octocat",
				repo: "my-vault",
				branch: "main",
				syncFolder: "notes",
				logLevel: "info",
			};
		});

		await openPluginSettings();
		await browser.saveScreenshot(path.join(SCREENSHOT_DIR, "settings.png"));
		await closeSettings();
	});

	it("captures main vault view with status bar", async () => {
		// Ensure status bar shows idle
		await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			if (plugin.statusBarEl) {
				plugin.statusBarEl.setText("GHVault: idle");
			}
		});
		await browser.pause(300);

		await browser.saveScreenshot(path.join(SCREENSHOT_DIR, "vault-idle.png"));
	});

	it("captures status bar syncing state", async () => {
		await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			if (plugin.statusBarEl) {
				plugin.statusBarEl.setText("GHVault: syncing...");
			}
		});
		await browser.pause(300);

		await browser.saveScreenshot(path.join(SCREENSHOT_DIR, "vault-syncing.png"));

		// Reset to idle
		await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			if (plugin.statusBarEl) {
				plugin.statusBarEl.setText("GHVault: idle");
			}
		});
	});
});
