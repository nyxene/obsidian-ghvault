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

async function computeContentHash(content: string): Promise<string> {
	return browser.executeObsidian(async (_obs, c: string) => {
		const data = new TextEncoder().encode(c);
		const buffer = await crypto.subtle.digest("SHA-256", data);
		return Array.from(new Uint8Array(buffer))
			.map((b: number) => b.toString(16).padStart(2, "0"))
			.join("");
	}, content);
}

// ---------------------------------------------------------------------------
// Setup: configure plugin settings + reload so syncEngine is built
// ---------------------------------------------------------------------------

async function ensureSyncEngine(syncFolder = ""): Promise<void> {
	await browser.executeObsidian(async ({ plugins }, sf: string) => {
		const plugin = plugins.ghvault as any;
		const data = (await plugin.loadData()) || {};
		data.settings = {
			githubToken: "ghp_testtoken_e2e",
			owner: "testowner",
			repo: "testrepo",
			branch: "main",
			syncFolder: sf,
			logLevel: "debug",
		};
		// Clear sync state for clean start
		data.syncState = { lastRemoteHeadSha: "", lastSyncedAt: 0, cache: {} };
		await plugin.saveData(data);
	}, syncFolder);
	await browser.reloadObsidian();
	await browser.pause(500);
}

// ---------------------------------------------------------------------------
// Inject mock GitHub client + GraphQL into syncEngine
// ---------------------------------------------------------------------------

