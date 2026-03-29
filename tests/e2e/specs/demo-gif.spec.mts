/**
 * Demo GIF capture — takes a sequence of screenshots showing GHVault in action.
 *
 * Run:  npx wdio run wdio.conf.mts --spec tests/e2e/specs/demo-gif.spec.mts
 * Output: docs/screenshots/demo/ (numbered PNG frames)
 *
 * After running, assemble the GIF with ImageMagick:
 *   convert -delay 150 -loop 0 -dispose previous \
 *     docs/screenshots/demo/*.png \
 *     -layers Optimize docs/demo.gif
 *
 * Or with gifski (better quality):
 *   gifski --fps 2 --quality 90 -o docs/demo.gif docs/screenshots/demo/*.png
 */

import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";
import * as path from "node:path";
import * as fs from "node:fs";

const DEMO_DIR = path.resolve(import.meta.dirname, "../../../docs/screenshots/demo");

// Ensure output directory exists
function ensureDir(dir: string): void {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

let frameIndex = 0;

async function captureFrame(label: string): Promise<void> {
	const filename = `${String(frameIndex).padStart(2, "0")}-${label}.png`;
	await browser.saveScreenshot(path.join(DEMO_DIR, filename));
	frameIndex++;
}

// ---------------------------------------------------------------------------
// Mock constants
// ---------------------------------------------------------------------------

const HEAD_SHA = "aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33";
const PUSH_OID = "bb11cc22dd33ee44ff55aa00bb11cc22dd33ee44";
const TREE_SHA = "cc22dd33ee44ff55aa00bb11cc22dd33ee44ff55";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanVaultFiles(): Promise<void> {
	await browser.executeObsidian(async ({ app }) => {
		const files = app.vault.getFiles();
		for (const file of files) {
			if (file.path === "Welcome.md") continue;
			await app.vault.trash(file, true);
		}
	});
	await browser.pause(200);
}

async function setupPlugin(): Promise<void> {
	await browser.executeObsidian(async ({ plugins }) => {
		const plugin = plugins.ghvault as any;
		const data = (await plugin.loadData()) || {};
		data.settings = {
			githubToken: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
			owner: "octocat",
			repo: "my-vault",
			branch: "main",
			syncFolder: "",
			logLevel: "info",
			autoSync: false,
			autoSyncDebounce: 10,
			autoSyncPullInterval: 300,
			conflictStrategy: "ask",
			excludePatterns: "",
		};
		data.syncState = { lastRemoteHeadSha: "", lastSyncedAt: 0, cache: {} };
		await plugin.saveData(data);
	});
	await browser.reloadObsidian();
	await browser.pause(500);
}

async function computeGitBlobSha(content: string): Promise<string> {
	return browser.executeObsidian(async (_obs, c: string) => {
		const encoder = new TextEncoder();
		const data = encoder.encode(c);
		const prefix = encoder.encode(`blob ${data.length}\0`);
		const combined = new Uint8Array(prefix.length + data.length);
		combined.set(prefix);
		combined.set(data, prefix.length);
		const buffer = await crypto.subtle.digest("SHA-1", combined);
		return Array.from(new Uint8Array(buffer))
			.map((b: number) => b.toString(16).padStart(2, "0"))
			.join("");
	}, content);
}

// ---------------------------------------------------------------------------
// Demo scenario
// ---------------------------------------------------------------------------

describe("demo GIF capture", () => {
	before(async () => {
		ensureDir(DEMO_DIR);
		frameIndex = 0;
		await cleanVaultFiles();
		await setupPlugin();
	});

	it("captures sync workflow frames", async () => {
		// ── Frame 0: Clean vault with Welcome.md ──
		await browser.executeObsidian(async ({ app }) => {
			const file = app.vault.getFileByPath("Welcome.md");
			if (file) await app.workspace.openLinkText("Welcome.md", "", false);
		});
		await browser.pause(500);
		await captureFrame("vault-empty");

		// ── Frame 1: User creates new notes ──
		await obsidianPage.write(
			"Meeting Notes.md",
			"# Team standup\n\n- Reviewed Q1 goals\n- Assigned tasks for next sprint\n- Discussed launch timeline",
		);
		await obsidianPage.write(
			"Ideas.md",
			"# Project ideas\n\n1. Automate weekly reports\n2. Build dashboard for metrics\n3. Set up CI/CD pipeline",
		);
		await obsidianPage.write(
			"Journal.md",
			"# March 29, 2026\n\nProductive day — finished the sync engine refactor and updated all tests.",
		);

		// Open one of the new files so it's visible
		await browser.executeObsidian(async ({ app }) => {
			await app.workspace.openLinkText("Meeting Notes.md", "", false);
		});
		await browser.pause(500);
		await captureFrame("notes-created");

		// ── Frame 2: Status bar shows "syncing..." ──
		// Set status bar text to simulate sync start
		await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			if (plugin.statusBarEl) {
				plugin.statusBarEl.setText("GHVault: syncing...");
			}
		});
		await browser.pause(300);
		await captureFrame("syncing");

		// ── Frame 3: Sync complete — inject mocks and run real sync ──
		const meetingContent = "# Team standup\n\n- Reviewed Q1 goals\n- Assigned tasks for next sprint\n- Discussed launch timeline";
		const ideasContent = "# Project ideas\n\n1. Automate weekly reports\n2. Build dashboard for metrics\n3. Set up CI/CD pipeline";
		const journalContent = "# March 29, 2026\n\nProductive day — finished the sync engine refactor and updated all tests.";
		const welcomeContent = await obsidianPage.read("Welcome.md");

		const welcomeSha = await computeGitBlobSha(welcomeContent);
		const meetingSha = await computeGitBlobSha(meetingContent);
		const ideasSha = await computeGitBlobSha(ideasContent);
		const journalSha = await computeGitBlobSha(journalContent);

		// Inject mocks: remote has only Welcome.md, so 3 new files will be pushed
		await browser.executeObsidian(
			async ({ plugins }, files, hs, po, ts) => {
				const plugin = plugins.ghvault as any;
				const engine = plugin.syncEngine;
				if (!engine) throw new Error("syncEngine is null");

				const treeEntries = (files as any[]).map((f: any) => ({
					path: f.path,
					sha: f.sha,
					mode: "100644",
					type: "blob",
					size: f.size,
				}));

				engine.pullEngine.client = {
					getRef: async () => ({ ref: "refs/heads/main", sha: hs }),
					getCommit: async () => ({ sha: hs, treeSha: ts }),
					getTree: async () => ({ entries: treeEntries, truncated: false }),
					getFileContent: async (p: string) => {
						const file = (files as any[]).find((f: any) => f.path === p);
						if (!file) throw new Error(`Not found: ${p}`);
						return { content: btoa(file.content), sha: file.sha, size: file.size };
					},
					createFile: async () => ({ sha: "init-sha", commitSha: hs }),
					compareCommits: async () => {
						throw new Error("Not implemented");
					},
				};

				engine.pushEngine.graphql = {
					createCommit: async () => ({
						oid: po,
						url: "https://github.com/octocat/my-vault/commit/" + po,
					}),
				};
			},
			[{ path: "Welcome.md", sha: welcomeSha, content: welcomeContent, size: welcomeContent.length }],
			HEAD_SHA,
			PUSH_OID,
			TREE_SHA,
		);

		// Run actual sync (mocked — completes instantly)
		await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			await plugin.syncEngine.sync();
		});

		// ── Frame 3: Show sync result Notice manually (mock is too fast for native Notice) ──
		await browser.executeObsidian(({ obsidian, plugins }) => {
			const plugin = plugins.ghvault as any;
			if (plugin.statusBarEl) {
				plugin.statusBarEl.setText("GHVault: idle · synced just now");
			}
			// Show a persistent Notice matching real sync output
			new obsidian.Notice("GHVault: Synced — pushed 3 file(s)", 30000);
		});
		await browser.pause(500);
		await captureFrame("sync-complete");

		// ── Frame 4: Clean idle state (Notice dismissed) ──
		// Dismiss the Notice
		await browser.execute(() => {
			const notices = document.querySelectorAll(".notice");
			for (const n of notices) (n as HTMLElement).remove();
		});
		await browser.pause(300);
		await captureFrame("idle-synced");
	});
});
