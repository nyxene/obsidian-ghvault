import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HEAD_SHA = "aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33";
const PUSH_OID = "bb11cc22dd33ee44ff55aa00bb11cc22dd33ee44";
const TREE_SHA = "cc22dd33ee44ff55aa00bb11cc22dd33ee44ff55";

// ---------------------------------------------------------------------------
// Crypto helpers — run inside Obsidian via executeObsidian
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
// Notice tracking — MutationObserver on document.body
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
// Status bar helper
// ---------------------------------------------------------------------------

async function getStatusBarText(): Promise<string> {
	return browser.execute(() => {
		const items = document.querySelectorAll(".status-bar-item");
		for (const item of items) {
			const text = item.textContent || "";
			if (text.startsWith("GHVault:")) {
				return text;
			}
		}
		return "";
	});
}

// ---------------------------------------------------------------------------
// Plugin setup helpers
// ---------------------------------------------------------------------------

async function ensureSyncEngine(): Promise<void> {
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
		};
		data.syncState = { lastRemoteHeadSha: "", lastSyncedAt: 0, cache: {} };
		await plugin.saveData(data);
	});
	await browser.reloadObsidian();
	await browser.pause(500);
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
// Mock injection helpers
// ---------------------------------------------------------------------------

async function injectEmptyMocks(): Promise<void> {
	await browser.executeObsidian(
		({ plugins }, hs, po, ts) => {
			const plugin = plugins.ghvault as any;
			const engine = plugin.syncEngine;
			if (!engine) throw new Error("syncEngine is null");

			engine.pullEngine.client = {
				getRef: async () => ({ ref: "refs/heads/main", sha: hs }),
				getCommit: async () => ({ sha: hs, treeSha: ts }),
				getTree: async () => ({ entries: [], truncated: false }),
				getFileContent: async () => {
					throw new Error("Not found");
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
		HEAD_SHA,
		PUSH_OID,
		TREE_SHA,
	);
}

async function injectSlowMock(delayMs: number): Promise<void> {
	await browser.executeObsidian(
		({ plugins }, hs, po, ts, delay) => {
			const plugin = plugins.ghvault as any;
			const engine = plugin.syncEngine;
			if (!engine) throw new Error("syncEngine is null");

			engine.pullEngine.client = {
				getRef: async () => {
					await new Promise((r) => setTimeout(r, delay as number));
					return { ref: "refs/heads/main", sha: hs };
				},
				getCommit: async () => ({ sha: hs, treeSha: ts }),
				getTree: async () => ({ entries: [], truncated: false }),
				getFileContent: async () => {
					throw new Error("Not found");
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
		HEAD_SHA,
		PUSH_OID,
		TREE_SHA,
		delayMs,
	);
}

async function injectErrorMock(errorMessage: string): Promise<void> {
	await browser.executeObsidian(
		({ plugins }, msg) => {
			const plugin = plugins.ghvault as any;
			const engine = plugin.syncEngine;
			if (!engine) throw new Error("syncEngine is null");

			engine.pullEngine.client = {
				getRef: async () => {
					throw new Error(msg as string);
				},
				getCommit: async () => {
					throw new Error(msg as string);
				},
				getTree: async () => {
					throw new Error(msg as string);
				},
				getFileContent: async () => {
					throw new Error(msg as string);
				},
				createFile: async () => {
					throw new Error(msg as string);
				},
			};
		},
		errorMessage,
	);
}

async function injectMockWithFiles(
	files: Array<{ path: string; sha: string; content: string; size: number }>,
): Promise<void> {
	await browser.executeObsidian(
		({ plugins }, remoteFiles, hs, po, ts) => {
			const plugin = plugins.ghvault as any;
			const engine = plugin.syncEngine;
			if (!engine) throw new Error("syncEngine is null");

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
	);
}

// ---------------------------------------------------------------------------
// Trigger sync via plugin's runSync (through command)
// ---------------------------------------------------------------------------

async function triggerSync(): Promise<void> {
	await browser.executeObsidianCommand("ghvault:ghvault-sync");
}

// ---------------------------------------------------------------------------
// Group 1: Status Bar
// ---------------------------------------------------------------------------
describe("status bar", () => {
	before(async () => {
		await ensureSyncEngine();
		await injectEmptyMocks();
	});

	afterEach(async () => {
		await clearNotices();
		await resetCooldown();
	});

	it("shows 'GHVault: idle' on plugin load", async () => {
		const text = await getStatusBarText();
		expect(text).toBe("GHVault: idle");
	});

	it("transitions to 'syncing...' during sync", async () => {
		await injectSlowMock(2000);

		triggerSync(); // intentionally not awaited
		await browser.pause(300);

		const text = await getStatusBarText();
		expect(text).toBe("GHVault: syncing...");

		// Wait for sync to complete (slow mock + vault file push can take several seconds)
		await browser.waitUntil(
			async () => {
				const t = await getStatusBarText();
				return t !== "GHVault: syncing...";
			},
			{ timeout: 15000, interval: 500, timeoutMsg: "Sync did not complete within 15s" },
		);

		const afterText = await getStatusBarText();
		expect(afterText).toBe("GHVault: idle");
	});

	it("shows 'GHVault: error' after failed sync", async () => {
		// Ensure no sync is in progress from previous test
		await browser.waitUntil(
			async () => {
				const syncing = await browser.executeObsidian(({ plugins }) => {
					const plugin = plugins.ghvault as any;
					return plugin.syncEngine?.isSyncing ?? false;
				});
				return !syncing;
			},
			{ timeout: 10000, interval: 500 },
		);

		await injectErrorMock("Test error for status bar");

		triggerSync();

		// Wait for status to change from syncing to error
		await browser.waitUntil(
			async () => {
				const t = await getStatusBarText();
				return t === "GHVault: error";
			},
			{ timeout: 5000, interval: 200, timeoutMsg: "Status did not change to error" },
		);

		const text = await getStatusBarText();
		expect(text).toBe("GHVault: error");
	});
});

// ---------------------------------------------------------------------------
// Group 2: Ribbon Icon & Command
// ---------------------------------------------------------------------------
describe("ribbon icon & command", () => {
	before(async () => {
		await ensureSyncEngine();
		await startNoticeCollector();
	});

	afterEach(async () => {
		await clearNotices();
		await resetCooldown();
		// Re-inject empty mocks for clean state
		await injectEmptyMocks();
	});

	after(async () => {
		await stopNoticeCollector();
	});

	it("ribbon icon triggers sync", async () => {
		await injectEmptyMocks();

		const ribbon = await browser.$('[aria-label="GHVault: Sync now"]');
		await ribbon.click();
		await browser.pause(1500);

		// Vault may have files (Welcome.md) → notice is "Synced" or "Already up to date"
		const notices = await getNotices("GHVault:");
		expect(notices.length).toBeGreaterThan(0);
		expect(notices.some((n) => n.includes("Synced") || n.includes("Already up to date"))).toBe(true);
	});

	it("command triggers sync", async () => {
		await injectEmptyMocks();

		await triggerSync();
		await browser.pause(1500);

		const notices = await getNotices("GHVault:");
		expect(notices.length).toBeGreaterThan(0);
		expect(notices.some((n) => n.includes("Synced") || n.includes("Already up to date"))).toBe(true);
	});

	it("successful sync shows pull/push counts in notice", async () => {
		const content1 = "load file 1";
		const content2 = "load file 2";
		const sha1 = await computeGitBlobSha(content1);
		const sha2 = await computeGitBlobSha(content2);

		await injectMockWithFiles([
			{ path: "remote-a.md", sha: sha1, content: content1, size: content1.length },
			{ path: "remote-b.md", sha: sha2, content: content2, size: content2.length },
		]);

		await triggerSync();
		await browser.pause(1000);

		const notices = await getNotices("GHVault:");
		expect(notices.some((n) => n.includes("2 pulled"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Group 3: Sync Guards
// ---------------------------------------------------------------------------
describe("sync guards", () => {
	it("shows 'Configure settings first' when no engine", async () => {
		await resetPluginSettings();
		await browser.reloadObsidian();
		await browser.pause(500);

		// Start collector AFTER reload (reload destroys previous observers)
		await startNoticeCollector();

		await triggerSync();
		await browser.pause(500);

		const notices = await getNotices("GHVault:");
		expect(notices.some((n) => n.includes("Configure settings first"))).toBe(true);

		await stopNoticeCollector();
	});

	it("shows 'Sync already in progress' on concurrent attempt", async () => {
		await ensureSyncEngine();
		// Start collector AFTER reload
		await startNoticeCollector();

		await injectSlowMock(2000);

		triggerSync(); // first sync — don't await
		await browser.pause(300);
		triggerSync(); // second sync while first is still running
		await browser.pause(500);

		const notices = await getNotices("GHVault:");
		expect(notices.some((n) => n.includes("Sync already in progress"))).toBe(true);

		// Wait for slow sync to finish
		await browser.pause(2500);
		await stopNoticeCollector();
	});

	it("shows 'Please wait before syncing again' on cooldown", async () => {
		await ensureSyncEngine();
		// Start collector AFTER reload
		await startNoticeCollector();

		await injectEmptyMocks();

		await triggerSync();
		await browser.pause(1500); // wait for first sync to complete

		triggerSync(); // immediate second sync → cooldown
		await browser.pause(500);

		const notices = await getNotices("GHVault:");
		expect(notices.some((n) => n.includes("Please wait before syncing again"))).toBe(true);

		await stopNoticeCollector();
	});
});

// ---------------------------------------------------------------------------
// Group 4: Notice Content
// ---------------------------------------------------------------------------
describe("notice content", () => {
	before(async () => {
		await ensureSyncEngine();
		await startNoticeCollector();
	});

	afterEach(async () => {
		await clearNotices();
		await resetCooldown();
	});

	after(async () => {
		await stopNoticeCollector();
	});

	it("error notice redacts token from message", async () => {
		// Token must be 20+ chars after prefix to match SECRET_PATTERN
		await injectErrorMock(
			"Auth failed with token ghp_abcdefghijklmnopqrstuvwxyz12345 and more",
		);

		await triggerSync();
		await browser.pause(500);

		const notices = await getNotices("GHVault:");
		const errorNotice = notices.find((n) => n.includes("Sync failed"));
		expect(errorNotice).toBeDefined();
		expect(errorNotice).toContain("[REDACTED]");
		expect(errorNotice).not.toContain("ghp_abcdef");
	});

	it("sync completion notice is shown after sync", async () => {
		await injectEmptyMocks();

		await triggerSync();
		await browser.pause(1500);

		// Vault may have files → "Synced" or "Already up to date"
		const notices = await getNotices("GHVault:");
		expect(notices.length).toBeGreaterThan(0);
		expect(
			notices.some((n) => n.includes("Synced") || n.includes("Already up to date")),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Group 5: Load Test — 50+ Files
// ---------------------------------------------------------------------------
describe("load test: 50+ files", () => {
	it("pulls 50 remote files into vault", async () => {
		await ensureSyncEngine();

		// Generate 50 files with deterministic content and compute real SHAs
		const files: Array<{ path: string; sha: string; content: string; size: number }> = [];
		for (let i = 1; i <= 50; i++) {
			const idx = String(i).padStart(3, "0");
			const content = `Load test file ${idx}`;
			const sha = await computeGitBlobSha(content);
			files.push({
				path: `load/file-${idx}.md`,
				sha,
				content,
				size: content.length,
			});
		}

		await injectMockWithFiles(files);

		const result = await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.syncEngine.sync();
		});

		expect(result.pull.created.length).toBe(50);

		// Spot-check a few files
		const first = await obsidianPage.read("load/file-001.md");
		expect(first).toBe("Load test file 001");
		const last = await obsidianPage.read("load/file-050.md");
		expect(last).toBe("Load test file 050");
		const mid = await obsidianPage.read("load/file-025.md");
		expect(mid).toBe("Load test file 025");
	});

	it("pushes 50 local files to remote", async () => {
		await ensureSyncEngine();

		// Write 50 files to vault
		for (let i = 1; i <= 50; i++) {
			const idx = String(i).padStart(3, "0");
			await obsidianPage.write(`push/file-${idx}.md`, `Push test file ${idx}`);
		}

		await injectEmptyMocks();

		const result = await browser.executeObsidian(async ({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.syncEngine.sync();
		});

		expect(result.push).not.toBeNull();
		expect(result.push.pushed.length).toBeGreaterThanOrEqual(50);

		// Verify graphql was called with additions
		const gqlState = await browser.executeObsidian(({ plugins }) => {
			const plugin = plugins.ghvault as any;
			return plugin.syncEngine?._testGraphqlState ?? { called: false, lastArgs: null };
		});
		expect(gqlState.called).toBe(true);
		const pushPaths = gqlState.lastArgs.additions.map((a: any) => a.path);
		expect(pushPaths).toContain("push/file-001.md");
		expect(pushPaths).toContain("push/file-050.md");
	});
});