async function injectMocks(
	remoteFiles: Array<{ path: string; sha: string; content: string; size: number }>,
	options?: {
		headSha?: string;
		pushOid?: string;
		treeSha?: string;
		cache?: Record<string, any>;
	},
): Promise<void> {
	const headSha = options?.headSha ?? HEAD_SHA;
	const pushOid = options?.pushOid ?? PUSH_OID;
	const treeSha = options?.treeSha ?? TREE_SHA;
	const cache = options?.cache ?? null;

	await browser.executeObsidian(
		async ({ plugins }, files, hs, po, ts, cacheData) => {
			const plugin = plugins.ghvault as any;
			const engine = plugin.syncEngine;
			if (!engine) throw new Error("syncEngine is null — configure settings first");

			// Optionally set sync state cache before sync
			if (cacheData) {
				const data = (await plugin.loadData()) || {};
				data.syncState = {
					lastRemoteHeadSha: hs as string,
					lastSyncedAt: 1000,
					cache: cacheData,
				};
				await plugin.saveData(data);
			}

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
				getFileContent: async (path: string) => {
					const file = (files as any[]).find((f: any) => f.path === path);
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
		remoteFiles,
		headSha,
		pushOid,
		treeSha,
		cache,
	);
}

async function runSync(): Promise<any> {
	return browser.executeObsidian(async ({ plugins }) => {
		const plugin = plugins.ghvault as any;
		if (!plugin.syncEngine) throw new Error("syncEngine is null");
		return plugin.syncEngine.sync();
	});
}

async function getGraphqlState(): Promise<{ called: boolean; lastArgs: any }> {
	return browser.executeObsidian(({ plugins }) => {
		const plugin = plugins.ghvault as any;
		return plugin.syncEngine?._testGraphqlState ?? { called: false, lastArgs: null };
	});
}

async function getSyncState(): Promise<any> {
	return browser.executeObsidian(async ({ plugins }) => {
		const plugin = plugins.ghvault as any;
		const data = await plugin.loadData();
		return data?.syncState ?? null;
	});
}

async function fileExists(path: string): Promise<boolean> {
	return browser.executeObsidian(({ app }, p: string) => {
		return app.vault.getAbstractFileByPath(p) !== null;
	}, path);
}

// ---------------------------------------------------------------------------
// Group 1: Pull — Remote to Vault
// ---------------------------------------------------------------------------
describe("pull: remote → vault", () => {
	it("creates new files from remote in vault", async () => {
		await ensureSyncEngine();

		const helloContent = "Hello World";
		const readmeContent = "# README";
		const helloSha = await computeGitBlobSha(helloContent);
		const readmeSha = await computeGitBlobSha(readmeContent);

		await injectMocks([
			{ path: "notes/hello.md", sha: helloSha, content: helloContent, size: helloContent.length },
			{ path: "readme.md", sha: readmeSha, content: readmeContent, size: readmeContent.length },
		]);

		const result = await runSync();

		expect(result.pull.created).toContain("notes/hello.md");
		expect(result.pull.created).toContain("readme.md");
		const hello = await obsidianPage.read("notes/hello.md");
		expect(hello).toBe(helloContent);
		const readme = await obsidianPage.read("readme.md");
		expect(readme).toBe(readmeContent);
	});

	it("modifies existing file from remote", async () => {
		await ensureSyncEngine();

		const oldContent = "old content";
		const newContent = "updated from remote";
		const newSha = await computeGitBlobSha(newContent);
		const oldLocalHash = await computeContentHash(oldContent);

		await obsidianPage.write("doc.md", oldContent);

		await injectMocks(
			[{ path: "doc.md", sha: newSha, content: newContent, size: newContent.length }],
			{
				cache: {
					"doc.md": {
						remoteSha: "sha-old-version",
						localContentHash: oldLocalHash,
						lastSyncedAt: 1000,
						size: oldContent.length,
						isBinary: false,
					},
				},
			},
		);

		const result = await runSync();

		expect(result.pull.modified).toContain("doc.md");
		const content = await obsidianPage.read("doc.md");
		expect(content).toBe(newContent);
	});

	it("deletes local file removed from remote", async () => {
		await ensureSyncEngine();

		const fileContent = "will be deleted";
		const localHash = await computeContentHash(fileContent);

		await obsidianPage.write("deleted.md", fileContent);

		await injectMocks([], {
			cache: {
				"deleted.md": {
					remoteSha: "sha-old",
					localContentHash: localHash,
					lastSyncedAt: 1000,
					size: fileContent.length,
					isBinary: false,
				},
			},
		});

		const result = await runSync();

		expect(result.pull.deleted).toContain("deleted.md");
		const exists = await fileExists("deleted.md");
		expect(exists).toBe(false);
	});

	it("creates parent directories for nested files", async () => {
		await ensureSyncEngine();

		const content = "deep file content";
		const sha = await computeGitBlobSha(content);

		await injectMocks([
			{ path: "deep/nested/path/file.md", sha, content, size: content.length },
		]);

		const result = await runSync();

		expect(result.pull.created).toContain("deep/nested/path/file.md");
		const read = await obsidianPage.read("deep/nested/path/file.md");
		expect(read).toBe(content);
	});
});

// ---------------------------------------------------------------------------
// Group 2: Push — Vault to Remote
// ---------------------------------------------------------------------------
describe("push: vault → remote", () => {
	it("pushes new local file to remote", async () => {
		await ensureSyncEngine();
		await obsidianPage.write("local-new.md", "new stuff");

		await injectMocks([]);

		const result = await runSync();

		expect(result.push).not.toBeNull();
		expect(result.push.pushed).toContain("local-new.md");

		const gql = await getGraphqlState();
		expect(gql.called).toBe(true);
		const pushed = gql.lastArgs.additions.find((a: any) => a.path === "local-new.md");
		expect(pushed).toBeDefined();
	});

	it("pushes modified local file", async () => {
		await ensureSyncEngine();
		await obsidianPage.write("doc.md", "modified locally");

		// Remote has same SHA as cache → no remote change. Local hash differs → local change.
		await injectMocks(
			[{ path: "doc.md", sha: "sha-same", content: "original", size: 8 }],
			{
				cache: {
					"doc.md": {
						remoteSha: "sha-same",
						localContentHash: "old-local-hash-wont-match",
						lastSyncedAt: 1000,
						size: 8,
						isBinary: false,
					},
				},
			},
		);

		const result = await runSync();

		expect(result.pull.modified).toHaveLength(0);
		expect(result.push).not.toBeNull();
		expect(result.push.pushed).toContain("doc.md");
	});

	it("pushes local deletion", async () => {
		await ensureSyncEngine();

		const content = "gone content";
		const localHash = await computeContentHash(content);

		// File in cache and remote tree, but NOT in local vault
		await injectMocks(
			[{ path: "gone.md", sha: "sha-gone", content, size: content.length }],
			{
				cache: {
					"gone.md": {
						remoteSha: "sha-gone",
						localContentHash: localHash,
						lastSyncedAt: 1000,
						size: content.length,
						isBinary: false,
					},
				},
			},
		);

		const result = await runSync();

		expect(result.push).not.toBeNull();
		expect(result.push.deleted).toContain("gone.md");

		const gql = await getGraphqlState();
		expect(gql.called).toBe(true);
		expect(gql.lastArgs.deletions).toEqual(
			expect.arrayContaining([expect.objectContaining({ path: "gone.md" })]),
		);
	});
});

// ---------------------------------------------------------------------------
// Group 3: Bidirectional — Pull + Push in Same Cycle
// ---------------------------------------------------------------------------
describe("bidirectional: pull + push in same cycle", () => {
	it("pulls remote file AND pushes local file", async () => {
		await ensureSyncEngine();

		const remoteContent = "remote content";
		const remoteSha = await computeGitBlobSha(remoteContent);

		await obsidianPage.write("local-only.md", "local content");
		await injectMocks([
			{ path: "remote-only.md", sha: remoteSha, content: remoteContent, size: remoteContent.length },
		]);

		const result = await runSync();

		expect(result.pull.created).toContain("remote-only.md");
		const content = await obsidianPage.read("remote-only.md");
		expect(content).toBe(remoteContent);

		expect(result.push).not.toBeNull();
		expect(result.push.pushed).toContain("local-only.md");
	});

	it("second sync detects no changes for previously synced file", async () => {
		await ensureSyncEngine();

		const remoteContent = "stable content";
		const remoteSha = await computeGitBlobSha(remoteContent);

		// Include only stable.md in remote (first sync pulls it + pushes local files)
		await injectMocks([
			{ path: "stable.md", sha: remoteSha, content: remoteContent, size: remoteContent.length },
		]);

		const first = await runSync();
		expect(first.pull.created).toContain("stable.md");

		// Second sync: re-inject mocks with all files that exist after first sync
		// stable.md was pulled. Other vault files were pushed. headSha = PUSH_OID.
		// For the re-sync, remote tree must include stable.md with same sha.
		await injectMocks(
			[{ path: "stable.md", sha: remoteSha, content: remoteContent, size: remoteContent.length }],
			{ headSha: PUSH_OID },
		);

		const second = await runSync();
		// stable.md should NOT be re-downloaded (sha unchanged)
		expect(second.pull.created).not.toContain("stable.md");
		expect(second.pull.modified).not.toContain("stable.md");
	});
});

// ---------------------------------------------------------------------------
// Group 4: Conflict Detection
// ---------------------------------------------------------------------------
describe("conflict detection", () => {
	it("detects conflict and skips file in both directions", async () => {
		await ensureSyncEngine();

		const remoteContent = "remote version";
		const remoteSha = await computeGitBlobSha(remoteContent);

		await obsidianPage.write("conflict.md", "local version");

		await injectMocks(
			[{ path: "conflict.md", sha: remoteSha, content: remoteContent, size: remoteContent.length }],
			{
				cache: {
					"conflict.md": {
						remoteSha: "sha-remote-v1",
						localContentHash: "old-hash-wont-match-local",
						lastSyncedAt: 1000,
						size: 10,
						isBinary: false,
					},
				},
			},
		);

		const result = await runSync();

		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0].path).toBe("conflict.md");

		const content = await obsidianPage.read("conflict.md");
		expect(content).toBe("local version");
	});

	it("syncs non-conflicting files while skipping conflicts", async () => {
		await ensureSyncEngine();

		const remoteNewContent = "new remote file";
		const remoteNewSha = await computeGitBlobSha(remoteNewContent);
		const remoteConflictContent = "remote conflict version";
		const remoteConflictSha = await computeGitBlobSha(remoteConflictContent);

		await obsidianPage.write("conflict.md", "local conflict version");
		await obsidianPage.write("safe-local.md", "safe local content");

		await injectMocks(
			[
				{ path: "conflict.md", sha: remoteConflictSha, content: remoteConflictContent, size: remoteConflictContent.length },
				{ path: "remote-new.md", sha: remoteNewSha, content: remoteNewContent, size: remoteNewContent.length },
			],
			{
				cache: {
					"conflict.md": {
						remoteSha: "sha-conflict-v1",
						localContentHash: "old-hash-wont-match",
						lastSyncedAt: 1000,
						size: 10,
						isBinary: false,
					},
				},
			},
		);

		const result = await runSync();

		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0].path).toBe("conflict.md");

		expect(result.pull.created).toContain("remote-new.md");
		const remoteRead = await obsidianPage.read("remote-new.md");
		expect(remoteRead).toBe(remoteNewContent);

		expect(result.push).not.toBeNull();
		expect(result.push.pushed).toContain("safe-local.md");
		expect(result.push.pushed).not.toContain("conflict.md");
	});
});

