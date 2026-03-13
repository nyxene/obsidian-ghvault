import { describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../github/client";
import { GitHubEmptyRepoError, GitHubNotFoundError } from "../types";
import { computeGitBlobSha, computeHashFromBuffer } from "../utils/hash";
import type { Logger } from "../utils/logger";
import type { VaultAdapter } from "./pull";
import { PullEngine } from "./pull";
import type { SyncStateManager } from "./state";

vi.mock("../utils/hash", () => ({
	computeGitBlobSha: vi.fn(),
	computeHash: vi
		.fn()
		.mockImplementation((content: string) => Promise.resolve(`hash-${content.length}`)),
	computeHashFromBuffer: vi.fn().mockImplementation((data: ArrayBuffer | Uint8Array) => {
		const len = data instanceof Uint8Array ? data.length : data.byteLength;
		return Promise.resolve(`hash-${len}`);
	}),
}));

function createMockClient(
	treeEntries: Array<{ path: string; sha: string; size?: number }> = [],
): GitHubClient {
	return {
		getRef: vi.fn().mockResolvedValue({ ref: "refs/heads/main", sha: "head-sha" }),
		getCommit: vi.fn().mockResolvedValue({ sha: "head-sha", treeSha: "tree-sha" }),
		getTree: vi.fn().mockResolvedValue({
			entries: treeEntries.map((e) => ({
				path: e.path,
				sha: e.sha,
				mode: "100644",
				type: "blob" as const,
				size: e.size ?? 100,
			})),
			truncated: false,
		}),
		getFileContent: vi.fn().mockImplementation((path: string) => {
			const entry = treeEntries.find((e) => e.path === path);
			const sha = entry?.sha ?? "unknown-sha";
			vi.mocked(computeGitBlobSha).mockResolvedValueOnce(sha);
			return Promise.resolve({
				content: btoa(`content of ${path}`),
				sha,
				size: entry?.size ?? 100,
			});
		}),
	} as unknown as GitHubClient;
}

function createMockState(cache: Record<string, { remoteSha: string }> = {}): SyncStateManager {
	const fullCache: Record<string, unknown> = {};
	for (const [path, entry] of Object.entries(cache)) {
		fullCache[path] = {
			remoteSha: entry.remoteSha,
			localContentHash: "",
			lastSyncedAt: 1000,
			size: 100,
			isBinary: false,
		};
	}

	return {
		getAllSHAs: vi.fn().mockReturnValue(fullCache),
		setSHA: vi.fn(),
		deleteSHA: vi.fn(),
		setHeadOid: vi.fn(),
		setLastSyncedAt: vi.fn(),
		save: vi.fn().mockResolvedValue(undefined),
	} as unknown as SyncStateManager;
}

function createMockVault(): VaultAdapter {
	return {
		writeFile: vi.fn().mockResolvedValue(undefined),
		writeFileBinary: vi.fn().mockResolvedValue(undefined),
		deleteFile: vi.fn().mockResolvedValue(undefined),
	};
}

function createMockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		setLevel: vi.fn(),
	} as unknown as Logger;
}

function createEngine(
	overrides: {
		client?: GitHubClient;
		state?: SyncStateManager;
		vault?: VaultAdapter;
		syncFolder?: string;
	} = {},
): { engine: PullEngine; client: GitHubClient; state: SyncStateManager; vault: VaultAdapter } {
	const client = overrides.client ?? createMockClient();
	const state = overrides.state ?? createMockState();
	const vault = overrides.vault ?? createMockVault();
	const syncFolder = overrides.syncFolder ?? "";
	const engine = new PullEngine({ client, state, vault, logger: createMockLogger(), syncFolder });
	return { engine, client, state, vault };
}

