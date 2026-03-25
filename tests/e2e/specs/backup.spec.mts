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
			githubToken: "ghp_testtoken_backup_e2e",
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
		await plugin.saveData(data);
		plugin.syncEngine = null;
		plugin.githubClient = null;
	});
}

async function injectBackupMocks(): Promise<void> {
	await browser.executeObsidian(({ plugins }) => {
		const plugin = plugins.ghvault as any;
		if (!plugin.githubClient) return;

		plugin.githubClient.createRelease = async (opts: any) => ({
			id: 1,
			htmlUrl: "https://github.com/testowner/testrepo/releases/tag/" + opts.tagName,
			uploadUrl: "https://uploads.github.com/repos/testowner/testrepo/releases/1/assets{?name,label}",
		});

		plugin.githubClient.uploadReleaseAsset = async () => ({
			downloadUrl: "https://github.com/testowner/testrepo/releases/download/backup/vault-backup.zip",
			size: 1024,
		});

		plugin.githubClient.listReleases = async () => [
			{
				id: 1,
				tagName: "backup-2026-03-24-143000",
				name: "Vault Backup backup-2026-03-24-143000",
				createdAt: "2026-03-24T14:30:00Z",
				htmlUrl: "https://github.com/testowner/testrepo/releases/tag/backup-2026-03-24-143000",
				assetName: "vault-backup.zip",
				assetSize: 2048,
				assetDownloadUrl: "https://example.com/download",
			},
		];

		plugin.githubClient.deleteRelease = async () => {};
	});
}

// ---------------------------------------------------------------------------
// Group 1: Backup commands and ribbon
// ---------------------------------------------------------------------------

describe("backup commands", () => {
	before(async () => {
		await ensureConfigured();
		await injectBackupMocks();
	});

	after(async () => {
		await resetPlugin();
	});

	it("backup-vault command is registered", async () => {
		const available = await browser.executeObsidian(({ app }) => {
			const commands = (app as any).commands.commands;
			return !!commands["ghvault:ghvault-backup-vault"];
		});
		expect(available).toBe(true);
	});

	it("manage-backups command is registered", async () => {
		const available = await browser.executeObsidian(({ app }) => {
			const commands = (app as any).commands.commands;
			return !!commands["ghvault:ghvault-manage-backups"];
		});
		expect(available).toBe(true);
	});

	it("backup ribbon button is visible", async () => {
		const ribbon = await browser.$('[aria-label="GHVault: Backup vault"]');
		expect(await ribbon.isExisting()).toBe(true);
	});

	it("manage backups ribbon button is visible", async () => {
		const ribbon = await browser.$('[aria-label="GHVault: Manage backups"]');
		expect(await ribbon.isExisting()).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Group 2: Backup creation with confirmation
// ---------------------------------------------------------------------------

describe("backup creation", () => {
	before(async () => {
		await ensureConfigured();
		await injectBackupMocks();
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

	it("backup command shows confirmation dialog", async () => {
		await obsidianPage.write("backup-confirm.md", "Confirm test");
		await browser.pause(200);

		await browser.executeObsidianCommand("ghvault:ghvault-backup-vault");
		await browser.pause(500);

		// Confirmation modal should appear
		const modal = await browser.$(".modal");
		expect(await modal.isExisting()).toBe(true);
		const text = await modal.getText();
		expect(text).toContain("Create Backup");
		expect(text).toContain("files");
	});

	it("cancel in confirmation does not create backup", async () => {
		await browser.executeObsidianCommand("ghvault:ghvault-backup-vault");
		await browser.pause(500);

		// Click Cancel
		const buttons = await browser.$$(".modal button");
		for (const btn of buttons) {
			if ((await btn.getText()) === "Cancel") {
				await btn.click();
				break;
			}
		}
		await browser.pause(300);

		// No backup notice should appear
		// Modal should be closed
		const modal = await browser.$(".modal");
		expect(await modal.isExisting()).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Group 3: Backup manager
// ---------------------------------------------------------------------------

describe("backup manager", () => {
	before(async () => {
		await ensureConfigured();
		await injectBackupMocks();
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

	it("manage-backups opens manager modal with entries", async () => {
		await browser.executeObsidianCommand("ghvault:ghvault-manage-backups");
		await browser.pause(1000);

		const modal = await browser.$(".ghvault-backup-manager");
		expect(await modal.isExisting()).toBe(true);

		const text = await modal.getText();
		expect(text).toContain("Vault Backups");
		expect(text).toContain("backup-2026-03-24-143000");
	});

	it("manager shows action buttons", async () => {
		await browser.executeObsidianCommand("ghvault:ghvault-manage-backups");
		await browser.pause(1000);

		const modal = await browser.$(".ghvault-backup-manager");
		const buttons = await modal.$$(".ghvault-backup-actions button");
		expect(buttons.length).toBe(3);

		const texts: string[] = [];
		for (const btn of buttons) {
			texts.push(await btn.getText());
		}
		expect(texts).toContain("Copy URL");
		expect(texts).toContain("Restore");
		expect(texts).toContain("Delete");
	});

	it("restore button shows confirmation", async () => {
		await browser.executeObsidianCommand("ghvault:ghvault-manage-backups");
		await browser.pause(1000);

		const modal = await browser.$(".ghvault-backup-manager");
		const buttons = await modal.$$(".ghvault-backup-actions button");
		for (const btn of buttons) {
			if ((await btn.getText()) === "Restore") {
				await btn.click();
				break;
			}
		}
		await browser.pause(300);

		// Should show confirmation
		const text = await modal.getText();
		expect(text).toContain("Confirm Restore");
		expect(text).toContain("overwrite");
	});

	it("cancel in restore confirmation returns to list", async () => {
		await browser.executeObsidianCommand("ghvault:ghvault-manage-backups");
		await browser.pause(1000);

		// Click Restore
		const modal = await browser.$(".ghvault-backup-manager");
		let buttons = await modal.$$(".ghvault-backup-actions button");
		for (const btn of buttons) {
			if ((await btn.getText()) === "Restore") {
				await btn.click();
				break;
			}
		}
		await browser.pause(300);

		// Click Cancel in confirmation
		buttons = await modal.$$("button");
		for (const btn of buttons) {
			if ((await btn.getText()) === "Cancel") {
				await btn.click();
				break;
			}
		}
		await browser.pause(500);

		// Should return to backup list
		const text = await modal.getText();
		expect(text).toContain("Vault Backups");
		expect(text).toContain("backup-2026-03-24-143000");
	});

	it("open → close → reopen shows backups again", async () => {
		// First open
		await browser.executeObsidianCommand("ghvault:ghvault-manage-backups");
		await browser.pause(1000);

		let modal = await browser.$(".ghvault-backup-manager");
		expect(await modal.isExisting()).toBe(true);
		let text = await modal.getText();
		expect(text).toContain("backup-2026-03-24-143000");

		// Close
		await browser.execute(() => {
			const container = document.querySelector(".modal-container");
			if (container) {
				const close = container.querySelector(".modal-close-button") as HTMLElement;
				if (close) close.click();
			}
		});
		await browser.pause(300);

		// Reopen
		await browser.executeObsidianCommand("ghvault:ghvault-manage-backups");
		await browser.pause(1000);

		modal = await browser.$(".ghvault-backup-manager");
		expect(await modal.isExisting()).toBe(true);
		text = await modal.getText();
		// Should still show backups, not empty or error
		expect(text).toContain("Vault Backups");
		expect(text).toContain("backup-2026-03-24-143000");
	});
});