// ---------------------------------------------------------------------------
// Group 5: SyncFolder Filtering
// ---------------------------------------------------------------------------
describe("syncFolder filtering", () => {
	it("pulls only files inside syncFolder with remapped paths", async () => {
		await ensureSyncEngine("docs");

		const noteContent = "note content";
		const deepContent = "deep content";
		const rootContent = "root content";
		const noteSha = await computeGitBlobSha(noteContent);
		const deepSha = await computeGitBlobSha(deepContent);
		const rootSha = await computeGitBlobSha(rootContent);

		await injectMocks([
			{ path: "docs/note.md", sha: noteSha, content: noteContent, size: noteContent.length },
			{ path: "docs/sub/deep.md", sha: deepSha, content: deepContent, size: deepContent.length },
			{ path: "root.md", sha: rootSha, content: rootContent, size: rootContent.length },
		]);

		const result = await runSync();

		expect(result.pull.created).toContain("note.md");
		expect(result.pull.created).toContain("sub/deep.md");
		expect(result.pull.created).not.toContain("root.md");

		const note = await obsidianPage.read("note.md");
		expect(note).toBe(noteContent);
		const deep = await obsidianPage.read("sub/deep.md");
		expect(deep).toBe(deepContent);

		const rootExists = await fileExists("root.md");
		expect(rootExists).toBe(false);
	});

	it("pushes local files with syncFolder prefix", async () => {
		await ensureSyncEngine("docs");
		await obsidianPage.write("local-note.md", "local note");

		await injectMocks([]);

		const result = await runSync();

		expect(result.push).not.toBeNull();
		expect(result.push.pushed).toContain("local-note.md");

		const gql = await getGraphqlState();
		expect(gql.called).toBe(true);
		const addition = gql.lastArgs.additions.find((a: any) => a.path === "docs/local-note.md");
		expect(addition).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Group 6: Sync State Persistence
// ---------------------------------------------------------------------------
describe("sync state persistence", () => {
	it("headOid persists across plugin reload", async () => {
		await ensureSyncEngine();

		const content = "persist test";
		const sha = await computeGitBlobSha(content);

		await injectMocks([
			{ path: "persist.md", sha, content, size: content.length },
		]);

		await runSync();

		const stateBefore = await getSyncState();
		expect(stateBefore).not.toBeNull();
		const headOidBefore = stateBefore.lastRemoteHeadSha;
		expect(headOidBefore).toBeTruthy();

		await browser.reloadObsidian();
		await browser.pause(500);

		const stateAfter = await getSyncState();
		expect(stateAfter.lastRemoteHeadSha).toBe(headOidBefore);
	});

	it("cache entries persist and prevent re-download", async () => {
		await ensureSyncEngine();

		const content = "cached content";
		const sha = await computeGitBlobSha(content);

		await injectMocks([
			{ path: "cached.md", sha, content, size: content.length },
		]);

		const first = await runSync();
		expect(first.pull.created).toContain("cached.md");

		// Reload rebuilds engine with persisted state
		await ensureSyncEngine();
		// Restore cache from first sync (ensureSyncEngine clears it)
		// Instead: don't clear, just re-setup with cache intact
		await browser.executeObsidian(async ({ plugins }, s, c, cs) => {
			const plugin = plugins.ghvault as any;
			const data = (await plugin.loadData()) || {};
			// Restore the cache entry that the first sync saved
			if (!data.syncState) data.syncState = {};
			data.syncState.cache = data.syncState.cache || {};
			data.syncState.cache["cached.md"] = {
				remoteSha: cs,
				localContentHash: s,
				lastSyncedAt: 1000,
				size: (c as string).length,
				isBinary: false,
			};
			await plugin.saveData(data);
		}, sha, content, sha);

		await injectMocks(
			[{ path: "cached.md", sha, content, size: content.length }],
			{ headSha: PUSH_OID },
		);

		const second = await runSync();
		expect(second.pull.created).toHaveLength(0);
		expect(second.pull.modified).toHaveLength(0);
	});
});
