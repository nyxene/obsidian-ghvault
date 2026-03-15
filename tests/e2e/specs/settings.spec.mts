import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

const DEFAULT_SETTINGS = {
	githubToken: "",
	owner: "",
	repo: "",
	branch: "main",
	syncFolder: "",
	logLevel: "info",
};

async function getSettings(): Promise<Record<string, unknown>> {
	return browser.executeObsidian(({ plugins }) => {
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
}

async function resetPluginSettings(): Promise<void> {
	await browser.executeObsidian(async ({ plugins }) => {
		const plugin = plugins.ghvault as any;
		plugin.settings = {
			githubToken: "",
			owner: "",
			repo: "",
			branch: "main",
			syncFolder: "",
			logLevel: "info",
		};
		const data = (await plugin.loadData()) || {};
		data.settings = { ...plugin.settings };
		await plugin.saveData(data);
		// Rebuild engine to reflect cleared settings
		plugin.syncEngine = null;
	});
}

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
	await browser.pause(200);
}

// ---------------------------------------------------------------------------
// Group 1: Settings Persistence
// ---------------------------------------------------------------------------
describe("settings persistence", () => {
	afterEach(async () => {
		await resetPluginSettings();
	});

	it("saves settings and persists after reload", async () => {
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			plugin.settings.owner = "testowner";
			plugin.settings.repo = "testrepo";
			plugin.settings.branch = "develop";
			const data = (await plugin.loadData()) || {};
			data.settings = { ...plugin.settings };
			await plugin.saveData(data);
		});

		await browser.reloadObsidian();

		const settings = await getSettings();
		expect(settings.owner).toBe("testowner");
		expect(settings.repo).toBe("testrepo");
		expect(settings.branch).toBe("develop");
	});

	it("resets to defaults after plugin disable/enable cycle", async () => {
		// Set non-default values
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			plugin.settings.owner = "willbegone";
			plugin.settings.repo = "deleteme";
			const data = (await plugin.loadData()) || {};
			data.settings = { ...plugin.settings };
			await plugin.saveData(data);
		});

		// Disable plugin, remove data file, re-enable
		await obsidianPage.disablePlugin("ghvault");

		await browser.executeObsidian(async ({ app }) => {
			const adapter = app.vault.adapter;
			const dataPath = ".obsidian/plugins/ghvault/data.json";
			if (await adapter.exists(dataPath)) {
				await adapter.remove(dataPath);
			}
		});

		await obsidianPage.enablePlugin("ghvault");
		await browser.pause(500);

		const settings = await getSettings();
		expect(settings.owner).toBe(DEFAULT_SETTINGS.owner);
		expect(settings.repo).toBe(DEFAULT_SETTINGS.repo);
		expect(settings.branch).toBe(DEFAULT_SETTINGS.branch);
		expect(settings.logLevel).toBe(DEFAULT_SETTINGS.logLevel);
	});
});

// ---------------------------------------------------------------------------
// Group 2: SyncEngine Lifecycle
// ---------------------------------------------------------------------------
describe("syncEngine lifecycle", () => {
	afterEach(async () => {
		await resetPluginSettings();
	});

	it("syncEngine is null when required fields are empty", async () => {
		const hasEngine = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.syncEngine !== null;
		});
		expect(hasEngine).toBe(false);
	});

	it("syncEngine is created when token + owner + repo are set", async () => {
		// Save settings with all required fields, then reload so onload() builds engine
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			const data = (await plugin.loadData()) || {};
			data.settings = {
				githubToken: "ghp_testtoken123456",
				owner: "testowner",
				repo: "testrepo",
				branch: "main",
				syncFolder: "",
				logLevel: "info",
			};
			await plugin.saveData(data);
		});

		await browser.reloadObsidian();

		const hasEngine = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.syncEngine !== null;
		});
		expect(hasEngine).toBe(true);
	});

	it("syncEngine is destroyed when token is cleared", async () => {
		// First ensure engine exists (set all required fields + reload)
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			const data = (await plugin.loadData()) || {};
			data.settings = {
				githubToken: "ghp_testtoken123456",
				owner: "testowner",
				repo: "testrepo",
				branch: "main",
				syncFolder: "",
				logLevel: "info",
			};
			await plugin.saveData(data);
		});

		await browser.reloadObsidian();

		// Now clear token and reload
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			const data = (await plugin.loadData()) || {};
			data.settings = { ...data.settings, githubToken: "" };
			await plugin.saveData(data);
		});

		await browser.reloadObsidian();

		const hasEngine = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.syncEngine !== null;
		});
		expect(hasEngine).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Group 3: Input Sanitization (via UI)
