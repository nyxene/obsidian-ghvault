import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../github/client";
import type { GitHubGraphQL } from "../github/graphql";
import type { ConflictDecision, ConflictInfo, ConflictStrategy, SHACacheEntry } from "../types";
import { computeGitBlobSha } from "../utils/hash";
import type { Logger } from "../utils/logger";
import { ChangeQueue } from "./change-queue";
import type { LocalFileInfo } from "./comparator";
import type { SyncVault } from "./engine";
import { SyncEngine } from "./engine";
import { PullEngine } from "./pull";
import { PushEngine } from "./push";
import type { StorageAdapter } from "./state";
import { SyncStateManager } from "./state";

vi.mock("../utils/hash", () => ({
	computeHash: vi.fn().mockImplementation((content: string) => {
		return Promise.resolve(`hash-${content.length}`);
	}),
	computeHashFromBuffer: vi.fn().mockImplementation((data: ArrayBuffer | Uint8Array) => {
		const len = data instanceof Uint8Array ? data.length : data.byteLength;
		return Promise.resolve(`hash-${len}`);
	}),
	computeGitBlobSha: vi.fn().mockResolvedValue("mock-blob-sha"),
}));

// ---------------------------------------------------------------------------
// Mock vault adapter — simulates Obsidian Vault at the boundary
// ---------------------------------------------------------------------------

interface MockVaultFile {
	path: string;
	content: string;
}

function createMockVaultAdapter(initialFiles: MockVaultFile[] = []): SyncVault & {
	files: Map<string, string>;
} {
	const files = new Map<string, string>();
	for (const f of initialFiles) {
		files.set(f.path, f.content);
	}

	return {
		files,
		readFile: vi.fn(async (path: string): Promise<string> => {
			const content = files.get(path);
			if (content === undefined) throw new Error(`File not found: ${path}`);
			return content;
		}),
		readFileBinary: vi.fn(async (path: string): Promise<ArrayBuffer> => {
			const content = files.get(path);
			if (content === undefined) throw new Error(`File not found: ${path}`);
			return new TextEncoder().encode(content).buffer as ArrayBuffer;
		}),
		writeFile: vi.fn(async (path: string, content: string): Promise<void> => {
			files.set(path, content);
		}),
		writeFileBinary: vi.fn(async (path: string, data: ArrayBuffer): Promise<void> => {
			files.set(path, new TextDecoder().decode(data));
		}),
		deleteFile: vi.fn(async (path: string): Promise<void> => {
			files.delete(path);
		}),
		renameFile: vi.fn(async (oldPath: string, newPath: string): Promise<void> => {
			const content = files.get(oldPath);
			if (content !== undefined) {
				files.delete(oldPath);
				files.set(newPath, content);
			}
		}),
		listFiles: vi.fn(async (): Promise<LocalFileInfo[]> => {
			const result: LocalFileInfo[] = [];
			for (const [path, content] of files) {
				// Deterministic hash matching computeHash mock: hash-{content.length}
				const contentHash = `hash-${content.length}`;
				result.push({
					path,
					contentHash,
					size: content.length,
				});
			}
			return result;
		}),
	};
}

// ---------------------------------------------------------------------------
// Mock GitHub client — simulates GitHub REST API at the boundary
// ---------------------------------------------------------------------------

interface MockRemoteFile {
	path: string;
	sha: string;
	content: string;
	size: number;
}

function createMockGitHubClient(
	remoteFiles: MockRemoteFile[],
	headSha = "aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33",
): GitHubClient {
	const treeEntries = remoteFiles.map((f) => ({
		path: f.path,
		sha: f.sha,
		mode: "100644" as const,
		type: "blob" as const,
		size: f.size,
	}));

	return {
		getRef: vi.fn().mockResolvedValue({ ref: "refs/heads/main", sha: headSha }),
		getCommit: vi.fn().mockResolvedValue({ sha: headSha, treeSha: "tree-sha" }),
		getTree: vi.fn().mockResolvedValue({ entries: treeEntries, truncated: false }),
		getFileContent: vi.fn().mockImplementation((path: string) => {
			const file = remoteFiles.find((f) => f.path === path);
			if (!file) return Promise.reject(new Error(`Not found: ${path}`));
			vi.mocked(computeGitBlobSha).mockResolvedValueOnce(file.sha);
			return Promise.resolve({
				content: btoa(file.content),
				sha: file.sha,
				size: file.size,
			});
		}),
		compareCommits: vi.fn().mockRejectedValue(new Error("Not implemented in mock")),
	} as unknown as GitHubClient;
}

// ---------------------------------------------------------------------------
// Mock GitHub GraphQL — simulates push boundary
// ---------------------------------------------------------------------------

function createMockGraphQL(oid = "bb11cc22dd33ee44ff55aa00bb11cc22dd33ee44"): GitHubGraphQL {
	return {
		createCommit: vi.fn().mockResolvedValue({ oid, url: "https://github.com/commit" }),
	} as unknown as GitHubGraphQL;
}

// ---------------------------------------------------------------------------
// In-memory storage adapter — real persistence logic, in-memory backing
// ---------------------------------------------------------------------------

function createInMemoryStorage(): StorageAdapter & {
	data: Record<string, unknown> | null;
} {
	const store: { data: Record<string, unknown> | null } = { data: null };
	return {
		get data() {
			return store.data;
		},
		set data(value: Record<string, unknown> | null) {
			store.data = value;
		},
		loadData: vi.fn(async () => store.data),
		saveData: vi.fn(async (data: Record<string, unknown>) => {
			store.data = structuredClone(data);
		}),
	};
}

// ---------------------------------------------------------------------------
// Logger mock
// ---------------------------------------------------------------------------

function createMockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		setLevel: vi.fn(),
	} as unknown as Logger;
}

// ---------------------------------------------------------------------------
// Helper to wire up the full system
// ---------------------------------------------------------------------------

interface IntegrationSetup {
	engine: SyncEngine;
	vault: ReturnType<typeof createMockVaultAdapter>;
	client: GitHubClient;
	graphql: GitHubGraphQL;
	state: SyncStateManager;
	storage: ReturnType<typeof createInMemoryStorage>;
}

