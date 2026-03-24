import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function ensureConfigured(): Promise<void> {
	await browser.executeObsidian(async ({ plugins }) => {
		const plugin = plugins.ghvault as any;
		const data = (await plugin.loadData()) || {};
		data.settings = {
			githubToken: "ghp_testtoken_gist_e2e",
			owner: "testowner",
			repo: "testrepo",
			branch: "main",
			syncFolder: "",
			logLevel: "debug",
			autoSync: false,
			autoSyncDebounce: 10,
			autoSyncPullInterval: 300,
			conflictStrategy: "skip",
		};
		await plugin.saveData(data);
	});
	await browser.reloadObsidian();
	await browser.pause(500);
}

async function resetPlugin(): Promise<void> {
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
		};
		const data = (await plugin.loadData()) || {};
		data.settings = { ...plugin.settings };
		data.gistRegistry = {};
		await plugin.saveData(data);
		plugin.syncEngine = null;
		plugin.githubClient = null;
	});
}

async function injectGistMocks(): Promise<void> {
	await browser.executeObsidian(({ plugins }) => {
		const plugin = plugins.ghvault as any;
		if (!plugin.githubClient) return;

		plugin.githubClient.createGist = async (opts: any) => ({
			id: "gist-123",
			htmlUrl: `https://gist.github.com/testowner/gist-123`,
		});

		plugin.githubClient.updateGist = async (id: string, opts: any) => ({
			id,
			htmlUrl: `https://gist.github.com/testowner/${id}`,
		});

		plugin.githubClient.deleteGist = async (id: string) => {};
	});
}

async function injectGistRegistry(
	entries: Array<{
		vaultPath: string;
		gistId: string;
		isPublic: boolean;
		description: string;
	}>,
): Promise<void> {
	await browser.executeObsidian(async ({ plugins }, e) => {
		const plugin = plugins.ghvault as any;
		const registry: Record<string, any> = {};
		for (const entry of e as any[]) {
			registry[entry.vaultPath] = {
				gistId: entry.gistId,
				htmlUrl: `https://gist.github.com/testowner/${entry.gistId}`,
				isPublic: entry.isPublic,
				vaultPath: entry.vaultPath,
				description: entry.description,
				createdAt: Date.now() - 3600000,
				updatedAt: Date.now(),
			};
		}
		plugin.gistRegistry = registry;
		const data = (await plugin.loadData()) || {};
		data.gistRegistry = registry;
		await plugin.saveData(data);
	}, entries);
}

// ---------------------------------------------------------------------------
// Group 1: Gist commands availability
// ---------------------------------------------------------------------------

