import { browser, expect } from "@wdio/globals";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
			autoSync: false,
			autoSyncDebounce: 10,
			autoSyncPullInterval: 300,
			conflictStrategy: "skip",
			excludePatterns: "",
			dispatchOnPush: false,
			dispatchEventType: "vault-synced",
			pagesEnabled: false,
			pagesGenerator: "quartz",
			pagesUrl: "",
			publishDebounce: 600,
		};
		const data = (await plugin.loadData()) || {};
		data.settings = { ...plugin.settings };
		await plugin.saveData(data);
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

/** Find a setting item element by its name label text. */
async function findSettingItem(name: string): Promise<WebdriverIO.Element | null> {
	const items = await browser.$$(".ghvault-settings .setting-item");
	for (const item of items) {
		const nameEl = await item.$(".setting-item-name");
		const text = await nameEl.getText();
		if (text === name) {
			return item;
		}
	}
	return null;
}

// ---------------------------------------------------------------------------
// Group 1: Publishing section in settings
// ---------------------------------------------------------------------------
describe("publishing settings", () => {
	before(async () => {
		await resetPluginSettings();
		await openPluginSettings();
	});

	afterEach(async () => {
		await resetPluginSettings();
		await closeSettings();
		await openPluginSettings();
	});

	after(async () => {
		await closeSettings();
		await resetPluginSettings();
	});

	it("publishing section is visible in settings", async () => {
		const names = await browser.$$(".ghvault-settings .setting-item .setting-item-name");
		const labels: string[] = [];
		for (const el of names) {
			labels.push(await el.getText());
		}
		expect(labels).toContain("Publish to GitHub Pages");
	});

	it("SSG and Deploy are hidden when publishing is OFF", async () => {
		// Publishing is off by default — SSG and Deploy should be hidden
		const ssgItem = await findSettingItem("Static site generator");
		if (ssgItem) {
			const displayed = await ssgItem.isDisplayed();
			expect(displayed).toBe(false);
		}
		const deployItem = await findSettingItem("Deploy");
		if (deployItem) {
			const displayed = await deployItem.isDisplayed();
			expect(displayed).toBe(false);
		}
	});

	it("toggling publish ON shows SSG, Deploy, and Publish interval", async () => {
		// Enable publishing via plugin settings
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			plugin.settings.pagesEnabled = true;
			const data = (await plugin.loadData()) || {};
			data.settings = { ...plugin.settings };
			await plugin.saveData(data);
		});
		// Re-open settings to refresh UI
		await closeSettings();
		await openPluginSettings();

		const ssgItem = await findSettingItem("Static site generator");
		expect(ssgItem).not.toBeNull();
		if (ssgItem) {
			const displayed = await ssgItem.isDisplayed();
			expect(displayed).toBe(true);
		}

		const deployItem = await findSettingItem("Deploy");
		expect(deployItem).not.toBeNull();
		if (deployItem) {
			const displayed = await deployItem.isDisplayed();
			expect(displayed).toBe(true);
		}

		const intervalItem = await findSettingItem("Publish interval");
		expect(intervalItem).not.toBeNull();
		if (intervalItem) {
			const displayed = await intervalItem.isDisplayed();
			expect(displayed).toBe(true);
		}
	});

	it("SSG dropdown has 3 options (Quartz, MkDocs Material, Astro Starlight)", async () => {
		// Enable publishing first
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			plugin.settings.pagesEnabled = true;
			const data = (await plugin.loadData()) || {};
			data.settings = { ...plugin.settings };
			await plugin.saveData(data);
		});
		await closeSettings();
		await openPluginSettings();

		const ssgItem = await findSettingItem("Static site generator");
		expect(ssgItem).not.toBeNull();

		const dropdown = await ssgItem!.$("select");
		const options = await dropdown.$$("option");
		const values: string[] = [];
		const texts: string[] = [];
		for (const opt of options) {
			values.push(await opt.getAttribute("value"));
			texts.push(await opt.getText());
		}
		expect(values).toEqual(["quartz", "mkdocs", "starlight"]);
		expect(texts).toContain("Quartz");
		expect(texts).toContain("MkDocs Material");
		expect(texts).toContain("Astro Starlight");
	});

	it("Deploy button exists and has CTA styling", async () => {
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			plugin.settings.pagesEnabled = true;
			const data = (await plugin.loadData()) || {};
			data.settings = { ...plugin.settings };
			await plugin.saveData(data);
		});
		await closeSettings();
		await openPluginSettings();

		const deployItem = await findSettingItem("Deploy");
		expect(deployItem).not.toBeNull();

		const button = await deployItem!.$("button");
		const text = await button.getText();
		expect(text).toBe("Deploy");

		// CTA buttons in Obsidian get the mod-cta class
		const classes = await button.getAttribute("class");
		expect(classes).toContain("mod-cta");
	});

	it("Publish interval input shows correct default (10 min)", async () => {
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			plugin.settings.pagesEnabled = true;
			plugin.settings.publishDebounce = 600; // 10 minutes
			const data = (await plugin.loadData()) || {};
			data.settings = { ...plugin.settings };
			await plugin.saveData(data);
		});
		await closeSettings();
		await openPluginSettings();

		const intervalItem = await findSettingItem("Publish interval");
		expect(intervalItem).not.toBeNull();

		const input = await intervalItem!.$("input");
		const value = await input.getValue();
		expect(value).toBe("10");
	});

	it("Publish interval input accepts valid float value", async () => {
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			plugin.settings.pagesEnabled = true;
			const data = (await plugin.loadData()) || {};
			data.settings = { ...plugin.settings };
			await plugin.saveData(data);
		});
		await closeSettings();
		await openPluginSettings();

		const intervalItem = await findSettingItem("Publish interval");
		const input = await intervalItem!.$("input");
		await input.setValue("0.5");
		await browser.pause(300);

		const debounce = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.settings.publishDebounce;
		});
		expect(debounce).toBe(30);
	});

	it("Publish interval input rejects non-numeric value", async () => {
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			plugin.settings.pagesEnabled = true;
			plugin.settings.publishDebounce = 600;
			const data = (await plugin.loadData()) || {};
			data.settings = { ...plugin.settings };
			await plugin.saveData(data);
		});
		await closeSettings();
		await openPluginSettings();

		const intervalItem = await findSettingItem("Publish interval");
		const input = await intervalItem!.$("input");
		await input.setValue("abc");
		await browser.pause(300);

		const debounce = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.settings.publishDebounce;
		});
		// Should remain unchanged
		expect(debounce).toBe(600);
	});

	it("Publish interval input rejects negative value", async () => {
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			plugin.settings.pagesEnabled = true;
			plugin.settings.publishDebounce = 600;
			const data = (await plugin.loadData()) || {};
			data.settings = { ...plugin.settings };
			await plugin.saveData(data);
		});
		await closeSettings();
		await openPluginSettings();

		const intervalItem = await findSettingItem("Publish interval");
		const input = await intervalItem!.$("input");
		await input.setValue("-5");
		await browser.pause(300);

		const debounce = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.settings.publishDebounce;
		});
		expect(debounce).toBe(600);
	});

	it("'Setup guide' link is present in publishing section", async () => {
		const publishItem = await findSettingItem("Publish to GitHub Pages");
		expect(publishItem).not.toBeNull();

		const links = await publishItem!.$$("a");
		let foundGuide = false;
		for (const link of links) {
			const text = await link.getText();
			if (text === "Setup guide") {
				foundGuide = true;
				const href = await link.getAttribute("href");
				expect(href).toContain("publishing");
				break;
			}
		}
		expect(foundGuide).toBe(true);
	});

	it("'Enable Pages in repo settings' link is present", async () => {
		const publishItem = await findSettingItem("Publish to GitHub Pages");
		expect(publishItem).not.toBeNull();

		const links = await publishItem!.$$("a");
		let foundPages = false;
		for (const link of links) {
			const text = await link.getText();
			if (text === "Enable Pages in repo settings") {
				foundPages = true;
				const href = await link.getAttribute("href");
				expect(href).toContain("settings/pages");
				break;
			}
		}
		expect(foundPages).toBe(true);
	});
});