function createIntegrationSetup(options: {
	localFiles?: MockVaultFile[];
	remoteFiles?: MockRemoteFile[];
	headSha?: string;
	pushOid?: string;
	syncFolder?: string;
	conflictStrategy?: ConflictStrategy;
	onConflict?: (conflicts: ConflictInfo[]) => Promise<ConflictDecision[]>;
}): IntegrationSetup {
	const vault = createMockVaultAdapter(options.localFiles ?? []);
	const client = createMockGitHubClient(options.remoteFiles ?? [], options.headSha);
	const graphql = createMockGraphQL(options.pushOid);
	const storage = createInMemoryStorage();
	const state = new SyncStateManager(storage);
	const logger = createMockLogger();
	const syncFolder = options.syncFolder ?? "";

	const pullEngine = new PullEngine({ client, state, vault, logger, syncFolder });
	const pushEngine = new PushEngine({ graphql, client, state, vault, logger, syncFolder });

	const engine = new SyncEngine({
		pullEngine,
		pushEngine,
		state,
		vault,
		logger,
		commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
		conflictStrategy: options.conflictStrategy,
		onConflict: options.onConflict,
	});

	return { engine, vault, client, graphql, state, storage };
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe("Sync integration", () => {
	describe("pull detects remote changes and writes to vault", () => {
		it("creates new files from remote", async () => {
			const { engine, vault } = createIntegrationSetup({
				remoteFiles: [
					{ path: "notes/hello.md", sha: "sha-hello", content: "Hello World", size: 11 },
					{ path: "readme.md", sha: "sha-readme", content: "# README", size: 8 },
				],
			});

			const result = await engine.sync();

			expect(result.pull.created).toContain("notes/hello.md");
			expect(result.pull.created).toContain("readme.md");
			expect(vault.files.get("notes/hello.md")).toBe("Hello World");
			expect(vault.files.get("readme.md")).toBe("# README");
		});

		it("modifies existing files from remote", async () => {
			const { engine, vault, storage } = createIntegrationSetup({
				localFiles: [{ path: "doc.md", content: "old content" }],
				remoteFiles: [{ path: "doc.md", sha: "sha-v2", content: "new content", size: 11 }],
			});

			// Pre-populate state cache with old remote SHA
			storage.data = {
				syncState: {
					lastRemoteHeadSha: "1100220033004400550066007700880099001100",
					lastSyncedAt: 1000,
					cache: {
						"doc.md": {
							remoteSha: "sha-v1",
							localContentHash: "hash-11",
							lastSyncedAt: 1000,
							size: 11,
							isBinary: false,
						},
					},
				},
			};

			const result = await engine.sync();

			expect(result.pull.modified).toContain("doc.md");
			expect(vault.files.get("doc.md")).toBe("new content");
		});

		it("deletes local files removed from remote", async () => {
			const { engine, vault, storage } = createIntegrationSetup({
				localFiles: [{ path: "deleted.md", content: "will be deleted" }],
				remoteFiles: [],
			});

			// File exists in cache but not in remote tree => delete
			storage.data = {
				syncState: {
					lastRemoteHeadSha: "1100220033004400550066007700880099001100",
					lastSyncedAt: 1000,
					cache: {
						"deleted.md": {
							remoteSha: "sha-old",
							localContentHash: "hash-15",
							lastSyncedAt: 1000,
							size: 15,
							isBinary: false,
						},
					},
				},
			};

			const result = await engine.sync();

			expect(result.pull.deleted).toContain("deleted.md");
			expect(vault.files.has("deleted.md")).toBe(false);
		});
	});

	describe("push detects local changes and commits to GitHub", () => {
		it("pushes new local files", async () => {
			const { engine, graphql } = createIntegrationSetup({
				localFiles: [{ path: "local-new.md", content: "new stuff" }],
				remoteFiles: [],
			});

			const result = await engine.sync();

			expect(result.push).not.toBeNull();
			expect(result.push?.pushed).toContain("local-new.md");
			expect(graphql.createCommit).toHaveBeenCalledWith(
				expect.objectContaining({
					additions: expect.arrayContaining([expect.objectContaining({ path: "local-new.md" })]),
				}),
			);
		});

		it("pushes modified local files", async () => {
			const { engine, graphql, storage } = createIntegrationSetup({
				localFiles: [{ path: "doc.md", content: "modified locally" }],
				remoteFiles: [{ path: "doc.md", sha: "sha-same", content: "original", size: 8 }],
			});

			// Cache says remote SHA matches tree, so pull sees no changes.
			// But local content hash differs from cache, so push detects modify.
			storage.data = {
				syncState: {
					lastRemoteHeadSha: "0000000000000000000000000000000000000001",
					lastSyncedAt: 1000,
					cache: {
						"doc.md": {
							remoteSha: "sha-same",
							localContentHash: "old-local-hash",
							lastSyncedAt: 1000,
							size: 8,
							isBinary: false,
						},
					},
				},
			};

			const result = await engine.sync();

			expect(result.pull.modified).toHaveLength(0);
			expect(result.push?.pushed).toContain("doc.md");
			expect(graphql.createCommit).toHaveBeenCalled();
		});
	});

	describe("both-changed scenario — pull + push in same cycle", () => {
		it("pulls remote changes then pushes local changes", async () => {
			const { engine, vault, graphql } = createIntegrationSetup({
				localFiles: [{ path: "local-only.md", content: "local content" }],
				remoteFiles: [
					{ path: "remote-only.md", sha: "sha-remote", content: "remote content", size: 14 },
				],
			});

			// No prior cache — both files are new
			const result = await engine.sync();

			// Pull should have created the remote file in vault
			expect(result.pull.created).toContain("remote-only.md");
			expect(vault.files.get("remote-only.md")).toBe("remote content");

			// Push should have committed the local file
			expect(result.push).not.toBeNull();
			expect(result.push?.pushed).toContain("local-only.md");
			expect(graphql.createCommit).toHaveBeenCalled();
		});

		it("handles both remote modify and local create in same cycle", async () => {
			const { engine, vault, storage } = createIntegrationSetup({
				localFiles: [
					{ path: "existing.md", content: "same content" },
					{ path: "brand-new.md", content: "just created" },
				],
				remoteFiles: [
					{ path: "existing.md", sha: "sha-updated", content: "updated from remote", size: 19 },
				],
			});

			// existing.md is in cache with old remote SHA
			storage.data = {
				syncState: {
					lastRemoteHeadSha: "1100220033004400550066007700880099001100",
					lastSyncedAt: 1000,
					cache: {
						"existing.md": {
							remoteSha: "sha-old",
							localContentHash: "hash-12",
							lastSyncedAt: 1000,
							size: 12,
							isBinary: false,
						},
					},
				},
			};

			const result = await engine.sync();

			// Pull: existing.md modified from remote
			expect(result.pull.modified).toContain("existing.md");
			expect(vault.files.get("existing.md")).toBe("updated from remote");

			// Push: brand-new.md is new locally (not in cache)
			expect(result.push).not.toBeNull();
			expect(result.push?.pushed).toContain("brand-new.md");
		});
	});

	describe("conflict detection — file changed both locally and remotely", () => {
		it("skips conflicted files in both pull and push", async () => {
			const { engine, vault, graphql, storage } = createIntegrationSetup({
				localFiles: [{ path: "conflict.md", content: "local version" }],
				remoteFiles: [
					{ path: "conflict.md", sha: "sha-remote-v2", content: "remote version", size: 14 },
				],
			});

			// Simulate prior sync: file was synced before, now both sides changed
			storage.data = {
				syncState: {
					lastRemoteHeadSha: "0000000000000000000000000000000000000001",
					lastSyncedAt: 1000,
					cache: {
						"conflict.md": {
							remoteSha: "sha-remote-v1",
							localContentHash: "old-local-hash",
							lastSyncedAt: 1000,
							size: 10,
							isBinary: false,
						},
					},
				},
			};

			const result = await engine.sync();

			// Should detect the conflict
			expect(result.conflicts).toHaveLength(1);
			expect(result.conflicts[0].path).toBe("conflict.md");

			// Pull should NOT have overwritten the local file
			expect(result.pull.modified).not.toContain("conflict.md");
			expect(vault.files.get("conflict.md")).toBe("local version");

			// Push should NOT have pushed the conflicted file
			expect(result.push).toBeNull();
			expect(graphql.createCommit).not.toHaveBeenCalled();
		});

		it("handles conflict alongside non-conflicting changes", async () => {
			const { engine, vault, storage } = createIntegrationSetup({
				localFiles: [
					{ path: "conflict.md", content: "local version" },
					{ path: "local-new.md", content: "new local file" },
				],
				remoteFiles: [
					{ path: "conflict.md", sha: "sha-remote-v2", content: "remote version", size: 14 },
					{ path: "remote-new.md", sha: "sha-remote-new", content: "new remote", size: 10 },
				],
			});

			// conflict.md was synced before; both sides now have changes
			storage.data = {
				syncState: {
					lastRemoteHeadSha: "0000000000000000000000000000000000000001",
					lastSyncedAt: 1000,
					cache: {
						"conflict.md": {
							remoteSha: "sha-remote-v1",
							localContentHash: "old-hash",
							lastSyncedAt: 1000,
							size: 10,
							isBinary: false,
						},
					},
				},
			};

			const result = await engine.sync();

			// Conflict detected
			expect(result.conflicts).toHaveLength(1);
			expect(result.conflicts[0].path).toBe("conflict.md");

			// Non-conflicting remote file should be pulled
			expect(result.pull.created).toContain("remote-new.md");
			expect(vault.files.get("remote-new.md")).toBe("new remote");

			// Non-conflicting local file should be pushed
			expect(result.push).not.toBeNull();
			expect(result.push?.pushed).toContain("local-new.md");
			expect(result.push?.pushed).not.toContain("conflict.md");

			// Conflicted file should be untouched
			expect(vault.files.get("conflict.md")).toBe("local version");
		});
	});

	describe("conflict resolution strategies", () => {
		const conflictCache = {
			syncState: {
				lastRemoteHeadSha: "0000000000000000000000000000000000000001",
				lastSyncedAt: 1000,
				cache: {
					"conflict.md": {
						remoteSha: "sha-remote-v1",
						localContentHash: "old-local-hash",
						lastSyncedAt: 1000,
						size: 10,
						isBinary: false,
					},
				},
			},
		};

		it("local-wins pushes local version of conflicted file", async () => {
			const { engine, vault, graphql, storage } = createIntegrationSetup({
				localFiles: [{ path: "conflict.md", content: "local version" }],
				remoteFiles: [
					{ path: "conflict.md", sha: "sha-remote-v2", content: "remote version", size: 14 },
				],
				conflictStrategy: "local-wins",
			});

			storage.data = JSON.parse(JSON.stringify(conflictCache));

			const result = await engine.sync();

			expect(result.conflicts).toHaveLength(1);
			// Local file should NOT be overwritten by remote
			expect(vault.files.get("conflict.md")).toBe("local version");
			// Local version should be pushed
			expect(result.push).not.toBeNull();
			expect(graphql.createCommit).toHaveBeenCalled();
		});

		it("remote-wins pulls remote version of conflicted file", async () => {
			const { engine, vault, storage } = createIntegrationSetup({
				localFiles: [{ path: "conflict.md", content: "local version" }],
				remoteFiles: [
					{ path: "conflict.md", sha: "sha-remote-v2", content: "remote version", size: 14 },
				],
				conflictStrategy: "remote-wins",
			});

			storage.data = JSON.parse(JSON.stringify(conflictCache));

			const result = await engine.sync();

			expect(result.conflicts).toHaveLength(1);
			// Remote version should overwrite local
			expect(vault.files.get("conflict.md")).toBe("remote version");
			expect(result.pull.modified).toContain("conflict.md");
			// Local version should NOT be pushed
			expect(result.push).toBeNull();
		});

		it("ask strategy applies per-file decisions from callback", async () => {
			const onConflict = vi.fn().mockResolvedValue([{ path: "conflict.md", resolution: "local" }]);

			const { engine, vault, graphql, storage } = createIntegrationSetup({
				localFiles: [{ path: "conflict.md", content: "local version" }],
				remoteFiles: [
					{ path: "conflict.md", sha: "sha-remote-v2", content: "remote version", size: 14 },
				],
				conflictStrategy: "ask",
				onConflict,
			});

			storage.data = JSON.parse(JSON.stringify(conflictCache));

			const result = await engine.sync();

			expect(result.conflicts).toHaveLength(1);
			expect(result.resolvedCount).toBe(1);
			expect(onConflict).toHaveBeenCalled();
			// Local version should NOT be overwritten
			expect(vault.files.get("conflict.md")).toBe("local version");
			// Local version should be pushed
			expect(graphql.createCommit).toHaveBeenCalled();
		});

		it("ask strategy with skip-all keeps both sides untouched", async () => {
			const onConflict = vi.fn().mockResolvedValue([]);

			const { engine, vault, storage } = createIntegrationSetup({
				localFiles: [{ path: "conflict.md", content: "local version" }],
				remoteFiles: [
					{ path: "conflict.md", sha: "sha-remote-v2", content: "remote version", size: 14 },
				],
				conflictStrategy: "ask",
				onConflict,
			});

			storage.data = JSON.parse(JSON.stringify(conflictCache));

			const result = await engine.sync();

			expect(result.conflicts).toHaveLength(1);
			expect(result.resolvedCount).toBe(0);
			// Both sides untouched
			expect(vault.files.get("conflict.md")).toBe("local version");
			expect(result.push).toBeNull();
		});
	});

	describe("first sync merge — both sides non-empty", () => {
		it("identical files are cached without pull or push", async () => {
			const content = "same content";
			const { engine, vault, storage } = createIntegrationSetup({
				localFiles: [{ path: "shared.md", content }],
				remoteFiles: [{ path: "shared.md", sha: "mock-blob-sha", content, size: content.length }],
			});

			// Empty state = first sync
			storage.data = {};

			const result = await engine.sync();

			// Should NOT be a conflict
			expect(result.conflicts).toHaveLength(0);
			// Shared file should not be pulled (already exists locally with same content)
			expect(result.pull.created).not.toContain("shared.md");
			expect(result.pull.modified).not.toContain("shared.md");
			// Should not push shared file either (already on remote)
			// (but other local files like Welcome.md might be pushed)
			expect(vault.files.get("shared.md")).toBe(content);
		});

		it("different-content files become conflicts on first sync", async () => {
			const { engine, storage } = createIntegrationSetup({
				localFiles: [{ path: "diff.md", content: "local version" }],
				remoteFiles: [
					{ path: "diff.md", sha: "mock-blob-sha", content: "remote version", size: 14 },
				],
			});

			// Empty state = first sync
			storage.data = {};

			// local "local version" (13 chars) → hash-13
			// remote "remote version" (14 chars) → hash-14 → different → conflict
			const result = await engine.sync();

			expect(result.conflicts).toHaveLength(1);
			expect(result.conflicts[0].path).toBe("diff.md");
		});

		it("mixed: identical files cached, unique files synced, different files conflict", async () => {
			const sharedContent = "identical on both sides";
			const { engine, vault, storage } = createIntegrationSetup({
				localFiles: [
					{ path: "shared.md", content: sharedContent },
					{ path: "local-only.md", content: "only in vault" },
					{ path: "diff.md", content: "local diff" },
				],
				remoteFiles: [
					{
						path: "shared.md",
						sha: "mock-blob-sha",
						content: sharedContent,
						size: sharedContent.length,
					},
					{ path: "remote-only.md", sha: "mock-blob-sha", content: "only on remote", size: 14 },
					{ path: "diff.md", sha: "mock-blob-sha", content: "remote diff", size: 11 },
				],
			});

			storage.data = {};

			// shared.md: same content → hash-23 on both sides → identical
			// diff.md: "local diff" (10) → hash-10, "remote diff" (11) → hash-11 → conflict
			const result = await engine.sync();

			// shared.md: identical → no conflict, cached
			expect(result.conflicts.find((c) => c.path === "shared.md")).toBeUndefined();

			// remote-only.md: pulled
			expect(result.pull.created).toContain("remote-only.md");
			expect(vault.files.get("remote-only.md")).toBe("only on remote");

			// local-only.md: pushed
			expect(result.push).not.toBeNull();
			expect(result.push?.pushed).toContain("local-only.md");

			// diff.md: conflict (different content)
			expect(result.conflicts.find((c) => c.path === "diff.md")).toBeDefined();
		});
	});

	describe("network failure during push — state integrity", () => {
		it("does not corrupt state when graphql.createCommit throws", async () => {
			const { engine, graphql, storage } = createIntegrationSetup({
				localFiles: [{ path: "file.md", content: "content" }],
				remoteFiles: [],
			});

			vi.mocked(graphql.createCommit).mockRejectedValue(new Error("Network error"));

			await expect(engine.sync()).rejects.toThrow("Network error");

			// State should not have been saved with corrupted data
			// The state.save() in push happens AFTER createCommit,
			// so on error it should not have updated headOid or cache from push
			expect(engine.isSyncing).toBe(false);

			// Pull state should have been saved (pull completes before push)
			// but push state should NOT have been persisted
			const savedData = storage.data;
			if (savedData) {
				const syncState = savedData.syncState as {
					cache: Record<string, SHACacheEntry>;
					lastRemoteHeadSha: string;
				};
				// The cache should NOT contain entries written by the failed push
				// (PushEngine writes cache entries AFTER createCommit succeeds)
				const cachedFile = syncState.cache["file.md"];
				// If cached at all, it should only have pull-originated data (remote SHA)
				// Since file.md was not in remote tree, it should not be in cache
				if (cachedFile) {
					expect(cachedFile.remoteSha).not.toBe("");
				}
			}
		});

		it("allows retry after push failure", async () => {
			const { engine, graphql } = createIntegrationSetup({
				localFiles: [{ path: "retry.md", content: "retry content" }],
				remoteFiles: [],
			});

			// First attempt fails
			vi.mocked(graphql.createCommit).mockRejectedValueOnce(new Error("Temporary failure"));

			await expect(engine.sync()).rejects.toThrow("Temporary failure");
			expect(engine.isSyncing).toBe(false);

			// Second attempt succeeds
			vi.mocked(graphql.createCommit).mockResolvedValue({
				oid: "cc22dd33ee44ff55aa00bb11cc22dd33ee44ff55",
				url: "https://github.com/commit",
			});

			const result = await engine.sync();

			expect(result.push?.pushed).toContain("retry.md");
			expect(result.push?.oid).toBe("cc22dd33ee44ff55aa00bb11cc22dd33ee44ff55");
		});

		it("preserves pull results even when push fails", async () => {
			const { engine, vault, graphql } = createIntegrationSetup({
				localFiles: [{ path: "local.md", content: "local" }],
				remoteFiles: [{ path: "remote.md", sha: "sha-r", content: "from remote", size: 11 }],
			});

			vi.mocked(graphql.createCommit).mockRejectedValue(new Error("Push failed"));

			await expect(engine.sync()).rejects.toThrow("Push failed");

			// Even though push failed, pull should have written the file to vault
			expect(vault.files.get("remote.md")).toBe("from remote");
		});
	});

	describe("state persistence across sync cycles", () => {
		it("second sync detects no changes when nothing changed", async () => {
			const remoteFiles = [
				{ path: "stable.md", sha: "sha-stable", content: "stable content", size: 14 },
			];

			const vault = createMockVaultAdapter([]);
			const client = createMockGitHubClient(remoteFiles);
			const graphql = createMockGraphQL();
			const storage = createInMemoryStorage();
			const state = new SyncStateManager(storage);
			const logger = createMockLogger();

			const pullEngine = new PullEngine({ client, state, vault, logger, syncFolder: "" });
			const pushEngine = new PushEngine({ graphql, client, state, vault, logger, syncFolder: "" });

			const engine = new SyncEngine({
				pullEngine,
				pushEngine,
				state,
				vault,
				logger,
				commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
			});

			// computeHash mock returns deterministic hash based on content length
			// Pull now computes localContentHash, so after first sync the cache will have it.

			// First sync: pulls the remote file
			const first = await engine.sync();
			expect(first.pull.created).toContain("stable.md");

			// After first sync, vault has the file and cache is populated with localContentHash.
			// For second sync, listFiles must return the same hash that pull stored.
			const cached = state.getSHA("stable.md");
			const pulledHash = cached?.localContentHash ?? "";

			vi.mocked(vault.listFiles).mockImplementation(async () => {
				return [{ path: "stable.md", contentHash: pulledHash, size: 14 }];
			});

			// Second sync: should detect no pull or push changes
			const second = await engine.sync();
			expect(second.pull.created).toHaveLength(0);
			expect(second.pull.modified).toHaveLength(0);
			expect(second.pull.deleted).toHaveLength(0);
			expect(second.push).toBeNull();
		});
	});

	describe("syncFolder — full sync cycle with subfolder", () => {
		it("pulls only files inside syncFolder and maps paths to vault", async () => {
			const { engine, vault } = createIntegrationSetup({
				remoteFiles: [
					{ path: "docs/notes/hello.md", sha: "sha-hello", content: "Hello", size: 5 },
					{ path: "docs/readme.md", sha: "sha-readme", content: "README", size: 6 },
					{ path: "other/outside.md", sha: "sha-outside", content: "Outside", size: 7 },
				],
				syncFolder: "docs",
			});

			const result = await engine.sync();

			// Only files inside docs/ should appear, with vault-relative paths
			expect(result.pull.created).toContain("notes/hello.md");
			expect(result.pull.created).toContain("readme.md");
			expect(result.pull.created).not.toContain("other/outside.md");
			expect(result.pull.created).not.toContain("docs/notes/hello.md");

			expect(vault.files.get("notes/hello.md")).toBe("Hello");
			expect(vault.files.get("readme.md")).toBe("README");
			expect(vault.files.has("other/outside.md")).toBe(false);
		});

		it("pushes local files with syncFolder prefix in commit", async () => {
			const { engine, graphql } = createIntegrationSetup({
				localFiles: [{ path: "note.md", content: "local note" }],
				remoteFiles: [],
				syncFolder: "docs",
			});

			const result = await engine.sync();

			expect(result.push).not.toBeNull();
			expect(result.push?.pushed).toContain("note.md");
			expect(graphql.createCommit).toHaveBeenCalledWith(
				expect.objectContaining({
					additions: expect.arrayContaining([expect.objectContaining({ path: "docs/note.md" })]),
				}),
			);
		});

		it("full round-trip: pull from syncFolder then push local changes", async () => {
			const { engine, vault, graphql } = createIntegrationSetup({
				localFiles: [{ path: "local-only.md", content: "local content" }],
				remoteFiles: [
					{ path: "docs/remote-only.md", sha: "sha-remote", content: "remote content", size: 14 },
					{ path: "root-file.md", sha: "sha-root", content: "root", size: 4 },
				],
				syncFolder: "docs",
			});

			const result = await engine.sync();

			// Pull: only docs/remote-only.md pulled as remote-only.md
			expect(result.pull.created).toContain("remote-only.md");
			expect(result.pull.created).not.toContain("root-file.md");
			expect(vault.files.get("remote-only.md")).toBe("remote content");

			// Push: local-only.md pushed as docs/local-only.md
			expect(result.push).not.toBeNull();
			expect(result.push?.pushed).toContain("local-only.md");
			expect(graphql.createCommit).toHaveBeenCalledWith(
				expect.objectContaining({
					additions: expect.arrayContaining([
						expect.objectContaining({ path: "docs/local-only.md" }),
					]),
				}),
			);
		});

		it("empty syncFolder syncs entire repo (backward compatible)", async () => {
			const { engine, vault } = createIntegrationSetup({
				remoteFiles: [
					{ path: "notes/hello.md", sha: "sha-hello", content: "Hello", size: 5 },
					{ path: "other/file.md", sha: "sha-other", content: "Other", size: 5 },
				],
				syncFolder: "",
			});

			const result = await engine.sync();

			expect(result.pull.created).toContain("notes/hello.md");
			expect(result.pull.created).toContain("other/file.md");
			expect(vault.files.get("notes/hello.md")).toBe("Hello");
			expect(vault.files.get("other/file.md")).toBe("Other");
		});
	});

	describe("auth error between pull and push", () => {
		it("preserves pull state when push throws GitHubAuthError", async () => {
			const { engine, vault, graphql, state } = createIntegrationSetup({
				localFiles: [{ path: "local.md", content: "local content" }],
				remoteFiles: [
					{ path: "remote.md", sha: "sha-remote", content: "remote content", size: 14 },
				],
			});

			// Push fails with auth error
			vi.mocked(graphql.createCommit).mockRejectedValue(
				new Error("Authentication failed. Check your GitHub token."),
			);

			await expect(engine.sync()).rejects.toThrow("Authentication failed");

			// Pull should have written the remote file before push failed
			expect(vault.files.get("remote.md")).toBe("remote content");
			// State from pull should have been persisted (pull saves before push runs)
			expect(state.getHeadOid()).toBe("aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33");
		});
	});

	describe("GraphQL conflict error (stale HEAD OID)", () => {
		it("propagates conflict error when push HEAD OID is stale", async () => {
			const { engine, graphql } = createIntegrationSetup({
				localFiles: [{ path: "file.md", content: "local content" }],
				remoteFiles: [],
			});

			vi.mocked(graphql.createCommit).mockRejectedValue(
				new Error("Conflict: remote has changed since last sync."),
			);

			await expect(engine.sync()).rejects.toThrow("Conflict: remote has changed since last sync.");
			expect(engine.isSyncing).toBe(false);
		});
	});

	describe("network failure during pull — partial results", () => {
		it("succeeds for some files and reports errors for failed ones", async () => {
			const { engine, vault, client } = createIntegrationSetup({
				remoteFiles: [
					{ path: "ok.md", sha: "sha-ok", content: "ok content", size: 10 },
					{ path: "fail.md", sha: "sha-fail", content: "fail content", size: 12 },
				],
			});

			// Override getFileContent: ok.md succeeds, fail.md throws
			vi.mocked(client.getFileContent).mockImplementation((path: string) => {
				if (path === "fail.md") return Promise.reject(new Error("connection reset"));
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce("sha-ok");
				return Promise.resolve({ content: btoa("ok content"), sha: "sha-ok", size: 10 });
			});

			const result = await engine.sync();

			expect(result.pull.created).toContain("ok.md");
			expect(result.pull.created).not.toContain("fail.md");
			expect(result.pull.errors).toEqual(
				expect.arrayContaining([{ path: "fail.md", error: "connection reset" }]),
			);
			expect(vault.files.get("ok.md")).toBe("ok content");
		});
	});

	describe("network failure mid-pull — multiple files", () => {
		it("fails for files after network error and retries detect them on next sync", async () => {
			const remoteFiles = [
				{ path: "a.md", sha: "sha-a", content: "content a", size: 9 },
				{ path: "b.md", sha: "sha-b", content: "content b", size: 9 },
				{ path: "c.md", sha: "sha-c", content: "content c", size: 9 },
				{ path: "d.md", sha: "sha-d", content: "content d", size: 9 },
			];

			const vault = createMockVaultAdapter([]);
			const headSha1 = "aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33";
			const client = createMockGitHubClient(remoteFiles, headSha1);
			const graphql = createMockGraphQL();
			const storage = createInMemoryStorage();
			const state = new SyncStateManager(storage);
			const logger = createMockLogger();

			const pullEngine = new PullEngine({ client, state, vault, logger, syncFolder: "" });
			const pushEngine = new PushEngine({
				graphql,
				client,
				state,
				vault,
				logger,
				syncFolder: "",
			});

			const engine = new SyncEngine({
				pullEngine,
				pushEngine,
				state,
				vault,
				logger,
				commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
			});

			// First two succeed, then network errors for the rest
			let callCount = 0;
			vi.mocked(client.getFileContent).mockImplementation((path: string) => {
				callCount++;
				if (callCount <= 2) {
					const file = remoteFiles.find((f) => f.path === path);
					if (!file) return Promise.reject(new Error(`Not found: ${path}`));
					vi.mocked(computeGitBlobSha).mockResolvedValueOnce(file.sha);
					return Promise.resolve({
						content: btoa(file.content),
						sha: file.sha,
						size: file.size,
					});
				}
				return Promise.reject(new Error("Network error"));
			});

			// First sync: some files fail with network error
			const result1 = await engine.sync();

			// Some files were pulled, some errored
			const pulledCount = result1.pull.created.length;
			const errorCount = result1.pull.errors.length;
			expect(pulledCount).toBeGreaterThan(0);
			expect(errorCount).toBeGreaterThan(0);
			expect(pulledCount + errorCount).toBe(4);

			// After first sync, headOid is updated. Simulate remote advancing
			// to a new commit so the second sync still detects unpulled files.
			const headSha2 = "bb11cc22dd33ee44ff55aa00bb11cc22dd33ee44";
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: headSha2 });
			vi.mocked(client.getCommit).mockResolvedValue({ sha: headSha2, treeSha: "tree-sha" });

			// On retry, restore getFileContent to work for all files
			vi.mocked(client.getFileContent).mockImplementation((path: string) => {
				const file = remoteFiles.find((f) => f.path === path);
				if (!file) return Promise.reject(new Error(`Not found: ${path}`));
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce(file.sha);
				return Promise.resolve({
					content: btoa(file.content),
					sha: file.sha,
					size: file.size,
				});
			});

			// Update vault.listFiles to include already-pulled files
			const pulledFiles = result1.pull.created;
			vi.mocked(vault.listFiles).mockImplementation(async () => {
				const items: LocalFileInfo[] = [];
				for (const p of pulledFiles) {
					const cached = state.getSHA(p);
					items.push({
						path: p,
						contentHash: cached?.localContentHash ?? "hash-9",
						size: 9,
					});
				}
				return items;
			});

			// Second sync: previously failed files should still be detected
			// because they are in remote tree but not in cache
			const result2 = await engine.sync();

			// The files that failed before should now be pulled
			expect(result2.pull.created.length).toBeGreaterThan(0);
			expect(result2.pull.errors).toHaveLength(0);

			// All 4 files should now be in vault
			for (const f of remoteFiles) {
				expect(vault.files.has(f.path)).toBe(true);
			}
		});
	});

	describe("rate limit hit during sync", () => {
		it("aborts cleanly without data corruption when rate limit is hit", async () => {
			const remoteFiles = [
				{ path: "file1.md", sha: "sha-1", content: "content 1", size: 9 },
				{ path: "file2.md", sha: "sha-2", content: "content 2", size: 9 },
				{ path: "file3.md", sha: "sha-3", content: "content 3", size: 9 },
			];

			const vault = createMockVaultAdapter([]);
			const client = createMockGitHubClient(remoteFiles);
			const graphql = createMockGraphQL();
			const storage = createInMemoryStorage();
			const state = new SyncStateManager(storage);
			const logger = createMockLogger();

			const pullEngine = new PullEngine({ client, state, vault, logger, syncFolder: "" });
			const pushEngine = new PushEngine({
				graphql,
				client,
				state,
				vault,
				logger,
				syncFolder: "",
			});

			const engine = new SyncEngine({
				pullEngine,
				pushEngine,
				state,
				vault,
				logger,
				commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
			});

			// getRef and getTree succeed (they set up remote changes),
			// but getFileContent throws GitHubRateLimitError on all calls
			const { GitHubRateLimitError } = await import("../types");
			const resetAt = new Date(Date.now() + 3600 * 1000);

			vi.mocked(client.getFileContent).mockRejectedValue(new GitHubRateLimitError(resetAt));

			// Sync should complete (pull handles per-file errors gracefully)
			const result = await engine.sync();

			// All files should have errors
			expect(result.pull.errors).toHaveLength(3);
			for (const err of result.pull.errors) {
				expect(err.error).toContain("rate limit");
			}

			// No files should be created in vault
			expect(result.pull.created).toHaveLength(0);
			expect(result.pull.modified).toHaveLength(0);

			// State should still be consistent — head OID updated to remote
			expect(state.getHeadOid()).toBe("aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33");

			// No push should have happened (no local files)
			expect(result.push).toBeNull();

			// Sync mutex released
			expect(engine.isSyncing).toBe(false);
		});
	});

	describe("Compare API 300-file boundary", () => {
		it("falls back to full tree when compare returns exactly 300 files", async () => {
			// Build 300 compare files and matching remote files
			const remoteFiles: MockRemoteFile[] = [];
			const compareFiles: Array<{
				filename: string;
				status: "added";
				sha: string;
			}> = [];

			for (let i = 0; i < 300; i++) {
				const path = `file-${String(i).padStart(3, "0")}.md`;
				const content = `content ${i}`;
				remoteFiles.push({ path, sha: `sha-${i}`, content, size: content.length });
				compareFiles.push({ filename: path, status: "added", sha: `sha-${i}` });
			}

			const vault = createMockVaultAdapter([]);
			const client = createMockGitHubClient(remoteFiles);
			const graphql = createMockGraphQL();
			const storage = createInMemoryStorage();
			const state = new SyncStateManager(storage);
			const logger = createMockLogger();

			const pullEngine = new PullEngine({ client, state, vault, logger, syncFolder: "" });
			const pushEngine = new PushEngine({
				graphql,
				client,
				state,
				vault,
				logger,
				syncFolder: "",
			});

			const engine = new SyncEngine({
				pullEngine,
				pushEngine,
				state,
				vault,
				logger,
				commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
			});

			// Pre-populate state with a known head so incremental path is attempted
			const prevHead = "1100220033004400550066007700880099001100";
			storage.data = {
				syncState: {
					lastRemoteHeadSha: prevHead,
					lastSyncedAt: 1000,
					cache: {},
				},
			};

			const currentHead = "aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33";

			// Mock compareCommits to return exactly 300 files (the limit)
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 300,
				files: compareFiles,
				headSha: currentHead,
			});

			await engine.sync();

			// compareCommits should have been called (incremental attempted)
			expect(client.compareCommits).toHaveBeenCalledWith(prevHead, currentHead);

			// Because files.length === 300 (not < 300), it should fall back to getTree
			// getTree is called during full tree path (fetchRefAndTree / fetchTreeForRef)
			expect(client.getTree).toHaveBeenCalled();
		});

		it("uses compare results when under 300 files", async () => {
			const remoteFiles = [{ path: "new.md", sha: "sha-new", content: "new content", size: 11 }];

			const vault = createMockVaultAdapter([]);
			const client = createMockGitHubClient(remoteFiles);
			const graphql = createMockGraphQL();
			const storage = createInMemoryStorage();
			const state = new SyncStateManager(storage);
			const logger = createMockLogger();

			const pullEngine = new PullEngine({ client, state, vault, logger, syncFolder: "" });
			const pushEngine = new PushEngine({
				graphql,
				client,
				state,
				vault,
				logger,
				syncFolder: "",
			});

			const engine = new SyncEngine({
				pullEngine,
				pushEngine,
				state,
				vault,
				logger,
				commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
			});

			const prevHead = "1100220033004400550066007700880099001100";
			storage.data = {
				syncState: {
					lastRemoteHeadSha: prevHead,
					lastSyncedAt: 1000,
					cache: {},
				},
			};

			const currentHead = "aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33";

			// Only 1 file — well under limit
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 1,
				files: [{ filename: "new.md", status: "added", sha: "sha-new" }],
				headSha: currentHead,
			});

			// Reset getTree mock call count
			vi.mocked(client.getTree).mockClear();

			await engine.sync();

			// compareCommits was used
			expect(client.compareCommits).toHaveBeenCalled();
			// getTree should NOT have been called (no fallback needed)
			// Note: getTree is called by updateCacheFromCommit after push, but
			// getCommit is the gatekeeper — if no push, no getTree
			// Since there are no local files, push is null, so no updateCacheFromCommit
			expect(client.getTree).not.toHaveBeenCalled();
		});
	});

	describe("corrupted state recovery", () => {
		it("handles invalid cache entries gracefully", async () => {
			const remoteFiles = [
				{ path: "valid.md", sha: "sha-valid", content: "valid content", size: 13 },
			];

			const vault = createMockVaultAdapter([
				{ path: "valid.md", content: "valid content" },
				{ path: "local.md", content: "local only" },
			]);
			const client = createMockGitHubClient(remoteFiles);
			const graphql = createMockGraphQL();
			const storage = createInMemoryStorage();
			const state = new SyncStateManager(storage);
			const logger = createMockLogger();

			const pullEngine = new PullEngine({ client, state, vault, logger, syncFolder: "" });
			const pushEngine = new PushEngine({
				graphql,
				client,
				state,
				vault,
				logger,
				syncFolder: "",
			});

			const engine = new SyncEngine({
				pullEngine,
				pushEngine,
				state,
				vault,
				logger,
				commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
			});

			// Pre-populate state with a mix of valid and invalid entries
			storage.data = {
				syncState: {
					lastRemoteHeadSha: "0000000000000000000000000000000000000001",
					lastSyncedAt: 1000,
					cache: {
						// Valid entry
						"valid.md": {
							remoteSha: "sha-valid",
							localContentHash: "hash-13",
							lastSyncedAt: 1000,
							size: 13,
							isBinary: false,
						},
						// Invalid: empty remoteSha (still passes type check but is logically empty)
						"ghost.md": {
							remoteSha: "",
							localContentHash: "",
							lastSyncedAt: 0,
							size: 0,
							isBinary: false,
						},
						// Invalid: completely wrong shape — SyncStateManager.load filters these out
						"broken.md": "not-an-object" as unknown as {
							remoteSha: string;
							localContentHash: string;
							lastSyncedAt: number;
							size: number;
							isBinary: boolean;
						},
						// Invalid: missing required fields — filtered by isValidCacheEntry
						"partial.md": {
							remoteSha: "sha-partial",
						} as unknown as {
							remoteSha: string;
							localContentHash: string;
							lastSyncedAt: number;
							size: number;
							isBinary: boolean;
						},
					},
				},
			};

			// Sync should not crash
			const result = await engine.sync();

			// Engine completed without throwing
			expect(engine.isSyncing).toBe(false);

			// valid.md: remoteSha matches tree, no remote change; local content hash matches
			// so it should not be pulled or pushed
			expect(result.pull.created).not.toContain("valid.md");
			expect(result.pull.modified).not.toContain("valid.md");

			// ghost.md: in cache (empty remoteSha) but not in remote tree → remote delete.
			// Also not in vault → local delete. Delete-delete = conflict (both sides agree).
			// With default "skip" strategy, it's skipped — but detected as a conflict.
			expect(result.conflicts.find((c) => c.path === "ghost.md")).toBeDefined();

			// broken.md and partial.md should be filtered out by state.load()
			// so they don't appear in cache at all — no spurious deletes or errors
			expect(result.conflicts.find((c) => c.path === "broken.md")).toBeUndefined();
			expect(result.conflicts.find((c) => c.path === "partial.md")).toBeUndefined();

			// local.md should be pushed (new file not in cache)
			expect(result.push).not.toBeNull();
			expect(result.push?.pushed).toContain("local.md");
		});

		it("recovers from completely corrupted syncState object", async () => {
			const remoteFiles = [
				{ path: "fresh.md", sha: "sha-fresh", content: "fresh content", size: 13 },
			];

			const vault = createMockVaultAdapter([]);
			const client = createMockGitHubClient(remoteFiles);
			const graphql = createMockGraphQL();
			const storage = createInMemoryStorage();
			const state = new SyncStateManager(storage);
			const logger = createMockLogger();

			const pullEngine = new PullEngine({ client, state, vault, logger, syncFolder: "" });
			const pushEngine = new PushEngine({
				graphql,
				client,
				state,
				vault,
				logger,
				syncFolder: "",
			});

			const engine = new SyncEngine({
				pullEngine,
				pushEngine,
				state,
				vault,
				logger,
				commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
			});

			// Completely corrupted state
			storage.data = {
				syncState: "this is not a valid state object" as unknown as Record<string, unknown>,
			};

			// Sync should treat this as first sync and not crash
			const result = await engine.sync();

			expect(result.pull.created).toContain("fresh.md");
			expect(vault.files.get("fresh.md")).toBe("fresh content");
			expect(engine.isSyncing).toBe(false);
		});

		it("recovers from invalid lastRemoteHeadSha", async () => {
			const remoteFiles = [{ path: "note.md", sha: "sha-note", content: "note content", size: 12 }];

			const vault = createMockVaultAdapter([]);
			const client = createMockGitHubClient(remoteFiles);
			const graphql = createMockGraphQL();
			const storage = createInMemoryStorage();
			const state = new SyncStateManager(storage);
			const logger = createMockLogger();

			const pullEngine = new PullEngine({ client, state, vault, logger, syncFolder: "" });
			const pushEngine = new PushEngine({
				graphql,
				client,
				state,
				vault,
				logger,
				syncFolder: "",
			});

			const engine = new SyncEngine({
				pullEngine,
				pushEngine,
				state,
				vault,
				logger,
				commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
			});

			// Invalid HEAD SHA (not 40 hex chars) — should be reset to ""
			storage.data = {
				syncState: {
					lastRemoteHeadSha: "not-a-valid-sha",
					lastSyncedAt: 1000,
					cache: {},
				},
			};

			// Should treat as first sync (empty head) and pull fresh
			const result = await engine.sync();

			expect(result.pull.created).toContain("note.md");
			expect(vault.files.get("note.md")).toBe("note content");
			expect(engine.isSyncing).toBe(false);
		});
	});

	describe("large changeset warning", () => {
		it("logs warning for >10000 remote files but pulls all of them", async () => {
			// Create >10000 remote files
			const remoteFiles = Array.from({ length: 10_001 }, (_, i) => ({
				path: `file-${String(i).padStart(5, "0")}.md`,
				sha: `sha-${i}`,
				content: `content ${i}`,
				size: 10,
			}));

			const vault = createMockVaultAdapter([]);
			const client = createMockGitHubClient(remoteFiles);
			const graphql = createMockGraphQL();
			const storage = createInMemoryStorage();
			const state = new SyncStateManager(storage);
			const logger = createMockLogger();

			const pullEngine = new PullEngine({ client, state, vault, logger, syncFolder: "" });
			const pushEngine = new PushEngine({
				graphql,
				client,
				state,
				vault,
				logger,
				syncFolder: "",
			});

			const engine = new SyncEngine({
				pullEngine,
				pushEngine,
				state,
				vault,
				logger,
				commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
			});

			const result = await engine.sync();

			// All files should be pulled (no truncation)
			expect(result.pull.created.length).toBe(10_001);
			// Warning should be logged
			expect(logger.warn).toHaveBeenCalledWith(
				"Large pull detected — this may take a while",
				expect.objectContaining({ files: 10_001, threshold: 10_000 }),
			);
		});
	});

	describe("incremental pull via Compare API", () => {
		it("pulls incrementally when compareCommits returns ahead status", async () => {
			const { engine, vault, client, storage, state } = createIntegrationSetup({
				remoteFiles: [
					{ path: "existing.md", sha: "sha-existing", content: "existing", size: 8 },
					{ path: "new-remote.md", sha: "sha-new", content: "new remote file", size: 15 },
				],
			});

			// Pre-populate state: simulate a previous sync with known head
			const prevHead = "1100220033004400550066007700880099001100";
			storage.data = {
				syncState: {
					lastRemoteHeadSha: prevHead,
					lastSyncedAt: 1000,
					cache: {
						"existing.md": {
							remoteSha: "sha-existing",
							localContentHash: "hash-8",
							lastSyncedAt: 1000,
							size: 8,
							isBinary: false,
						},
					},
				},
			};

			// Mock compareCommits to return "ahead" with the new file
			const currentHead = "aa00bb11cc22dd33ee44ff55aa00bb11cc22dd33";
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 1,
				files: [{ filename: "new-remote.md", status: "added", sha: "sha-new" }],
				headSha: currentHead,
			});

			// Provide existing.md in vault so it's not pushed
			vault.files.set("existing.md", "existing");

			const result = await engine.sync();

			// Should have used compareCommits (incremental path)
			expect(client.compareCommits).toHaveBeenCalledWith(prevHead, currentHead);
			// New file should be pulled
			expect(result.pull.created).toContain("new-remote.md");
			expect(vault.files.get("new-remote.md")).toBe("new remote file");
			// Head OID should be updated
			expect(state.getHeadOid()).toBe(currentHead);
		});
	});
});