describe("PullEngine", () => {
	it("handles no remote changes", async () => {
		const { engine, state } = createEngine();

		const result = await engine.pull("main");

		expect(result.created).toEqual([]);
		expect(result.modified).toEqual([]);
		expect(result.deleted).toEqual([]);
		expect(result.errors).toEqual([]);
		expect(state.setHeadOid).toHaveBeenCalledWith("head-sha");
		expect(state.save).toHaveBeenCalled();
	});

	it("downloads new remote files", async () => {
		const client = createMockClient([{ path: "new.md", sha: "sha-new" }]);
		const state = createMockState({});
		const vault = createMockVault();
		const { engine } = createEngine({ client, state, vault });

		const result = await engine.pull("main");

		expect(result.created).toEqual(["new.md"]);
		expect(vault.writeFile).toHaveBeenCalledWith("new.md", "content of new.md");
		expect(state.setSHA).toHaveBeenCalledWith(
			"new.md",
			expect.objectContaining({
				remoteSha: "sha-new",
			}),
		);
	});

	it("downloads modified remote files", async () => {
		const client = createMockClient([{ path: "doc.md", sha: "sha-v2" }]);
		const state = createMockState({ "doc.md": { remoteSha: "sha-v1" } });
		const vault = createMockVault();
		const { engine } = createEngine({ client, state, vault });

		const result = await engine.pull("main");

		expect(result.modified).toEqual(["doc.md"]);
		expect(vault.writeFile).toHaveBeenCalledWith("doc.md", "content of doc.md");
		expect(state.setSHA).toHaveBeenCalledWith(
			"doc.md",
			expect.objectContaining({
				remoteSha: "sha-v2",
			}),
		);
	});

	it("deletes locally files removed from remote", async () => {
		const client = createMockClient([]);
		const state = createMockState({ "gone.md": { remoteSha: "sha-old" } });
		const vault = createMockVault();
		const { engine } = createEngine({ client, state, vault });

		const result = await engine.pull("main");

		expect(result.deleted).toEqual(["gone.md"]);
		expect(vault.deleteFile).toHaveBeenCalledWith("gone.md");
		expect(state.deleteSHA).toHaveBeenCalledWith("gone.md");
	});

	it("handles mixed changes", async () => {
		const client = createMockClient([
			{ path: "new.md", sha: "sha-new" },
			{ path: "changed.md", sha: "sha-v2" },
			{ path: "same.md", sha: "sha-same" },
		]);
		const state = createMockState({
			"changed.md": { remoteSha: "sha-v1" },
			"same.md": { remoteSha: "sha-same" },
			"deleted.md": { remoteSha: "sha-del" },
		});
		const vault = createMockVault();
		const { engine } = createEngine({ client, state, vault });

		const result = await engine.pull("main");

		expect(result.created).toEqual(["new.md"]);
		expect(result.modified).toEqual(["changed.md"]);
		expect(result.deleted).toEqual(["deleted.md"]);
		expect(result.errors).toEqual([]);
	});

	it("collects per-file errors without stopping", async () => {
		const client = createMockClient([
			{ path: "ok.md", sha: "sha-ok" },
			{ path: "fail.md", sha: "sha-fail" },
		]);
		vi.mocked(client.getFileContent).mockImplementation((path: string) => {
			if (path === "fail.md") return Promise.reject(new Error("network error"));
			vi.mocked(computeGitBlobSha).mockResolvedValueOnce("sha-ok");
			return Promise.resolve({ content: btoa("ok"), sha: "sha-ok", size: 2 });
		});
		const state = createMockState({});
		const vault = createMockVault();
		const { engine } = createEngine({ client, state, vault });

		const result = await engine.pull("main");

		expect(result.created).toEqual(["ok.md"]);
		expect(result.errors).toEqual([{ path: "fail.md", error: "network error" }]);
		expect(state.save).toHaveBeenCalled();
	});

	it("updates head OID and lastSyncedAt after pull", async () => {
		const client = createMockClient([{ path: "file.md", sha: "sha" }]);
		const state = createMockState({});
		const { engine } = createEngine({ client, state });

		await engine.pull("main");

		expect(state.setHeadOid).toHaveBeenCalledWith("head-sha");
		expect(state.setLastSyncedAt).toHaveBeenCalledWith(expect.any(Number));
		expect(state.save).toHaveBeenCalled();
	});

	it("fetches tree recursively", async () => {
		const client = createMockClient([]);
		const { engine } = createEngine({ client });

		await engine.pull("main");

		expect(client.getTree).toHaveBeenCalledWith("tree-sha", true);
	});

	it("skips unsafe paths from remote", async () => {
		const client = createMockClient([
			{ path: "../etc/passwd", sha: "sha-evil" },
			{ path: "safe.md", sha: "sha-safe" },
		]);
		const state = createMockState({});
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

		const result = await engine.pull("main");

		expect(result.created).toEqual(["safe.md"]);
		expect(result.errors).toEqual(
			expect.arrayContaining([{ path: "../etc/passwd", error: "Unsafe path rejected" }]),
		);
		expect(vault.writeFile).not.toHaveBeenCalledWith("../etc/passwd", expect.anything());
		expect(logger.warn).toHaveBeenCalledWith("Skipping unsafe path from remote", {
			path: "../etc/passwd",
		});
	});

	it("skips oversized files from remote (>50MB)", async () => {
		const oversized = 51 * 1024 * 1024;
		const client = createMockClient([
			{ path: "huge.bin", sha: "sha-huge", size: oversized },
			{ path: "small.md", sha: "sha-small", size: 100 },
		]);
		const state = createMockState({});
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

		const result = await engine.pull("main");

		expect(result.created).toEqual(["small.md"]);
		expect(result.errors).toEqual(
			expect.arrayContaining([expect.objectContaining({ path: "huge.bin" })]),
		);
		expect(vault.writeFile).not.toHaveBeenCalledWith("huge.bin", expect.anything());
		expect(logger.warn).toHaveBeenCalledWith("Skipping oversized file", {
			path: "huge.bin",
			size: oversized,
			maxSize: 50 * 1024 * 1024,
		});
	});

	it("rejects file when SHA integrity check fails (real computeGitBlobSha)", async () => {
		// Restore real computeGitBlobSha for this test
		vi.mocked(computeGitBlobSha).mockRestore();
		const { computeGitBlobSha: realComputeGitBlobSha } =
			await vi.importActual<typeof import("../utils/hash")>("../utils/hash");
		vi.mocked(computeGitBlobSha).mockImplementation(realComputeGitBlobSha);

		const client = createMockClient([{ path: "tampered.md", sha: "sha-tampered" }]);
		// Override getFileContent to return content whose real SHA won't match "sha-tampered"
		vi.mocked(client.getFileContent).mockResolvedValue({
			content: btoa("some content"),
			sha: "sha-tampered",
			size: 12,
		});

		const state = createMockState({});
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

		const result = await engine.pull("main");

		expect(result.created).toEqual([]);
		expect(result.errors).toEqual([
			{
				path: "tampered.md",
				error: "SHA integrity check failed — content may be tampered",
			},
		]);
		expect(vault.writeFile).not.toHaveBeenCalled();
		expect(state.setSHA).not.toHaveBeenCalled();
	});

	it("stores correct localContentHash in cache after download", async () => {
		const client = createMockClient([{ path: "new.md", sha: "sha-new" }]);
		const state = createMockState({});
		const vault = createMockVault();
		const { engine } = createEngine({ client, state, vault });

		vi.mocked(computeHashFromBuffer).mockResolvedValueOnce("computed-content-hash");

		const result = await engine.pull("main");

		expect(result.created).toEqual(["new.md"]);
		expect(computeHashFromBuffer).toHaveBeenCalled();
		expect(state.setSHA).toHaveBeenCalledWith(
			"new.md",
			expect.objectContaining({
				remoteSha: "sha-new",
				localContentHash: "computed-content-hash",
			}),
		);
	});

	it("writes binary files via writeFileBinary", async () => {
		const client = createMockClient([{ path: "image.png", sha: "sha-img" }]);
		// Return base64 of binary content with null byte (PNG header)
		const binaryBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
		const binaryStr = String.fromCharCode(...binaryBytes);
		vi.mocked(client.getFileContent).mockResolvedValue({
			content: btoa(binaryStr),
			sha: "sha-img",
			size: 7,
		});
		vi.mocked(computeGitBlobSha).mockResolvedValueOnce("sha-img");
		const state = createMockState({});
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

		const result = await engine.pull("main");

		expect(result.created).toEqual(["image.png"]);
		expect(result.errors).toEqual([]);
		expect(vault.writeFileBinary).toHaveBeenCalledWith("image.png", expect.any(ArrayBuffer));
		expect(vault.writeFile).not.toHaveBeenCalled();
		expect(state.setSHA).toHaveBeenCalledWith(
			"image.png",
			expect.objectContaining({ isBinary: true }),
		);
	});

	it("treats text file with null byte as binary (false positive handled correctly)", async () => {
		const client = createMockClient([{ path: "data.csv", sha: "sha-csv" }]);
		// CSV-like content with an embedded null byte — detected as binary
		const contentWithNull = "id,name\n1,test\x002,hello\n";
		const bytes = new Uint8Array([...contentWithNull].map((c) => c.charCodeAt(0)));
		const binaryStr = String.fromCharCode(...bytes);
		vi.mocked(client.getFileContent).mockResolvedValue({
			content: btoa(binaryStr),
			sha: "sha-csv",
			size: bytes.length,
		});
		vi.mocked(computeGitBlobSha).mockResolvedValueOnce("sha-csv");
		const state = createMockState({});
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

		const result = await engine.pull("main");

		expect(result.created).toEqual(["data.csv"]);
		expect(result.errors).toEqual([]);
		// File with null byte is treated as binary — written via writeFileBinary
		expect(vault.writeFileBinary).toHaveBeenCalledWith("data.csv", expect.any(ArrayBuffer));
		expect(vault.writeFile).not.toHaveBeenCalled();
		expect(state.setSHA).toHaveBeenCalledWith(
			"data.csv",
			expect.objectContaining({ isBinary: true }),
		);
	});

	it("throws on invalid base64 content from GitHub API", async () => {
		const client = createMockClient([{ path: "bad.md", sha: "sha-bad" }]);
		vi.mocked(client.getFileContent).mockResolvedValue({
			content: "not-valid-base64!!!@@@",
			sha: "sha-bad",
			size: 10,
		});
		const state = createMockState({});
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

		const result = await engine.pull("main");

		expect(result.errors).toEqual([
			{ path: "bad.md", error: "Invalid base64 content received from GitHub API" },
		]);
		expect(vault.writeFile).not.toHaveBeenCalled();
	});

	it("handles pull with only deletes (no HTTP downloads)", async () => {
		const client = createMockClient([]);
		const state = createMockState({
			"a.md": { remoteSha: "sha-a" },
			"b.md": { remoteSha: "sha-b" },
		});
		const vault = createMockVault();
		const { engine } = createEngine({ client, state, vault });

		const result = await engine.pull("main");

		expect(result.deleted).toEqual(["a.md", "b.md"]);
		expect(result.created).toEqual([]);
		expect(result.modified).toEqual([]);
		expect(client.getFileContent).not.toHaveBeenCalled();
	});

	it("initializes empty repo with .ghvault file at repo root", async () => {
		const client = createMockClient();
		vi.mocked(client.getRef).mockRejectedValue(new GitHubEmptyRepoError());
		(client as unknown as Record<string, unknown>).createFile = vi
			.fn()
			.mockResolvedValue({ sha: "file-sha", commitSha: "init-commit-sha" });
		const state = createMockState();
		const { engine } = createEngine({ client, state });

		const result = await engine.pull("main");

		expect(
			(client as unknown as { createFile: ReturnType<typeof vi.fn> }).createFile,
		).toHaveBeenCalledWith(".ghvault", "initialized", "chore: initialize repository", "main");
		expect(state.setHeadOid).toHaveBeenCalledWith("init-commit-sha");
		expect(state.setLastSyncedAt).toHaveBeenCalledWith(expect.any(Number));
		expect(state.save).toHaveBeenCalled();
		expect(result.created).toEqual([]);
		expect(result.modified).toEqual([]);
		expect(result.deleted).toEqual([]);
	});

	it("initializes empty repo with .ghvault inside syncFolder", async () => {
		const client = createMockClient();
		vi.mocked(client.getRef).mockRejectedValue(new GitHubEmptyRepoError());
		(client as unknown as Record<string, unknown>).createFile = vi
			.fn()
			.mockResolvedValue({ sha: "file-sha", commitSha: "init-commit-sha" });
		const state = createMockState();
		const { engine } = createEngine({ client, state, syncFolder: "docs/vault" });

		await engine.pull("main");

		expect(
			(client as unknown as { createFile: ReturnType<typeof vi.fn> }).createFile,
		).toHaveBeenCalledWith(
			"docs/vault/.ghvault",
			"initialized",
			"chore: initialize repository",
			"main",
		);
	});

	it("logs warning when tree response is truncated", async () => {
		const client = createMockClient([{ path: "file.md", sha: "sha-1" }]);
		vi.mocked(client.getTree).mockResolvedValue({
			entries: [{ path: "file.md", sha: "sha-1", mode: "100644", type: "blob", size: 100 }],
			truncated: true,
		});
		const state = createMockState({});
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

		await engine.pull("main");

		expect(logger.warn).toHaveBeenCalledWith("Tree response truncated — some files may be missed");
	});

	it("handles GitHubNotFoundError from getTree as empty tree during pull", async () => {
		const client = createMockClient();
		vi.mocked(client.getTree).mockRejectedValue(new GitHubNotFoundError("tree-sha"));
		const state = createMockState({});
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

		const result = await engine.pull("main");

		expect(logger.info).toHaveBeenCalledWith("Tree is empty (no files in repo)");
		expect(result.created).toEqual([]);
		expect(result.errors).toEqual([]);
		expect(state.setHeadOid).toHaveBeenCalledWith("head-sha");
		expect(state.save).toHaveBeenCalled();
	});

	it("rethrows non-NotFoundError from getTree during pull", async () => {
		const client = createMockClient();
		vi.mocked(client.getTree).mockRejectedValue(new Error("network timeout"));
		const { engine } = createEngine({ client });

		await expect(engine.pull("main")).rejects.toThrow("network timeout");
	});

	describe("updateCacheFromCommit", () => {
		it("updates cache entries from commit tree", async () => {
			const client = createMockClient([
				{ path: "a.md", sha: "new-sha-a" },
				{ path: "b.md", sha: "new-sha-b" },
			]);
			const state = createMockState({
				"a.md": { remoteSha: "old-sha-a" },
			});
			(state as unknown as Record<string, unknown>).getSHA = vi.fn((path: string) => {
				if (path === "a.md") {
					return {
						remoteSha: "old-sha-a",
						localContentHash: "",
						lastSyncedAt: 1000,
						size: 100,
						isBinary: false,
					};
				}
				return undefined;
			});
			const { engine } = createEngine({ client, state });

			await engine.updateCacheFromCommit("commit-oid");

			expect(client.getCommit).toHaveBeenCalledWith("commit-oid");
			expect(client.getTree).toHaveBeenCalledWith("tree-sha", true);
			expect(state.setSHA).toHaveBeenCalledWith(
				"a.md",
				expect.objectContaining({ remoteSha: "new-sha-a" }),
			);
			// b.md is not in cache, so setSHA should not be called for it
			expect(state.setSHA).not.toHaveBeenCalledWith("b.md", expect.anything());
			expect(state.save).toHaveBeenCalled();
		});

		it("silently handles GitHubNotFoundError from getTree", async () => {
			const client = createMockClient();
			vi.mocked(client.getTree).mockRejectedValue(new GitHubNotFoundError("tree-sha"));
			const state = createMockState({ "a.md": { remoteSha: "sha-a" } });
			const { engine } = createEngine({ client, state });

			// Should not throw
			await engine.updateCacheFromCommit("commit-oid");

			// Should still save (with no setSHA calls)
			expect(state.setSHA).not.toHaveBeenCalled();
			expect(state.save).toHaveBeenCalled();
		});

		it("rethrows non-NotFoundError from getTree", async () => {
			const client = createMockClient();
			vi.mocked(client.getTree).mockRejectedValue(new Error("server error"));
			const state = createMockState();
			const { engine } = createEngine({ client, state });

			await expect(engine.updateCacheFromCommit("commit-oid")).rejects.toThrow("server error");
		});
	});

	describe("syncFolder support", () => {
		it("filters tree entries to only files inside syncFolder", async () => {
			const client = createMockClient([
				{ path: "docs/notes/hello.md", sha: "sha-hello" },
				{ path: "docs/readme.md", sha: "sha-readme" },
				{ path: "other/outside.md", sha: "sha-outside" },
			]);
			const state = createMockState({});
			const vault = createMockVault();
			const { engine } = createEngine({ client, state, vault, syncFolder: "docs" });

			const result = await engine.pull("main");

			// Only files inside docs/ should be pulled, mapped to vault paths
			expect(result.created).toContain("notes/hello.md");
			expect(result.created).toContain("readme.md");
			expect(result.created).not.toContain("other/outside.md");
			expect(vault.writeFile).toHaveBeenCalledWith("notes/hello.md", expect.any(String));
			expect(vault.writeFile).toHaveBeenCalledWith("readme.md", expect.any(String));
			expect(vault.writeFile).not.toHaveBeenCalledWith("other/outside.md", expect.any(String));
		});

		it("uses repo path for API calls when syncFolder is set", async () => {
			const client = createMockClient([{ path: "docs/note.md", sha: "sha-note" }]);
			const state = createMockState({});
			const vault = createMockVault();
			const { engine } = createEngine({ client, state, vault, syncFolder: "docs" });

			await engine.pull("main");

			// API call should use repo path (docs/note.md), not vault path (note.md)
			expect(client.getFileContent).toHaveBeenCalledWith("docs/note.md", "main");
		});

		it("stores cache entries with vault paths when syncFolder is set", async () => {
			const client = createMockClient([{ path: "docs/note.md", sha: "sha-note" }]);
			const state = createMockState({});
			const vault = createMockVault();
			const { engine } = createEngine({ client, state, vault, syncFolder: "docs" });

			await engine.pull("main");

			// Cache should use vault path (note.md), not repo path (docs/note.md)
			expect(state.setSHA).toHaveBeenCalledWith(
				"note.md",
				expect.objectContaining({ remoteSha: "sha-note" }),
			);
			expect(state.setSHA).not.toHaveBeenCalledWith("docs/note.md", expect.anything());
		});

		it("empty syncFolder syncs entire repo (backward compatible)", async () => {
			const client = createMockClient([
				{ path: "notes/hello.md", sha: "sha-hello" },
				{ path: "other/file.md", sha: "sha-other" },
			]);
			const state = createMockState({});
			const vault = createMockVault();
			const { engine } = createEngine({ client, state, vault, syncFolder: "" });

			const result = await engine.pull("main");

			expect(result.created).toContain("notes/hello.md");
			expect(result.created).toContain("other/file.md");
		});

		it("getRemoteChanges respects syncFolder", async () => {
			const client = createMockClient([
				{ path: "docs/inside.md", sha: "sha-inside" },
				{ path: "outside.md", sha: "sha-outside" },
			]);
			const state = createMockState({});
			const { engine } = createEngine({ client, state, syncFolder: "docs" });

			const changes = await engine.getRemoteChanges("main");

			const paths = changes.map((c) => c.path);
			expect(paths).toContain("inside.md");
			expect(paths).not.toContain("outside.md");
			expect(paths).not.toContain("docs/inside.md");
		});

		it("updateCacheFromCommit maps repo paths to vault paths with syncFolder", async () => {
			const client = createMockClient([
				{ path: "docs/a.md", sha: "new-sha-a" },
				{ path: "outside.md", sha: "sha-out" },
			]);
			const state = createMockState({
				"a.md": { remoteSha: "old-sha-a" },
			});
			(state as unknown as Record<string, unknown>).getSHA = vi.fn((path: string) => {
				if (path === "a.md") {
					return {
						remoteSha: "old-sha-a",
						localContentHash: "",
						lastSyncedAt: 1000,
						size: 100,
						isBinary: false,
					};
				}
				return undefined;
			});
			const { engine } = createEngine({ client, state, syncFolder: "docs" });

			await engine.updateCacheFromCommit("commit-oid");

			// Should update cache using vault path "a.md", not "docs/a.md"
			expect(state.setSHA).toHaveBeenCalledWith(
				"a.md",
				expect.objectContaining({ remoteSha: "new-sha-a" }),
			);
			// Should not update cache for outside.md (outside syncFolder)
			expect(state.setSHA).not.toHaveBeenCalledWith("outside.md", expect.anything());
		});
	});
});