describe("gist commands", () => {
	before(async () => {
		await ensureConfigured();
		await injectGistMocks();
	});

	after(async () => {
		await resetPlugin();
	});

	it("share-gist command is available for .md files", async () => {
		// Create and open a markdown file
		await obsidianPage.write("gist-test.md", "# Test note for gist");
		await browser.executeObsidian(async ({ app }) => {
			await app.workspace.openLinkText("gist-test.md", "", false);
		});
		await browser.pause(300);

		// Check command is available
		const available = await browser.executeObsidian(({ app }) => {
			const commands = (app as any).commands.commands;
			const cmd = commands["ghvault:ghvault-share-gist"];
			if (!cmd || !cmd.checkCallback) return false;
			return cmd.checkCallback(true);
		});
		expect(available).toBe(true);
	});

	it("manage-gists command is available when configured", async () => {
		const available = await browser.executeObsidian(({ app }) => {
			const commands = (app as any).commands.commands;
			const cmd = commands["ghvault:ghvault-manage-gists"];
			if (!cmd || !cmd.checkCallback) return false;
			return cmd.checkCallback(true);
		});
		expect(available).toBe(true);
	});

	it("share-gist command not available for non-md files", async () => {
		// Open a non-md file context (no active file or wrong extension)
		await browser.executeObsidian(({ app }) => {
			// Close all files to have no active file
			app.workspace.iterateAllLeaves((leaf: any) => {
				if (leaf.view?.getViewType?.() === "markdown") {
					leaf.detach();
				}
			});
		});
		await browser.pause(300);

		const available = await browser.executeObsidian(({ app }) => {
			const commands = (app as any).commands.commands;
			const cmd = commands["ghvault:ghvault-share-gist"];
			if (!cmd || !cmd.checkCallback) return false;
			return cmd.checkCallback(true);
		});
		expect(available).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Group 2: Gist modal interaction
// ---------------------------------------------------------------------------

describe("gist modal", () => {
	before(async () => {
		await ensureConfigured();
		await injectGistMocks();
	});

	afterEach(async () => {
		// Dismiss any leftover modal
		await browser.execute(() => {
			const container = document.querySelector(".modal-container");
			if (container) {
				const close = container.querySelector(".modal-close-button") as HTMLElement;
				if (close) close.click();
			}
		});
		await browser.pause(200);
	});

	after(async () => {
		await resetPlugin();
	});

	it("share-gist command opens gist modal", async () => {
		await obsidianPage.write("gist-modal-test.md", "Content for gist modal");
		await browser.executeObsidian(async ({ app }) => {
			await app.workspace.openLinkText("gist-modal-test.md", "", false);
		});
		await browser.pause(300);

		await browser.executeObsidianCommand("ghvault:ghvault-share-gist");
		await browser.pause(500);

		// Modal should appear
		const modal = await browser.$(".ghvault-gist-modal");
		expect(await modal.isExisting()).toBe(true);

		// Should have file info
		const modalText = await modal.getText();
		expect(modalText).toContain("gist-modal-test.md");
		expect(modalText).toContain("Share");
	});

	it("gist modal has visibility and description fields", async () => {
		await obsidianPage.write("gist-fields-test.md", "Fields test content");
		await browser.executeObsidian(async ({ app }) => {
			await app.workspace.openLinkText("gist-fields-test.md", "", false);
		});
		await browser.pause(300);

		await browser.executeObsidianCommand("ghvault:ghvault-share-gist");
		await browser.pause(500);

		const modal = await browser.$(".ghvault-gist-modal");

		// Should have radio buttons for visibility
		const radios = await modal.$$('input[type="radio"]');
		expect(radios.length).toBe(2);

		// Should have description input
		const descInput = await modal.$('input[type="text"]');
		expect(await descInput.isExisting()).toBe(true);

		// Description should be pre-filled with filename
		const value = await descInput.getValue();
		expect(value).toContain("gist-fields-test.md");
	});
});

// ---------------------------------------------------------------------------
// Group 3: Gist manager modal
// ---------------------------------------------------------------------------

describe("gist manager", () => {
	before(async () => {
		await ensureConfigured();
		await injectGistMocks();
	});

	afterEach(async () => {
		await browser.execute(() => {
			const container = document.querySelector(".modal-container");
			if (container) {
				const close = container.querySelector(".modal-close-button") as HTMLElement;
				if (close) close.click();
			}
		});
		await browser.pause(200);
	});

	after(async () => {
		await resetPlugin();
	});

	it("manage-gists command opens manager modal with entries", async () => {
		await injectGistRegistry([
			{
				vaultPath: "notes/shared.md",
				gistId: "gist-abc",
				isPublic: false,
				description: "My shared note",
			},
		]);

		await browser.executeObsidianCommand("ghvault:ghvault-manage-gists");
		await browser.pause(500);

		const modal = await browser.$(".ghvault-gist-manager");
		expect(await modal.isExisting()).toBe(true);

		const modalText = await modal.getText();
		expect(modalText).toContain("Shared Gists (1)");
		expect(modalText).toContain("notes/shared.md");
		expect(modalText).toContain("My shared note");
	});

	it("manager shows empty state when no gists shared", async () => {
		await injectGistRegistry([]);

		await browser.executeObsidianCommand("ghvault:ghvault-manage-gists");
		await browser.pause(500);

		const modal = await browser.$(".ghvault-gist-manager");
		const modalText = await modal.getText();
		expect(modalText).toContain("Shared Gists (0)");
		expect(modalText).toContain("No gists shared yet");
	});

	it("manager shows action buttons for each entry", async () => {
		await injectGistRegistry([
			{
				vaultPath: "notes/actions.md",
				gistId: "gist-xyz",
				isPublic: true,
				description: "Test actions",
			},
		]);

		await browser.executeObsidianCommand("ghvault:ghvault-manage-gists");
		await browser.pause(500);

		const modal = await browser.$(".ghvault-gist-manager");

		// Should have Copy URL, Update, Delete buttons
		const buttons = await modal.$$(".ghvault-gist-actions button");
		expect(buttons.length).toBe(3);

		const buttonTexts: string[] = [];
		for (const btn of buttons) {
			buttonTexts.push(await btn.getText());
		}
		expect(buttonTexts).toContain("Copy URL");
		expect(buttonTexts).toContain("Update");
		expect(buttonTexts).toContain("Delete");
	});
});

// ---------------------------------------------------------------------------
// Group 4: Ribbon buttons
// ---------------------------------------------------------------------------

describe("gist ribbon buttons", () => {
	before(async () => {
		await ensureConfigured();
		await injectGistMocks();
	});

	afterEach(async () => {
		await browser.execute(() => {
			const container = document.querySelector(".modal-container");
			if (container) {
				const close = container.querySelector(".modal-close-button") as HTMLElement;
				if (close) close.click();
			}
		});
		await browser.pause(200);
	});

	after(async () => {
		await resetPlugin();
	});

	it("share ribbon button is visible", async () => {
		const ribbon = await browser.$('[aria-label="GHVault: Share as Gist"]');
		expect(await ribbon.isExisting()).toBe(true);
	});

	it("manage ribbon button is visible", async () => {
		const ribbon = await browser.$('[aria-label="GHVault: Manage shared gists"]');
		expect(await ribbon.isExisting()).toBe(true);
	});

	it("share ribbon opens gist modal for active .md file", async () => {
		await obsidianPage.write("ribbon-share.md", "Ribbon share test");
		await browser.executeObsidian(async ({ app }) => {
			await app.workspace.openLinkText("ribbon-share.md", "", false);
		});
		await browser.pause(300);

		const ribbon = await browser.$('[aria-label="GHVault: Share as Gist"]');
		await ribbon.click();
		await browser.pause(500);

		const modal = await browser.$(".ghvault-gist-modal");
		expect(await modal.isExisting()).toBe(true);
		const text = await modal.getText();
		expect(text).toContain("ribbon-share.md");
	});

	it("share ribbon shows notice when no file is open", async () => {
		// Close all markdown leaves
		await browser.executeObsidian(({ app }) => {
			app.workspace.iterateAllLeaves((leaf: any) => {
				if (leaf.view?.getViewType?.() === "markdown") {
					leaf.detach();
				}
			});
		});
		await browser.pause(300);

		const ribbon = await browser.$('[aria-label="GHVault: Share as Gist"]');
		await ribbon.click();
		await browser.pause(500);

		// Modal should NOT appear
		const modal = await browser.$(".ghvault-gist-modal");
		expect(await modal.isExisting()).toBe(false);
	});

	it("manage ribbon opens manager modal", async () => {
		await injectGistRegistry([
			{ vaultPath: "ribbon-test.md", gistId: "gist-ribbon", isPublic: false, description: "Ribbon test" },
		]);

		const ribbon = await browser.$('[aria-label="GHVault: Manage shared gists"]');
		await ribbon.click();
		await browser.pause(500);

		const modal = await browser.$(".ghvault-gist-manager");
		expect(await modal.isExisting()).toBe(true);
		const text = await modal.getText();
		expect(text).toContain("ribbon-test.md");
	});
});

// ---------------------------------------------------------------------------
// Group 5: Gist creation flow
// ---------------------------------------------------------------------------

describe("gist creation flow", () => {
	before(async () => {
		await ensureConfigured();
		await injectGistMocks();
	});

	afterEach(async () => {
		await browser.execute(() => {
			const container = document.querySelector(".modal-container");
			if (container) {
				const close = container.querySelector(".modal-close-button") as HTMLElement;
				if (close) close.click();
			}
		});
		await browser.pause(200);
	});

	after(async () => {
		await resetPlugin();
	});

	it("share creates gist and saves to registry", async () => {
		await obsidianPage.write("create-flow.md", "Gist creation flow test");
		await browser.executeObsidian(async ({ app }) => {
			await app.workspace.openLinkText("create-flow.md", "", false);
		});
		await browser.pause(300);

		await browser.executeObsidianCommand("ghvault:ghvault-share-gist");
		await browser.pause(500);

		// Click Share button
		const modal = await browser.$(".ghvault-gist-modal");
		const buttons = await modal.$$("button");
		let shareBtn: WebdriverIO.Element | null = null;
		for (const btn of buttons) {
			if ((await btn.getText()) === "Share") {
				shareBtn = btn;
				break;
			}
		}
		expect(shareBtn).not.toBeNull();
		await shareBtn!.click();
		await browser.pause(1000);

		// Modal should close after share
		const modalAfter = await browser.$(".ghvault-gist-modal");
		expect(await modalAfter.isExisting()).toBe(false);

		// Gist should be in registry
		const inRegistry = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.gistRegistry["create-flow.md"] !== undefined;
		});
		expect(inRegistry).toBe(true);
	});

	it("created gist appears in manager", async () => {
		// Registry should still have the entry from previous test
		await browser.executeObsidianCommand("ghvault:ghvault-manage-gists");
		await browser.pause(500);

		const modal = await browser.$(".ghvault-gist-manager");
		const text = await modal.getText();
		expect(text).toContain("create-flow.md");
	});
});

// ---------------------------------------------------------------------------
// Group 7: Manager actions
// ---------------------------------------------------------------------------

describe("gist manager actions", () => {
	before(async () => {
		await ensureConfigured();
		await injectGistMocks();
	});

	afterEach(async () => {
		await browser.execute(() => {
			const container = document.querySelector(".modal-container");
			if (container) {
				const close = container.querySelector(".modal-close-button") as HTMLElement;
				if (close) close.click();
			}
		});
		await browser.pause(200);
	});

	after(async () => {
		await resetPlugin();
	});

	it("delete removes entry from manager", async () => {
		await obsidianPage.write("delete-test.md", "Delete test content");
		await injectGistRegistry([
			{ vaultPath: "delete-test.md", gistId: "gist-del", isPublic: false, description: "To delete" },
		]);

		await browser.executeObsidianCommand("ghvault:ghvault-manage-gists");
		await browser.pause(500);

		// Find and click Delete button
		const modal = await browser.$(".ghvault-gist-manager");
		const buttons = await modal.$$(".ghvault-gist-actions button");
		let deleteBtn: WebdriverIO.Element | null = null;
		for (const btn of buttons) {
			if ((await btn.getText()) === "Delete") {
				deleteBtn = btn;
				break;
			}
		}
		expect(deleteBtn).not.toBeNull();
		await deleteBtn!.click();
		await browser.pause(500);

		// Entry should be gone
		const modalText = await modal.getText();
		expect(modalText).toContain("Shared Gists (0)");
		expect(modalText).not.toContain("delete-test.md");
	});

	it("update button refreshes gist", async () => {
		await obsidianPage.write("update-test.md", "Updated content");
		await injectGistRegistry([
			{ vaultPath: "update-test.md", gistId: "gist-upd", isPublic: true, description: "To update" },
		]);

		await browser.executeObsidianCommand("ghvault:ghvault-manage-gists");
		await browser.pause(500);

		const modal = await browser.$(".ghvault-gist-manager");
		const buttons = await modal.$$(".ghvault-gist-actions button");
		let updateBtn: WebdriverIO.Element | null = null;
		for (const btn of buttons) {
			if ((await btn.getText()) === "Update") {
				updateBtn = btn;
				break;
			}
		}
		expect(updateBtn).not.toBeNull();
		await updateBtn!.click();
		await browser.pause(500);

		// Entry should still be there (not removed)
		const modalText = await modal.getText();
		expect(modalText).toContain("update-test.md");
	});

	it("manager shows public/secret visibility badges", async () => {
		await injectGistRegistry([
			{ vaultPath: "public.md", gistId: "gist-pub", isPublic: true, description: "Public" },
			{ vaultPath: "secret.md", gistId: "gist-sec", isPublic: false, description: "Secret" },
		]);

		await browser.executeObsidianCommand("ghvault:ghvault-manage-gists");
		await browser.pause(500);

		const modal = await browser.$(".ghvault-gist-manager");
		const text = await modal.getText();
		expect(text).toContain("🌐");
		expect(text).toContain("🔒");
		expect(text).toContain("public");
		expect(text).toContain("secret");
	});
});
