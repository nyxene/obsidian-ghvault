import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEAD_SHA = "aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33";
const PUSH_OID = "bb11cc22dd33ee44ff55aa00bb11cc22dd33ee44";
const TREE_SHA = "cc22dd33ee44ff55aa00bb11cc22dd33ee44ff55";

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

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
// Setup helpers
// ---------------------------------------------------------------------------

async function ensureAskStrategy(): Promise<void> {
	await browser.executeObsidian(async ({ plugins }) => {
		const plugin = plugins.ghvault as any;
		const data = (await plugin.loadData()) || {};
		data.settings = {
			githubToken: "ghp_testtoken_e2e",
			owner: "testowner",
			repo: "testrepo",
			branch: "main",
			syncFolder: "",
			logLevel: "debug",
			autoSync: false,
			autoSyncDebounce: 10,
			autoSyncPullInterval: 300,
			conflictStrategy: "ask",
		};
		data.syncState = { lastRemoteHeadSha: "", lastSyncedAt: 0, cache: {} };
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
	});
}

async function resetCooldown(): Promise<void> {
	await browser.executeObsidian(({ plugins }) => {
		const plugin = plugins.ghvault as any;
		plugin.lastSyncAt = 0;
	});
}

// ---------------------------------------------------------------------------
// Mock injection with conflict setup
// ---------------------------------------------------------------------------