// ---------------------------------------------------------------------------
describe("input sanitization", () => {
	before(async () => {
		await resetPluginSettings();
		await openPluginSettings();
	});

	afterEach(async () => {
		await resetPluginSettings();
		// Re-open settings to get fresh UI state
		await closeSettings();
		await openPluginSettings();
	});

	after(async () => {
		await closeSettings();
		await resetPluginSettings();
	});

	it("sanitizes owner: removes special chars", async () => {
		const ownerInput = await browser.$(".ghvault-settings input[placeholder='owner']");
		await ownerInput.setValue("my@owner!name");
		await browser.pause(300);

		const settings = await getSettings();
		expect(settings.owner).toBe("myownername");
	});

	it("sanitizes repo: keeps dots and dashes", async () => {
		const repoInput = await browser.$(".ghvault-settings input[placeholder='my-vault']");
		await repoInput.setValue("my-repo.v2!@#");
		await browser.pause(300);

		const settings = await getSettings();
		expect(settings.repo).toBe("my-repo.v2");
	});

	it("sanitizes branch: allows forward slashes", async () => {
		const branchInput = await browser.$(".ghvault-settings input[placeholder='main']");
		await branchInput.setValue("feature/my-branch!!");
		await browser.pause(300);

		const settings = await getSettings();
		expect(settings.branch).toBe("feature/my-branch");
	});

	it("sanitizes syncFolder: strips traversal", async () => {
		const folderInput = await browser.$(".ghvault-settings input[placeholder='docs/vault']");
		await folderInput.setValue("../../../etc/passwd");
		await browser.pause(300);

		const settings = await getSettings();
		expect(settings.syncFolder).toBe("etc/passwd");
	});

	it("sanitizes syncFolder: normalizes double slashes", async () => {
		const folderInput = await browser.$(".ghvault-settings input[placeholder='docs/vault']");
		await folderInput.setValue("docs//vault///notes");
		await browser.pause(300);

		const settings = await getSettings();
		expect(settings.syncFolder).toBe("docs/vault/notes");
	});
});

// ---------------------------------------------------------------------------
// Group 4: Settings UI Interaction
// ---------------------------------------------------------------------------
describe("settings UI", () => {
	before(async () => {
		await resetPluginSettings();
		await openPluginSettings();
	});

	after(async () => {
		await closeSettings();
		await resetPluginSettings();
	});

	it("settings tab has all expected fields", async () => {
		const names = await browser.$$(".ghvault-settings .setting-item .setting-item-name");
		const labels: string[] = [];
		for (const el of names) {
			labels.push(await el.getText());
		}
		expect(labels).toContain("GitHub token");
		expect(labels).toContain("Repository owner");
		expect(labels).toContain("Repository name");
		expect(labels).toContain("Branch");
		expect(labels).toContain("Sync folder");
		expect(labels).toContain("Test connection");
		expect(labels).toContain("Log level");
	});

	it("token input is password type", async () => {
		const tokenInput = await browser.$(".ghvault-settings input[placeholder='ghp_...']");
		const inputType = await tokenInput.getAttribute("type");
		expect(inputType).toBe("password");
	});

	it("token warning banner is visible", async () => {
		const warning = await browser.$(".ghvault-token-warning");
		const isDisplayed = await warning.isDisplayed();
		expect(isDisplayed).toBe(true);
		const text = await warning.getText();
		expect(text).toContain("stored unencrypted");
	});

	it("log level dropdown has 4 options with correct default", async () => {
		// Find the log level dropdown (has "debug" option, not "skip")
		const dropdowns = await browser.$$(".ghvault-settings select");
		let logDropdown: WebdriverIO.Element | null = null;
		for (const dd of dropdowns) {
			const val = await dd.getValue();
			if (val === "info" || val === "debug" || val === "warn" || val === "error") {
				logDropdown = dd;
				break;
			}
		}
		expect(logDropdown).not.toBeNull();
		const value = await logDropdown!.getValue();
		expect(value).toBe("info");

		const options = await logDropdown!.$$("option");
		const values: string[] = [];
		for (const opt of options) {
			values.push(await opt.getAttribute("value"));
		}
		expect(values).toEqual(["debug", "info", "warn", "error"]);
	});

	it("test button shows 'Fill settings first' when fields empty", async () => {
		const testBtn = await browser.$(".ghvault-settings button");
		await testBtn.click();

		const text = await testBtn.getText();
		expect(text).toBe("Fill settings first");

		// Wait for reset (setTimeout in settings.ts is 2000ms)
		await browser.pause(3000);
		const resetText = await testBtn.getText();
		expect(resetText).toBe("Test");
	});
});
