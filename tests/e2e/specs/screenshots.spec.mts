import { browser } from "@wdio/globals";
import * as path from "node:path";

const DOCS_SCREENSHOT_DIR = path.resolve(import.meta.dirname, "../../../docs/screenshots");

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
		// Set realistic settings for screenshot
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			plugin.settings = {
				githubToken: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
				owner: "octocat",
				repo: "my-vault",
				branch: "main",
				syncFolder: "notes",
				logLevel: "info",
				autoSync: true,
				autoSyncDebounce: 10,
				autoSyncPullInterval: 300,
				conflictStrategy: "ask",
				excludePatterns: "drafts/**\n*.tmp",
			};
		});

		await openPluginSettings();
		await browser.saveScreenshot(path.join(DOCS_SCREENSHOT_DIR, "settings.png"));
		await closeSettings();
	});

	it("captures main vault view with status bar", async () => {
		await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			if (plugin.statusBarEl) {
				plugin.statusBarEl.setText("GHVault: idle");
			}
		});
		await browser.pause(300);

		await browser.saveScreenshot(path.join(DOCS_SCREENSHOT_DIR, "vault-idle.png"));
	});

	it("captures status bar syncing state", async () => {
		await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			if (plugin.statusBarEl) {
				plugin.statusBarEl.setText("GHVault: syncing...");
			}
		});
		await browser.pause(300);

		await browser.saveScreenshot(path.join(DOCS_SCREENSHOT_DIR, "vault-syncing.png"));

		await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			if (plugin.statusBarEl) {
				plugin.statusBarEl.setText("GHVault: idle");
			}
		});
	});

	it("captures conflict resolution modal", async () => {
		// Configure ask strategy and mock sync engine to show modal
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			const data = (await plugin.loadData()) || {};
			data.settings = {
				githubToken: "ghp_testtoken_screenshot",
				owner: "testowner",
				repo: "testrepo",
				branch: "main",
				syncFolder: "",
				logLevel: "debug",
				autoSync: false,
				autoSyncDebounce: 10,
				autoSyncPullInterval: 300,
				conflictStrategy: "ask",
				excludePatterns: "",
			};
			await plugin.saveData(data);
		});
		await browser.reloadObsidian();
		await browser.pause(500);

		// Trigger sync with conflicts to open modal naturally
		// Mock sync engine to detect conflicts and trigger ask strategy modal
		await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			const engine = plugin.syncEngine;
			if (!engine) throw new Error("syncEngine is null");

			// Mock pull engine to return conflicts
			engine.pullEngine.client = {
				getRef: async () => ({ ref: "refs/heads/main", sha: "aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33" }),
				getCommit: async () => ({ sha: "aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33", treeSha: "tree" }),
				getTree: async () => ({
					entries: [
						{ path: "notes/meeting.md", sha: "sha-remote-1", mode: "100644", type: "blob", size: 100 },
						{ path: "journal/2026-03-20.md", sha: "sha-remote-2", mode: "100644", type: "blob", size: 50 },
						{ path: "projects/roadmap.md", sha: "sha-remote-3", mode: "100644", type: "blob", size: 200 },
					],
					truncated: false,
				}),
				getFileContent: async () => ({ content: btoa("remote content"), sha: "sha-r", size: 14 }),
			};

			// Pre-populate cache so all 3 files appear as conflicts
			const data = plugin.loadData() || {};
			if (!data.syncState) data.syncState = {};
			data.syncState.lastRemoteHeadSha = "aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33";
			data.syncState.lastSyncedAt = 1000;
			data.syncState.cache = {
				"notes/meeting.md": { remoteSha: "sha-old-1", localContentHash: "old-hash-1", lastSyncedAt: 1000, size: 80, isBinary: false },
				"journal/2026-03-20.md": { remoteSha: "sha-old-2", localContentHash: "old-hash-2", lastSyncedAt: 1000, size: 40, isBinary: false },
				"projects/roadmap.md": { remoteSha: "sha-old-3", localContentHash: "old-hash-3", lastSyncedAt: 1000, size: 150, isBinary: false },
			};
			plugin.saveData(data);
		});

		// Write local files so they have different hashes than cache
		const { obsidianPage } = await import("wdio-obsidian-service");
		await obsidianPage.write("notes/meeting.md", "local meeting notes updated");
		await obsidianPage.write("journal/2026-03-20.md", "local journal entry");
		await obsidianPage.write("projects/roadmap.md", "local roadmap changes");

		// Trigger sync — modal should appear
		await browser.executeObsidianCommand("ghvault:ghvault-sync");
		await browser.pause(2000);
		await browser.pause(500);

		await browser.saveScreenshot(path.join(DOCS_SCREENSHOT_DIR, "conflict-modal.png"));

		// Close modal
		await browser.execute(() => {
			const close = document.querySelector(".modal-close-button") as HTMLElement;
			if (close) close.click();
		});
		await browser.pause(200);
	});

	it("captures file history modal", async () => {
		// Mock githubClient.listFileCommits and open modal
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			if (plugin.githubClient) {
				plugin.githubClient.listFileCommits = async () => [
					{
						sha: "a1b2c3d4e5f6",
						message: "vault sync: 3 file(s)",
						authorName: "octocat",
						date: new Date(Date.now() - 3600000).toISOString(),
						htmlUrl: "https://github.com/octocat/my-vault/commit/a1b2c3",
					},
					{
						sha: "f6e5d4c3b2a1",
						message: "feat: add project roadmap and weekly planning template",
						authorName: "octocat",
						date: new Date(Date.now() - 86400000).toISOString(),
						htmlUrl: "https://github.com/octocat/my-vault/commit/f6e5d4",
					},
					{
						sha: "1a2b3c4d5e6f",
						message: "vault sync: 1 file(s)",
						authorName: "octocat",
						date: new Date(Date.now() - 86400000 * 3).toISOString(),
						htmlUrl: "https://github.com/octocat/my-vault/commit/1a2b3c",
					},
					{
						sha: "6f5e4d3c2b1a",
						message: "initial commit",
						authorName: "octocat",
						date: new Date(Date.now() - 86400000 * 7).toISOString(),
						htmlUrl: "https://github.com/octocat/my-vault/commit/6f5e4d",
					},
				];
			}
		});

		// Create and open a file, then trigger file history
		await browser.executeObsidian(async ({ app }) => {
			const existing = app.vault.getFileByPath("Welcome.md");
			if (existing) {
				await app.workspace.openLinkText("Welcome.md", "", false);
			}
		});
		await browser.pause(500);

		await browser.executeObsidianCommand("ghvault:ghvault-file-history");
		await browser.pause(1000);

		await browser.saveScreenshot(path.join(DOCS_SCREENSHOT_DIR, "file-history.png"));

		// Close modal
		await browser.execute(() => {
			const close = document.querySelector(".modal-close-button") as HTMLElement;
			if (close) close.click();
		});
		await browser.pause(200);
	});
});