async function injectConflictMock(
	files: Array<{ path: string; sha: string; content: string; size: number }>,
	cache: Record<string, any>,
): Promise<void> {
	await browser.executeObsidian(
		async ({ plugins }, remoteFiles, hs, po, ts, cacheData) => {
			const plugin = plugins.ghvault as any;
			const engine = plugin.syncEngine;
			if (!engine) throw new Error("syncEngine is null");

			// Set cache to create conflict conditions
			const data = (await plugin.loadData()) || {};
			data.syncState = {
				lastRemoteHeadSha: hs as string,
				lastSyncedAt: 1000,
				cache: cacheData,
			};
			await plugin.saveData(data);

			const treeEntries = (remoteFiles as any[]).map((f: any) => ({
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
				getFileContent: async (path: string) => {
					const file = (remoteFiles as any[]).find((f: any) => f.path === path);
					if (!file) throw new Error(`Not found: ${path}`);
					return { content: btoa(file.content), sha: file.sha, size: file.size };
				},
				createFile: async () => ({ sha: "init-sha", commitSha: hs }),
			};

			const graphqlState = { called: false, lastArgs: null as any };
			engine.pushEngine.graphql = {
				createCommit: async (opts: any) => {
					graphqlState.called = true;
					graphqlState.lastArgs = opts;
					return { oid: po, url: "https://example.com/commit" };
				},
			};
			engine._testGraphqlState = graphqlState;
		},
		files,
		HEAD_SHA,
		PUSH_OID,
		TREE_SHA,
		cache,
	);
}

// ---------------------------------------------------------------------------
// Settings UI helpers
// ---------------------------------------------------------------------------

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
// Notice collector
// ---------------------------------------------------------------------------

async function startNoticeCollector(): Promise<void> {
	await browser.execute(() => {
		(window as any).__ghvaultNotices = [];
		const observer = new MutationObserver((mutations) => {
			for (const m of mutations) {
				for (const node of m.addedNodes) {
					if (node instanceof HTMLElement && node.classList.contains("notice")) {
						(window as any).__ghvaultNotices.push(node.textContent || "");
					}
				}
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		(window as any).__ghvaultNoticeObserver = observer;
	});
}

async function getNotices(prefix?: string): Promise<string[]> {
	const all: string[] = await browser.execute(() => {
		return (window as any).__ghvaultNotices || [];
	});
	if (prefix) {
		return all.filter((n) => n.startsWith(prefix));
	}
	return all;
}

async function clearNotices(): Promise<void> {
	await browser.execute(() => {
		(window as any).__ghvaultNotices = [];
	});
}

async function stopNoticeCollector(): Promise<void> {
	await browser.execute(() => {
		(window as any).__ghvaultNoticeObserver?.disconnect();
		delete (window as any).__ghvaultNotices;
		delete (window as any).__ghvaultNoticeObserver;
	});
}

// ---------------------------------------------------------------------------
// DOM helpers — find button by text content (CSS selectors can't match text)
// ---------------------------------------------------------------------------

async function findButtonByText(containerSelector: string, text: string): Promise<WebdriverIO.Element> {
	const buttons = await browser.$$(`${containerSelector} button`);
	for (const btn of buttons) {
		const btnText = await btn.getText();
		if (btnText.trim() === text) return btn;
	}
	throw new Error(`Button with text "${text}" not found in "${containerSelector}"`);
}

// ---------------------------------------------------------------------------
// Sync trigger (via command, same as user clicking)
// ---------------------------------------------------------------------------

async function triggerSync(): Promise<void> {
	await browser.executeObsidianCommand("ghvault:ghvault-sync");
}

// ---------------------------------------------------------------------------
// Group 1: Settings Dropdown — 4 strategies
// ---------------------------------------------------------------------------

describe("conflict strategy settings", () => {
	before(async () => {
		await resetPlugin();
		await openPluginSettings();
	});

	after(async () => {
		await closeSettings();
		await resetPlugin();
	});

	it("conflict strategy dropdown has 4 options", async () => {
		const dropdowns = await browser.$$(".ghvault-settings select");
		// Find the conflict strategy dropdown (it's not the first one — log level is also a select)
		let conflictDropdown: WebdriverIO.Element | null = null;
		for (const dd of dropdowns) {
			const options = await dd.$$("option");
			const values: string[] = [];
			for (const opt of options) {
				values.push(await opt.getAttribute("value"));
			}
			if (values.includes("skip") && values.includes("ask")) {
				conflictDropdown = dd;
				break;
			}
		}
		expect(conflictDropdown).not.toBeNull();

		const options = await conflictDropdown!.$$("option");
		const values: string[] = [];
		for (const opt of options) {
			values.push(await opt.getAttribute("value"));
		}
		expect(values).toEqual(["skip", "local-wins", "remote-wins", "ask"]);
	});

	it("selecting Ask saves to plugin settings", async () => {
		const dropdowns = await browser.$$(".ghvault-settings select");
		for (const dd of dropdowns) {
			const options = await dd.$$("option");
			for (const opt of options) {
				if ((await opt.getAttribute("value")) === "ask") {
					await dd.selectByAttribute("value", "ask");
					break;
				}
			}
		}
		await browser.pause(300);

		const strategy = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.settings.conflictStrategy;
		});
		expect(strategy).toBe("ask");
	});
});

// ---------------------------------------------------------------------------
// Group 2: Conflict Modal — appearance and interaction
// ---------------------------------------------------------------------------

describe("conflict modal", () => {
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
		await clearNotices();
		await resetCooldown();
	});

	before(async () => {
		await ensureAskStrategy();
		await startNoticeCollector();
	});

	after(async () => {
		await stopNoticeCollector();
		await resetPlugin();
	});

	it("modal appears when sync detects conflicts with ask strategy", async () => {
		const remoteContent = "remote version";
		const remoteSha = await computeGitBlobSha(remoteContent);

		await obsidianPage.write("conflict-ask.md", "local version");

		await injectConflictMock(
			[{ path: "conflict-ask.md", sha: remoteSha, content: remoteContent, size: remoteContent.length }],
			{
				"conflict-ask.md": {
					remoteSha: "sha-old-v1",
					localContentHash: "old-hash-wont-match",
					lastSyncedAt: 1000,
					size: 10,
					isBinary: false,
				},
			},
		);

		triggerSync(); // don't await — modal will block sync
		await browser.pause(1000);

		// Modal should appear in DOM
		const modal = await browser.$(".ghvault-conflict-modal");
		const isDisplayed = await modal.isDisplayed();
		expect(isDisplayed).toBe(true);
	});

	it("modal shows conflict file details", async () => {
		const remoteContent = "remote v2";
		const remoteSha = await computeGitBlobSha(remoteContent);

		await obsidianPage.write("detail-test.md", "local v2");

		await injectConflictMock(
			[{ path: "detail-test.md", sha: remoteSha, content: remoteContent, size: remoteContent.length }],
			{
				"detail-test.md": {
					remoteSha: "sha-old",
					localContentHash: "old-hash",
					lastSyncedAt: 1000,
					size: 8,
					isBinary: false,
				},
			},
		);

		triggerSync();
		await browser.pause(1000);

		// Check heading
		const heading = await browser.$(".ghvault-conflict-modal h2");
		const headingText = await heading.getText();
		expect(headingText).toContain("Resolve conflicts");
		expect(headingText).toContain("1 file");

		// Check table has the file path
		const table = await browser.$(".ghvault-conflict-table");
		const tableText = await table.getText();
		expect(tableText).toContain("detail-test.md");

		// Check buttons exist
		const keepLocal = await findButtonByText(".ghvault-conflict-actions", "Keep Local");
		expect(await keepLocal.isDisplayed()).toBe(true);
		const keepRemote = await findButtonByText(".ghvault-conflict-actions", "Keep Remote");
		expect(await keepRemote.isDisplayed()).toBe(true);
	});

	it("Resolve button is disabled until all files have a decision", async () => {
		const remoteContent = "remote";
		const remoteSha = await computeGitBlobSha(remoteContent);

		await obsidianPage.write("resolve-btn-test.md", "local");

		await injectConflictMock(
			[{ path: "resolve-btn-test.md", sha: remoteSha, content: remoteContent, size: remoteContent.length }],
			{
				"resolve-btn-test.md": {
					remoteSha: "sha-old",
					localContentHash: "old-hash",
					lastSyncedAt: 1000,
					size: 5,
					isBinary: false,
				},
			},
		);

		triggerSync();
		await browser.pause(1000);

		// Resolve button should be disabled initially
		const resolveBtn = await browser.$(".ghvault-conflict-footer button.mod-cta");
		const isDisabled = await resolveBtn.getAttribute("disabled");
		expect(isDisabled).not.toBeNull();

		// Click Keep Local
		const keepLocal = await findButtonByText(".ghvault-conflict-actions", "Keep Local");
		await keepLocal.click();
		await browser.pause(200);

		// Now Resolve should be enabled
		const isDisabledAfter = await resolveBtn.getAttribute("disabled");
		expect(isDisabledAfter).toBeNull();
	});

	it("Keep Local resolves conflict by pushing local version", async () => {
		const remoteContent = "remote for local-wins";
		const remoteSha = await computeGitBlobSha(remoteContent);

		await obsidianPage.write("keep-local-test.md", "local for local-wins");

		await injectConflictMock(
			[{ path: "keep-local-test.md", sha: remoteSha, content: remoteContent, size: remoteContent.length }],
			{
				"keep-local-test.md": {
					remoteSha: "sha-old",
					localContentHash: "old-hash",
					lastSyncedAt: 1000,
					size: 10,
					isBinary: false,
				},
			},
		);

		triggerSync();
		await browser.pause(1000);

		// Click Keep Local then Resolve
		const keepLocal = await findButtonByText(".ghvault-conflict-actions", "Keep Local");
		await keepLocal.click();
		await browser.pause(200);

		const resolveBtn = await browser.$(".ghvault-conflict-footer button.mod-cta");
		await resolveBtn.click();

		// Wait for sync to complete
		await browser.pause(2000);

		// Local file should NOT have been overwritten
		const content = await obsidianPage.read("keep-local-test.md");
		expect(content).toBe("local for local-wins");

		// GraphQL should have been called (push)
		const gql = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.syncEngine?._testGraphqlState ?? { called: false };
		});
		expect(gql.called).toBe(true);

		// Notice should mention "resolved (per-file)"
		const notices = await getNotices("GHVault:");
		expect(notices.some((n) => n.includes("resolved (per-file)"))).toBe(true);
	});

	it("Keep Remote resolves conflict by pulling remote version", async () => {
		const remoteContent = "remote for remote-wins";
		const remoteSha = await computeGitBlobSha(remoteContent);

		await obsidianPage.write("keep-remote-test.md", "local for remote-wins");

		await injectConflictMock(
			[{ path: "keep-remote-test.md", sha: remoteSha, content: remoteContent, size: remoteContent.length }],
			{
				"keep-remote-test.md": {
					remoteSha: "sha-old",
					localContentHash: "old-hash",
					lastSyncedAt: 1000,
					size: 10,
					isBinary: false,
				},
			},
		);

		triggerSync();
		await browser.pause(1000);

		// Click Keep Remote then Resolve
		const keepRemote = await findButtonByText(".ghvault-conflict-actions", "Keep Remote");
		await keepRemote.click();
		await browser.pause(200);

		const resolveBtn = await browser.$(".ghvault-conflict-footer button.mod-cta");
		await resolveBtn.click();

		// Wait for sync to complete
		await browser.pause(2000);

		// Local file should have been overwritten with remote content
		const content = await obsidianPage.read("keep-remote-test.md");
		expect(content).toBe(remoteContent);
	});

	it("Skip All leaves both sides untouched", async () => {
		const remoteContent = "remote for skip-all";
		const remoteSha = await computeGitBlobSha(remoteContent);

		await obsidianPage.write("skip-all-test.md", "local for skip-all");

		await injectConflictMock(
			[{ path: "skip-all-test.md", sha: remoteSha, content: remoteContent, size: remoteContent.length }],
			{
				"skip-all-test.md": {
					remoteSha: "sha-old",
					localContentHash: "old-hash",
					lastSyncedAt: 1000,
					size: 10,
					isBinary: false,
				},
			},
		);

		triggerSync();
		await browser.pause(1000);

		// Click Skip All
		const skipBtn = await findButtonByText(".ghvault-conflict-footer", "Skip All");
		await skipBtn.click();

		// Wait for sync to complete
		await browser.pause(2000);

		// Local file should be unchanged
		const content = await obsidianPage.read("skip-all-test.md");
		expect(content).toBe("local for skip-all");

		// Notice should show "conflict" (not "resolved")
		const notices = await getNotices("GHVault:");
		expect(notices.some((n) => n.includes("conflict"))).toBe(true);
	});
});