// ---------------------------------------------------------------------------
// Auto-sync E2E — real ChangeQueue + SyncEngine wired together
// ---------------------------------------------------------------------------

describe("Auto-sync E2E", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function createAutoSyncSetup(options?: {
		remoteFiles?: MockRemoteFile[];
		localFiles?: MockVaultFile[];
		debounceMs?: number;
	}) {
		const setup = createIntegrationSetup({
			localFiles: options?.localFiles ?? [],
			remoteFiles: options?.remoteFiles ?? [],
		});

		const syncSpy = vi.spyOn(setup.engine, "sync");

		const queue = new ChangeQueue({
			debounceMs: options?.debounceMs ?? 1000,
			onReady: () => {
				setup.engine.sync();
			},
		});

		return { ...setup, queue, syncSpy };
	}

	it("vault file change triggers sync after debounce", () => {
		const { queue, syncSpy } = createAutoSyncSetup();

		queue.push("note.md", "modify");
		expect(syncSpy).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1000);
		expect(syncSpy).toHaveBeenCalledTimes(1);
	});

	it("multiple rapid changes debounce into single sync", () => {
		const { queue, syncSpy } = createAutoSyncSetup({ debounceMs: 500 });

		queue.push("a.md", "create");
		vi.advanceTimersByTime(200);
		queue.push("b.md", "modify");
		vi.advanceTimersByTime(200);
		queue.push("c.md", "delete");
		vi.advanceTimersByTime(200);

		// 600ms since last push, but only 200ms since last change
		expect(syncSpy).not.toHaveBeenCalled();

		vi.advanceTimersByTime(300);
		expect(syncSpy).toHaveBeenCalledTimes(1);
	});

	it("rename (delete old + create new) triggers single sync", () => {
		const { queue, syncSpy } = createAutoSyncSetup();

		// Simulate rename event as main.ts does it
		queue.push("old-name.md", "delete");
		queue.push("new-name.md", "create");

		vi.advanceTimersByTime(1000);
		expect(syncSpy).toHaveBeenCalledTimes(1);
	});

	it("excluded paths do not trigger sync", () => {
		const { queue, syncSpy } = createAutoSyncSetup();

		queue.push(".obsidian/workspace.json", "modify");
		queue.push(".trash/deleted.md", "delete");
		queue.push("ghvault.log", "modify");

		vi.advanceTimersByTime(1000);
		expect(syncSpy).not.toHaveBeenCalled();
	});

	it("pause prevents sync, resume triggers sync for collected events", () => {
		const { queue, syncSpy } = createAutoSyncSetup();

		queue.push("note.md", "modify");
		vi.advanceTimersByTime(500);

		queue.pause();
		vi.advanceTimersByTime(1000);
		expect(syncSpy).not.toHaveBeenCalled();

		// Events during pause are collected
		queue.push("edited-during-sync.md", "modify");

		queue.resume();
		// Resume starts debounce for collected events
		vi.advanceTimersByTime(1000);
		expect(syncSpy).toHaveBeenCalledTimes(1);
	});

	it("create + delete cancels out and does not trigger sync", () => {
		const { queue, syncSpy } = createAutoSyncSetup();

		queue.push("temp.md", "create");
		queue.push("temp.md", "delete");

		vi.advanceTimersByTime(1000);
		expect(syncSpy).not.toHaveBeenCalled();
	});

	it("destroy stops pending sync", () => {
		const { queue, syncSpy } = createAutoSyncSetup();

		queue.push("note.md", "modify");
		vi.advanceTimersByTime(500);

		queue.destroy();
		vi.advanceTimersByTime(1000);
		expect(syncSpy).not.toHaveBeenCalled();
	});
});
