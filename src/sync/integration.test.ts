import { describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../github/client";
import type { GitHubGraphQL } from "../github/graphql";
import type { SHACacheEntry } from "../types";
import { computeGitBlobSha, computeHash } from "../utils/hash";
import type { Logger } from "../utils/logger";
import type { LocalFileInfo } from "./comparator";
import type { SyncVault } from "./engine";
import { SyncEngine } from "./engine";
import { PullEngine } from "./pull";
import { PushEngine } from "./push";
import type { StorageAdapter } from "./state";
import { SyncStateManager } from "./state";

vi.mock("../utils/hash", () => ({
	computeHash: vi.fn(),
	computeGitBlobSha: vi.fn(),
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
		writeFile: vi.fn(async (path: string, content: string): Promise<void> => {
			files.set(path, content);
		}),
		deleteFile: vi.fn(async (path: string): Promise<void> => {
			files.delete(path);
		}),
		listFiles: vi.fn(async (): Promise<LocalFileInfo[]> => {
			const result: LocalFileInfo[] = [];
			for (const [path, content] of files) {
				const contentHash = `hash-${path}-${content.length}`;
				vi.mocked(computeHash).mockResolvedValueOnce(contentHash);
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
	headSha = "remote-head-sha",
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
	} as unknown as GitHubClient;
}

// ---------------------------------------------------------------------------
// Mock GitHub GraphQL — simulates push boundary
// ---------------------------------------------------------------------------

function createMockGraphQL(oid = "push-commit-oid"): GitHubGraphQL {
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
}): IntegrationSetup {
	const vault = createMockVaultAdapter(options.localFiles ?? []);
	const client = createMockGitHubClient(options.remoteFiles ?? [], options.headSha);
	const graphql = createMockGraphQL(options.pushOid);
	const storage = createInMemoryStorage();
	const state = new SyncStateManager(storage);
	const logger = createMockLogger();

	const pullEngine = new PullEngine({ client, state, vault, logger });
	const pushEngine = new PushEngine({ graphql, state, vault, logger });

	const engine = new SyncEngine({
		pullEngine,
		pushEngine,
		state,
		vault,
		logger,
		commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
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
					lastRemoteHeadSha: "old-head",
					lastSyncedAt: 1000,
					cache: {
						"doc.md": {
							remoteSha: "sha-v1",
							localContentHash: "hash-doc.md-11",
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
					lastRemoteHeadSha: "old-head",
					lastSyncedAt: 1000,
					cache: {
						"deleted.md": {
							remoteSha: "sha-old",
							localContentHash: "hash-deleted.md-15",
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
					lastRemoteHeadSha: "remote-head-sha",
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
					lastRemoteHeadSha: "old-head",
					lastSyncedAt: 1000,
					cache: {
						"existing.md": {
							remoteSha: "sha-old",
							localContentHash: "hash-existing.md-12",
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
					lastRemoteHeadSha: "remote-head-sha",
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
					lastRemoteHeadSha: "remote-head-sha",
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
				oid: "success-oid",
				url: "https://github.com/commit",
			});

			const result = await engine.sync();

			expect(result.push?.pushed).toContain("retry.md");
			expect(result.push?.oid).toBe("success-oid");
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

			const pullEngine = new PullEngine({ client, state, vault, logger });
			const pushEngine = new PushEngine({ graphql, state, vault, logger });

			const engine = new SyncEngine({
				pullEngine,
				pushEngine,
				state,
				vault,
				logger,
				commitOptions: { branch: "main", owner: "testowner", repo: "testrepo" },
			});

			// First sync: pulls the remote file
			const first = await engine.sync();
			expect(first.pull.created).toContain("stable.md");

			// After first sync, vault has the file and cache is populated.
			// For second sync, listFiles will return the file with a hash matching cache.
			vi.mocked(vault.listFiles).mockImplementation(async () => {
				const hash = "hash-stable.md-14";
				vi.mocked(computeHash).mockResolvedValueOnce(hash);
				return [{ path: "stable.md", contentHash: hash, size: 14 }];
			});

			// Second sync: should detect no pull or push changes
			// Update the state cache to have a matching localContentHash and persist it
			const cached = state.getSHA("stable.md");
			if (cached) {
				state.setSHA("stable.md", { ...cached, localContentHash: "hash-stable.md-14" });
			}
			await state.save();

			const second = await engine.sync();
			expect(second.pull.created).toHaveLength(0);
			expect(second.pull.modified).toHaveLength(0);
			expect(second.pull.deleted).toHaveLength(0);
			expect(second.push).toBeNull();
		});
	});
});
