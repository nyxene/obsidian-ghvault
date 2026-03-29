import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../github/client";
import { GitHubEmptyRepoError, GitHubNotFoundError } from "../types";
import { computeGitBlobSha, computeHashFromBuffer } from "../utils/hash";
import type { Logger } from "../utils/logger";
import { processZipEntries } from "../utils/zip";
import type { VaultAdapter } from "./pull";
import { PullEngine } from "./pull";
import type { SyncStateManager } from "./state";

vi.mock("../utils/zip", () => ({
	processZipEntries: vi.fn().mockResolvedValue(0),
}));

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
		downloadZipball: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
		compareCommits: vi.fn().mockRejectedValue(new Error("Not mocked")),
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
		getSHA: vi.fn().mockImplementation((path: string) => fullCache[path] ?? null),
		setSHA: vi.fn(),
		deleteSHA: vi.fn(),
		getHeadOid: vi.fn().mockReturnValue(""),
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
		renameFile: vi.fn().mockResolvedValue(undefined),
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

	it("accepts file when SHA integrity check passes (real computeGitBlobSha)", async () => {
		// Restore real computeGitBlobSha for this test
		vi.mocked(computeGitBlobSha).mockRestore();
		const { computeGitBlobSha: realComputeGitBlobSha } =
			await vi.importActual<typeof import("../utils/hash")>("../utils/hash");
		vi.mocked(computeGitBlobSha).mockImplementation(realComputeGitBlobSha);

		// Compute the real git blob SHA for "hello world" content
		// Git blob SHA = SHA-1("blob <size>\0<content>")
		// For "hello world" (11 bytes): blob 11\0hello world
		const content = "hello world";
		const contentBytes = new TextEncoder().encode(content);
		const blobPrefix = `blob ${contentBytes.length}\0`;
		const prefixBytes = new TextEncoder().encode(blobPrefix);
		const fullBlob = new Uint8Array(prefixBytes.length + contentBytes.length);
		fullBlob.set(prefixBytes, 0);
		fullBlob.set(contentBytes, prefixBytes.length);
		const hashBuffer = await crypto.subtle.digest("SHA-1", fullBlob);
		const realSha = Array.from(new Uint8Array(hashBuffer))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

		const client = createMockClient([{ path: "valid.md", sha: realSha }]);
		vi.mocked(client.getFileContent).mockResolvedValue({
			content: btoa(content),
			sha: realSha,
			size: contentBytes.length,
		});

		const state = createMockState({});
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

		const result = await engine.pull("main");

		expect(result.created).toEqual(["valid.md"]);
		expect(result.errors).toEqual([]);
		expect(vault.writeFile).toHaveBeenCalledWith("valid.md", content);
		expect(state.setSHA).toHaveBeenCalledWith(
			"valid.md",
			expect.objectContaining({ remoteSha: realSha }),
		);
	});

	it("skips file exceeding 50MB after download in pullPerFile", async () => {
		const oversizedBytes = 51 * 1024 * 1024;
		const client = createMockClient([{ path: "huge.bin", sha: "sha-huge", size: 100 }]);

		// Create base64 that decodes to >50MB (AAAA... = null bytes)
		const bigBase64 = "A".repeat(Math.ceil((oversizedBytes * 4) / 3));
		vi.mocked(client.getFileContent).mockResolvedValue({
			content: bigBase64,
			sha: "sha-huge",
			size: oversizedBytes,
		});

		const state = createMockState({});
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

		const result = await engine.pull("main");

		expect(result.created).toEqual([]);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].path).toBe("huge.bin");
		expect(result.errors[0].error).toContain("File too large");
		expect(vault.writeFile).not.toHaveBeenCalled();
		expect(vault.writeFileBinary).not.toHaveBeenCalled();
	}, 15_000);

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

	describe("rate limit mid-download", () => {
		it("collects rate limit error for one file while writing the other", async () => {
			const client = createMockClient([
				{ path: "ok.md", sha: "sha-ok" },
				{ path: "limited.md", sha: "sha-limited" },
			]);
			vi.mocked(client.getFileContent).mockImplementation((path: string) => {
				if (path === "limited.md") {
					return Promise.reject(
						new (class extends Error {
							readonly resetAt = new Date();
							constructor() {
								super("GitHub rate limit exceeded. Resets at 2026-01-01T00:00:00.000Z");
								this.name = "GitHubRateLimitError";
							}
						})(),
					);
				}
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce("sha-ok");
				return Promise.resolve({ content: btoa("ok content"), sha: "sha-ok", size: 10 });
			});
			const state = createMockState({});
			const vault = createMockVault();
			const logger = createMockLogger();
			const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

			const result = await engine.pull("main");

			expect(result.created).toEqual(["ok.md"]);
			expect(vault.writeFile).toHaveBeenCalledWith("ok.md", "ok content");
			expect(result.errors).toEqual([
				expect.objectContaining({
					path: "limited.md",
					error: expect.stringContaining("rate limit"),
				}),
			]);
			expect(state.setHeadOid).toHaveBeenCalledWith("head-sha");
			expect(state.save).toHaveBeenCalled();
		});
	});

	describe("delete error handling", () => {
		it("collects error when deleteFile throws and continues other deletes", async () => {
			const client = createMockClient([]);
			const state = createMockState({
				"fail-delete.md": { remoteSha: "sha-1" },
				"ok-delete.md": { remoteSha: "sha-2" },
			});
			const vault = createMockVault();
			vi.mocked(vault.deleteFile).mockImplementation((path: string) => {
				if (path === "fail-delete.md") return Promise.reject(new Error("permission denied"));
				return Promise.resolve();
			});
			const logger = createMockLogger();
			const engine = new PullEngine({ client, state, vault, logger, syncFolder: "" });

			const result = await engine.pull("main");

			expect(result.deleted).toEqual(["ok-delete.md"]);
			expect(result.errors).toEqual([{ path: "fail-delete.md", error: "permission denied" }]);
			// State should only be cleaned for the successful delete
			expect(state.deleteSHA).toHaveBeenCalledWith("ok-delete.md");
			expect(state.deleteSHA).not.toHaveBeenCalledWith("fail-delete.md");
			// Pull should still complete and save state
			expect(state.setHeadOid).toHaveBeenCalledWith("head-sha");
			expect(state.save).toHaveBeenCalled();
		});
	});

	describe("skipPaths filtering", () => {
		it("excludes changes in skipPaths set from pull", async () => {
			const client = createMockClient([
				{ path: "local-change.md", sha: "sha-local" },
				{ path: "remote-only.md", sha: "sha-remote" },
			]);
			const state = createMockState({});
			const vault = createMockVault();
			const { engine } = createEngine({ client, state, vault });

			const skipPaths = new Set(["local-change.md"]);
			const result = await engine.pull("main", skipPaths);

			expect(result.created).toEqual(["remote-only.md"]);
			expect(result.created).not.toContain("local-change.md");
			expect(vault.writeFile).not.toHaveBeenCalledWith("local-change.md", expect.anything());
			expect(vault.writeFile).toHaveBeenCalledWith("remote-only.md", expect.any(String));
		});

		it("skips deletes in skipPaths set", async () => {
			const client = createMockClient([]);
			const state = createMockState({
				"local-edit.md": { remoteSha: "sha-1" },
				"truly-deleted.md": { remoteSha: "sha-2" },
			});
			const vault = createMockVault();
			const { engine } = createEngine({ client, state, vault });

			const skipPaths = new Set(["local-edit.md"]);
			const result = await engine.pull("main", skipPaths);

			expect(result.deleted).toEqual(["truly-deleted.md"]);
			expect(result.deleted).not.toContain("local-edit.md");
			expect(vault.deleteFile).not.toHaveBeenCalledWith("local-edit.md");
			expect(vault.deleteFile).toHaveBeenCalledWith("truly-deleted.md");
		});

		it("pulls all changes when skipPaths is empty", async () => {
			const client = createMockClient([
				{ path: "a.md", sha: "sha-a" },
				{ path: "b.md", sha: "sha-b" },
			]);
			const state = createMockState({});
			const vault = createMockVault();
			const { engine } = createEngine({ client, state, vault });

			const result = await engine.pull("main", new Set());

			expect(result.created).toEqual(["a.md", "b.md"]);
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

	describe("ZIP pull strategy", () => {
		beforeEach(() => {
			vi.mocked(computeGitBlobSha).mockReset();
			vi.mocked(computeHashFromBuffer).mockReset();
			vi.mocked(computeHashFromBuffer).mockResolvedValue("content-hash");
			vi.mocked(processZipEntries).mockReset();
		});

		function createManyFiles(count: number): Array<{ path: string; sha: string; size: number }> {
			return Array.from({ length: count }, (_, i) => ({
				path: `file-${i}.md`,
				sha: `sha-${i}`,
				size: 100,
			}));
		}

		it("uses ZIP when syncFolder is empty and >5 files to download", async () => {
			const files = createManyFiles(8);
			const client = createMockClient(files);
			const state = createMockState();
			const vault = createMockVault();

			// Mock processZipEntries to simulate extracting files
			vi.mocked(processZipEntries).mockImplementation(async (_buf, onEntry) => {
				for (const f of files) {
					vi.mocked(computeGitBlobSha).mockResolvedValueOnce(f.sha);
					await onEntry(f.path, new TextEncoder().encode(`content of ${f.path}`));
				}
				return files.length;
			});

			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.pull("main");

			expect(client.downloadZipball).toHaveBeenCalledWith("head-sha");
			expect(client.getFileContent).not.toHaveBeenCalled();
			expect(result.created).toHaveLength(8);
		});

		it("uses per-file when syncFolder is set", async () => {
			const files = createManyFiles(8).map((f) => ({ ...f, path: `docs/${f.path}` }));
			const client = createMockClient(files);
			const state = createMockState();
			const vault = createMockVault();

			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "docs",
			});

			const result = await engine.pull("main");

			expect(client.downloadZipball).not.toHaveBeenCalled();
			expect(client.getFileContent).toHaveBeenCalled();
			expect(result.created).toHaveLength(8);
		});

		it("uses per-file when 5 or fewer files to download", async () => {
			const files = createManyFiles(3);
			const client = createMockClient(files);
			const state = createMockState();
			const vault = createMockVault();

			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.pull("main");

			expect(client.downloadZipball).not.toHaveBeenCalled();
			expect(result.created).toHaveLength(3);
		});

		it("falls back to per-file when ZIP download fails", async () => {
			const files = createManyFiles(8);
			const client = createMockClient(files);
			(client.downloadZipball as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error("Network error"),
			);
			const state = createMockState();
			const vault = createMockVault();

			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.pull("main");

			// Should have fallen back to per-file
			expect(client.downloadZipball).toHaveBeenCalled();
			expect(client.getFileContent).toHaveBeenCalled();
			expect(result.created).toHaveLength(8);
		});

		it("falls back to per-file for files not found in ZIP", async () => {
			const files = createManyFiles(8);
			const client = createMockClient(files);
			const state = createMockState();
			const vault = createMockVault();

			// ZIP only contains 5 of 8 files
			vi.mocked(processZipEntries).mockImplementation(async (_buf, onEntry) => {
				for (let i = 0; i < 5; i++) {
					vi.mocked(computeGitBlobSha).mockResolvedValueOnce(files[i].sha);
					await onEntry(files[i].path, new TextEncoder().encode("content"));
				}
				return 5;
			});

			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.pull("main");

			// 5 from ZIP + 3 from per-file fallback
			expect(client.getFileContent).toHaveBeenCalledTimes(3);
			expect(result.created).toHaveLength(8);
		});

		it("rejects ZIP entries that fail SHA integrity check", async () => {
			const files = createManyFiles(8);
			const client = createMockClient(files);
			const state = createMockState();
			const vault = createMockVault();

			vi.mocked(processZipEntries).mockImplementation(async (_buf, onEntry) => {
				// First file has wrong SHA
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce("wrong-sha");
				await onEntry(files[0].path, new TextEncoder().encode("tampered"));
				// Rest are OK
				for (let i = 1; i < files.length; i++) {
					vi.mocked(computeGitBlobSha).mockResolvedValueOnce(files[i].sha);
					await onEntry(files[i].path, new TextEncoder().encode("content"));
				}
				return files.length;
			});

			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.pull("main");

			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].path).toBe("file-0.md");
			expect(result.errors[0].error).toContain("SHA integrity");
			// file-0.md stays in downloadPaths (SHA failed) → fallback picks it up via per-file
			expect(client.getFileContent).toHaveBeenCalled();
			expect(result.created).toHaveLength(8);
		});

		it("falls back when processZipEntries throws", async () => {
			const files = createManyFiles(8);
			const client = createMockClient(files);
			const state = createMockState();
			const vault = createMockVault();

			vi.mocked(processZipEntries).mockRejectedValue(new Error("corrupt ZIP"));

			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.pull("main");

			// All 8 should fall back to per-file
			expect(client.getFileContent).toHaveBeenCalledTimes(8);
			expect(result.created).toHaveLength(8);
		});

		it("skips excluded paths in ZIP entries", async () => {
			const files = [
				...createManyFiles(6),
				{ path: ".obsidian/config.json", sha: "sha-obs", size: 50 },
				{ path: "ghvault.log", sha: "sha-log", size: 30 },
			];
			const client = createMockClient(files);
			const state = createMockState();
			const vault = createMockVault();

			vi.mocked(processZipEntries).mockImplementation(async (_buf, onEntry) => {
				for (const f of files) {
					vi.mocked(computeGitBlobSha).mockResolvedValueOnce(f.sha);
					await onEntry(f.path, new TextEncoder().encode("content"));
				}
				return files.length;
			});

			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.pull("main");

			// Only the 6 non-excluded files should be created
			expect(result.created).toHaveLength(6);
			expect(result.created).not.toContain(".obsidian/config.json");
			expect(result.created).not.toContain("ghvault.log");
		});

		it("handles binary files in ZIP via writeFileBinary", async () => {
			const files = [...createManyFiles(6), { path: "image.png", sha: "sha-png", size: 200 }];
			const client = createMockClient(files);
			const state = createMockState();
			const vault = createMockVault();

			vi.mocked(processZipEntries).mockImplementation(async (_buf, onEntry) => {
				// Text files
				for (let i = 0; i < 6; i++) {
					vi.mocked(computeGitBlobSha).mockResolvedValueOnce(files[i].sha);
					await onEntry(files[i].path, new TextEncoder().encode("text content"));
				}
				// Binary file: bytes with null byte to trigger hasBinaryContent
				const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce("sha-png");
				await onEntry("image.png", binaryData);
				return 7;
			});

			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.pull("main");

			expect(result.created).toHaveLength(7);
			expect(result.created).toContain("image.png");
			expect(vault.writeFileBinary).toHaveBeenCalled();
		});
	});

	describe("remote rename handling", () => {
		beforeEach(() => {
			vi.mocked(computeGitBlobSha).mockReset();
			vi.mocked(computeHashFromBuffer).mockReset();
			vi.mocked(computeHashFromBuffer).mockResolvedValue("content-hash");
		});

		it("renames file via vault.renameFile and updates cache", async () => {
			const client = createMockClient([{ path: "new-name.md", sha: "sha-new" }]);
			const state = createMockState({
				"old-name.md": { remoteSha: "sha-old" },
			});
			(state as unknown as Record<string, unknown>).getSHA = vi.fn().mockReturnValue({
				remoteSha: "sha-old",
				localContentHash: "hash",
				lastSyncedAt: 1000,
				size: 10,
				isBinary: false,
			});
			const vault = createMockVault();
			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");
			const result = await engine.pull("main", undefined, [
				{ oldPath: "old-name.md", newPath: "new-name.md" },
			]);

			expect(vault.renameFile).toHaveBeenCalledWith("old-name.md", "new-name.md");
			expect(result.renamed).toHaveLength(1);
			expect(state.deleteSHA).toHaveBeenCalledWith("old-name.md");
			expect(state.setSHA).toHaveBeenCalledWith("new-name.md", expect.anything());
		});

		it("catches error when renameFile throws and adds to errors", async () => {
			const client = createMockClient([{ path: "new.md", sha: "sha-new" }]);
			const state = createMockState({
				"old.md": { remoteSha: "sha-old" },
			});
			(state as unknown as Record<string, unknown>).getSHA = vi.fn().mockReturnValue({
				remoteSha: "sha-old",
				localContentHash: "hash",
				lastSyncedAt: 1000,
				size: 10,
				isBinary: false,
			});
			const vault = createMockVault();
			(vault.renameFile as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error("File not found: old.md"),
			);
			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");
			const result = await engine.pull("main", undefined, [
				{ oldPath: "old.md", newPath: "new.md" },
			]);

			expect(result.renamed).toHaveLength(0);
			// Rename error reported
			const renameError = result.errors.find((e) => e.path === "old.md");
			expect(renameError).toBeDefined();
			expect(renameError?.error).toContain("File not found");
			// new.md is still downloaded as a regular create (rename failed,
			// so renamePaths does not include new.md)
			expect(result.created).toContain("new.md");
		});
	});

	describe("incremental pull via Compare API", () => {
		beforeEach(() => {
			vi.mocked(computeGitBlobSha).mockReset();
			vi.mocked(computeHashFromBuffer).mockReset();
			vi.mocked(computeHashFromBuffer).mockResolvedValue("content-hash");
		});

		it("uses Compare API when headOid is set", async () => {
			const client = createMockClient([{ path: "a.md", sha: "sha-a" }]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 1,
				files: [{ filename: "a.md", status: "added", sha: "sha-a" }],
				headSha: "new-head",
			});

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const engine = new PullEngine({
				client,
				state,
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			const changes = await engine.getRemoteChanges("main");
			expect(changes).toHaveLength(1);
			expect(changes[0]).toEqual({ path: "a.md", type: "create" });
			// Should NOT call getCommit/getTree (incremental path)
			expect(client.getCommit).not.toHaveBeenCalled();
			expect(client.getTree).not.toHaveBeenCalled();
		});

		it("falls back to full tree when headOid is empty (first sync)", async () => {
			const client = createMockClient([{ path: "a.md", sha: "sha-new" }]);

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("");

			const engine = new PullEngine({
				client,
				state,
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");
			// Should use full tree path
			expect(client.getCommit).toHaveBeenCalled();
			expect(client.getTree).toHaveBeenCalled();
		});

		it("falls back to full tree on diverged status", async () => {
			const client = createMockClient([{ path: "a.md", sha: "sha-a" }]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "diverged",
				aheadBy: 5,
				files: [{ filename: "a.md", status: "modified", sha: "s" }],
				headSha: "new-head",
			});

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const engine = new PullEngine({
				client,
				state,
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");
			// Should fall back to full tree
			expect(client.getCommit).toHaveBeenCalled();
			expect(client.getTree).toHaveBeenCalled();
		});

		it("falls back to full tree when compare has 300+ files", async () => {
			const manyFiles = Array.from({ length: 300 }, (_, i) => ({
				filename: `file-${i}.md`,
				status: "modified" as const,
				sha: `sha-${i}`,
			}));

			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 300,
				files: manyFiles,
				headSha: "new-head",
			});

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const engine = new PullEngine({
				client,
				state,
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");
			expect(client.getCommit).toHaveBeenCalled();
			expect(client.getTree).toHaveBeenCalled();
		});

		it("returns empty changes when remote SHA matches local head", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "same-sha" });

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("same-sha");

			const engine = new PullEngine({
				client,
				state,
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			const changes = await engine.getRemoteChanges("main");
			expect(changes).toHaveLength(0);
		});

		it("applies syncFolder to compare results", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 1,
				files: [
					{ filename: "notes/a.md", status: "added", sha: "sha1" },
					{ filename: "other/b.md", status: "added", sha: "sha2" },
				],
				headSha: "new-head",
			});

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const engine = new PullEngine({
				client,
				state,
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "notes",
			});

			const changes = await engine.getRemoteChanges("main");
			// Only notes/a.md should be included (mapped to a.md)
			expect(changes).toHaveLength(1);
			expect(changes[0].path).toBe("a.md");
		});

		it("handles renamed files in compare result", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 1,
				files: [
					{
						filename: "new-name.md",
						status: "renamed",
						sha: "sha1",
						previousFilename: "old-name.md",
					},
				],
				headSha: "new-head",
			});

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const engine = new PullEngine({
				client,
				state,
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			const changes = await engine.getRemoteChanges("main");
			expect(changes).toHaveLength(2);
			expect(changes.find((c) => c.path === "old-name.md")?.type).toBe("delete");
			expect(changes.find((c) => c.path === "new-name.md")?.type).toBe("create");
		});

		it("falls back to full tree when compare API throws", async () => {
			const client = createMockClient([{ path: "a.md", sha: "sha-a" }]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			vi.mocked(client.compareCommits).mockRejectedValue(new Error("404 Not Found"));

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const engine = new PullEngine({
				client,
				state,
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			const changes = await engine.getRemoteChanges("main");
			// Should fall back to full tree
			expect(client.getCommit).toHaveBeenCalled();
			expect(client.getTree).toHaveBeenCalled();
			expect(changes).toHaveLength(1);
		});

		it("pullIncremental downloads files per-file and processes deletes", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			const fileSha = "sha-new";
			vi.mocked(client.getFileContent).mockImplementation(() => {
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce(fileSha);
				return Promise.resolve({
					content: btoa("new content"),
					sha: fileSha,
					size: 11,
				});
			});
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 2,
				files: [
					{ filename: "new-file.md", status: "added", sha: fileSha },
					{ filename: "deleted.md", status: "removed", sha: "sha-del" },
				],
				headSha: "new-head",
			});

			const state = createMockState({ "deleted.md": { remoteSha: "sha-del" } });
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const vault = createMockVault();
			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");
			const pullResult = await engine.pull("main");

			expect(pullResult.created).toContain("new-file.md");
			expect(pullResult.deleted).toContain("deleted.md");
			expect(vault.writeFile).toHaveBeenCalled();
			expect(vault.deleteFile).toHaveBeenCalledWith("deleted.md");
			expect(state.setHeadOid).toHaveBeenCalledWith("new-head");
		});

		it("populates result.modified for modified file status in incremental pull", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			const fileSha = "sha-mod";
			vi.mocked(client.getFileContent).mockImplementation(() => {
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce(fileSha);
				return Promise.resolve({
					content: btoa("modified content"),
					sha: fileSha,
					size: 16,
				});
			});
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 1,
				files: [{ filename: "doc.md", status: "modified", sha: fileSha }],
				headSha: "new-head",
			});

			const state = createMockState({ "doc.md": { remoteSha: "sha-old" } });
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const vault = createMockVault();
			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");
			const pullResult = await engine.pull("main");

			expect(pullResult.modified).toContain("doc.md");
			expect(pullResult.created).not.toContain("doc.md");
			expect(vault.writeFile).toHaveBeenCalled();
		});

		it("filters unsafe paths from compare files in incremental pull", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			const safeSha = "sha-safe";
			vi.mocked(client.getFileContent).mockImplementation(() => {
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce(safeSha);
				return Promise.resolve({
					content: btoa("safe content"),
					sha: safeSha,
					size: 12,
				});
			});
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 2,
				files: [
					{ filename: "../etc/passwd", status: "added", sha: "sha-evil" },
					{ filename: "safe.md", status: "added", sha: safeSha },
				],
				headSha: "new-head",
			});

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const vault = createMockVault();
			const logger = createMockLogger();
			const engine = new PullEngine({
				client,
				state,
				vault,
				logger,
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");
			const pullResult = await engine.pull("main");

			expect(pullResult.created).toContain("safe.md");
			expect(pullResult.created).not.toContain("../etc/passwd");
			expect(pullResult.errors).toEqual(
				expect.arrayContaining([{ path: "../etc/passwd", error: "Unsafe path rejected" }]),
			);
			expect(logger.warn).toHaveBeenCalledWith("Skipping unsafe path from remote", {
				path: "../etc/passwd",
			});
		});

		it("reports rename error in pullIncremental and continues other changes", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			const fileSha = "sha-new";
			vi.mocked(client.getFileContent).mockImplementation(() => {
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce(fileSha);
				return Promise.resolve({
					content: btoa("new content"),
					sha: fileSha,
					size: 11,
				});
			});
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 2,
				files: [
					{ filename: "renamed.md", status: "renamed", sha: "sha-r", previousFilename: "old.md" },
					{ filename: "other.md", status: "added", sha: fileSha },
				],
				headSha: "new-head",
			});

			const state = createMockState({ "old.md": { remoteSha: "sha-old" } });
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");
			vi.mocked(state.getSHA).mockImplementation((path: string) => {
				if (path === "old.md") {
					return {
						remoteSha: "sha-old",
						localContentHash: "hash",
						lastSyncedAt: 1000,
						size: 10,
						isBinary: false,
					};
				}
				return undefined;
			});

			const vault = createMockVault();
			(vault.renameFile as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error("File not found: old.md"),
			);
			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");
			const pullResult = await engine.pull("main", undefined, [
				{ oldPath: "old.md", newPath: "renamed.md" },
			]);

			// Rename failed → error reported
			const renameError = pullResult.errors.find((e) => e.path === "old.md");
			expect(renameError).toBeDefined();
			expect(renameError?.error).toContain("File not found");
			// Other changes should still proceed
			expect(pullResult.created).toContain("other.md");
			expect(vault.writeFile).toHaveBeenCalled();
		});

		it("filters exclude patterns from compare files in incremental pull", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			const fileSha = "sha-ok";
			vi.mocked(client.getFileContent).mockImplementation(() => {
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce(fileSha);
				return Promise.resolve({
					content: btoa("ok"),
					sha: fileSha,
					size: 2,
				});
			});
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 2,
				files: [
					{ filename: "private/secret.md", status: "added", sha: "sha-secret" },
					{ filename: "public.md", status: "added", sha: fileSha },
				],
				headSha: "new-head",
			});

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const vault = createMockVault();
			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
				excludePatterns: ["private/**"],
			});

			await engine.getRemoteChanges("main");
			const pullResult = await engine.pull("main");

			expect(pullResult.created).toContain("public.md");
			expect(pullResult.created).not.toContain("private/secret.md");
			// Excluded file should not be downloaded
			expect(vault.writeFile).toHaveBeenCalledTimes(1);
		});

		it("reports delete error in pullIncremental and continues", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			const fileSha = "sha-new";
			vi.mocked(client.getFileContent).mockImplementation(() => {
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce(fileSha);
				return Promise.resolve({
					content: btoa("new"),
					sha: fileSha,
					size: 3,
				});
			});
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 2,
				files: [
					{ filename: "removed.md", status: "removed", sha: "sha-del" },
					{ filename: "added.md", status: "added", sha: fileSha },
				],
				headSha: "new-head",
			});

			const state = createMockState({ "removed.md": { remoteSha: "sha-del" } });
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const vault = createMockVault();
			(vault.deleteFile as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error("Permission denied"),
			);
			const engine = new PullEngine({
				client,
				state,
				vault,
				logger: createMockLogger(),
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");
			const pullResult = await engine.pull("main");

			// Delete failed → error reported
			const deleteError = pullResult.errors.find((e) => e.path === "removed.md");
			expect(deleteError).toBeDefined();
			expect(deleteError?.error).toContain("Permission denied");
			// Other changes still proceed
			expect(pullResult.created).toContain("added.md");
		});
	});
	describe("getRemoteFileContent", () => {
		it("fetches and decodes remote file content as text", async () => {
			const textContent = "Hello, world!";
			const client = createMockClient([]);
			vi.mocked(client.getFileContent).mockResolvedValue({
				content: btoa(textContent),
				sha: "sha-123",
				size: textContent.length,
			});

			const engine = new PullEngine({
				client,
				state: createMockState(),
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.getRemoteFileContent("main", "note.md");
			expect(result).toBe(textContent);
			expect(client.getFileContent).toHaveBeenCalledWith("note.md", "main");
		});

		it("applies syncFolder to repo path", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getFileContent).mockResolvedValue({
				content: btoa("content"),
				sha: "sha-456",
				size: 7,
			});

			const engine = new PullEngine({
				client,
				state: createMockState(),
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "docs",
			});

			await engine.getRemoteFileContent("main", "note.md");
			expect(client.getFileContent).toHaveBeenCalledWith("docs/note.md", "main");
		});

		it("handles multi-line base64 content", async () => {
			const text = "line 1\nline 2\nline 3";
			// Simulate GitHub's line-wrapped base64
			const base64 =
				btoa(text)
					.match(/.{1,76}/g)
					?.join("\n") ?? btoa(text);
			const client = createMockClient([]);
			vi.mocked(client.getFileContent).mockResolvedValue({
				content: base64,
				sha: "sha-789",
				size: text.length,
			});

			const engine = new PullEngine({
				client,
				state: createMockState(),
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.getRemoteFileContent("main", "file.md");
			expect(result).toBe(text);
		});
	});

	describe("getRemoteFileHash", () => {
		beforeEach(() => {
			vi.mocked(computeGitBlobSha).mockReset();
			vi.mocked(computeHashFromBuffer).mockReset();
		});

		it("returns content hash, remote SHA, size, and binary flag", async () => {
			const content = "hello world";
			const client = createMockClient([]);
			vi.mocked(client.getFileContent).mockResolvedValue({
				content: btoa(content),
				sha: "sha-remote",
				size: content.length,
			});
			vi.mocked(computeHashFromBuffer).mockResolvedValue("content-hash-123");

			const engine = new PullEngine({
				client,
				state: createMockState(),
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.getRemoteFileHash("main", "note.md");
			expect(result.remoteSha).toBe("sha-remote");
			expect(result.contentHash).toBe("content-hash-123");
			expect(result.size).toBe(content.length);
			expect(result.isBinary).toBe(false);
		});

		it("applies syncFolder to repo path", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getFileContent).mockResolvedValue({
				content: btoa("x"),
				sha: "sha",
				size: 1,
			});
			vi.mocked(computeHashFromBuffer).mockResolvedValue("h");

			const engine = new PullEngine({
				client,
				state: createMockState(),
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "docs",
			});

			await engine.getRemoteFileHash("main", "note.md");
			expect(client.getFileContent).toHaveBeenCalledWith("docs/note.md", "main");
		});

		it("detects binary content", async () => {
			const binaryContent = "hello\x00world";
			const client = createMockClient([]);
			vi.mocked(client.getFileContent).mockResolvedValue({
				content: btoa(binaryContent),
				sha: "sha-bin",
				size: binaryContent.length,
			});
			vi.mocked(computeHashFromBuffer).mockResolvedValue("bin-hash");

			const engine = new PullEngine({
				client,
				state: createMockState(),
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			const result = await engine.getRemoteFileHash("main", "file.bin");
			expect(result.isBinary).toBe(true);
		});
	});

	describe("ZIP SHA integrity — file excluded from result", () => {
		beforeEach(() => {
			vi.mocked(computeGitBlobSha).mockReset();
			vi.mocked(computeHashFromBuffer).mockReset();
			vi.mocked(computeHashFromBuffer).mockResolvedValue("content-hash");
			vi.mocked(processZipEntries).mockReset();
		});

		it("excludes file with wrong SHA from created/modified and logs error", async () => {
			const files = [
				{ path: "good-0.md", sha: "sha-0", size: 100 },
				{ path: "good-1.md", sha: "sha-1", size: 100 },
				{ path: "good-2.md", sha: "sha-2", size: 100 },
				{ path: "good-3.md", sha: "sha-3", size: 100 },
				{ path: "good-4.md", sha: "sha-4", size: 100 },
				{ path: "tampered.md", sha: "sha-tampered", size: 100 },
			];
			const client = createMockClient(files);
			const state = createMockState();
			const vault = createMockVault();
			const logger = createMockLogger();

			// Mock per-file fallback to also fail for tampered file
			vi.mocked(client.getFileContent).mockImplementation((path: string) => {
				if (path === "tampered.md") {
					return Promise.reject(new Error("Content unavailable"));
				}
				const entry = files.find((f) => f.path === path);
				const sha = entry?.sha ?? "unknown";
				vi.mocked(computeGitBlobSha).mockResolvedValueOnce(sha);
				return Promise.resolve({
					content: btoa(`content of ${path}`),
					sha,
					size: 100,
				});
			});

			vi.mocked(processZipEntries).mockImplementation(async (_buf, onEntry) => {
				for (const f of files) {
					if (f.path === "tampered.md") {
						// Return WRONG SHA for tampered file
						vi.mocked(computeGitBlobSha).mockResolvedValueOnce("wrong-sha-mismatch");
					} else {
						vi.mocked(computeGitBlobSha).mockResolvedValueOnce(f.sha);
					}
					await onEntry(f.path, new TextEncoder().encode(`content of ${f.path}`));
				}
				return files.length;
			});

			const engine = new PullEngine({
				client,
				state,
				vault,
				logger,
				syncFolder: "",
			});

			const result = await engine.pull("main");

			// tampered.md should appear in errors (SHA mismatch from ZIP + fallback network error)
			const tamperErrors = result.errors.filter((e) => e.path === "tampered.md");
			expect(tamperErrors.length).toBeGreaterThanOrEqual(1);
			// SHA integrity error should be logged
			expect(logger.error).toHaveBeenCalledWith("SHA integrity check failed (ZIP)", {
				path: "tampered.md",
				expected: "sha-tampered",
				actual: "wrong-sha-mismatch",
			});
			// Good files should still be created
			expect(result.created).toContain("good-0.md");
			expect(result.created).toContain("good-4.md");
			// tampered.md should NOT be in created (both ZIP and fallback failed)
			expect(result.created).not.toContain("tampered.md");
			// State should not have SHA entry for tampered file
			expect(state.setSHA).not.toHaveBeenCalledWith("tampered.md", expect.anything());
		});
	});

	describe("fetchTreeForRef via getRemoteChanges", () => {
		it("returns empty entries when getTree throws GitHubNotFoundError", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "ref-sha" });
			vi.mocked(client.getCommit).mockResolvedValue({ sha: "ref-sha", treeSha: "tree-sha" });
			vi.mocked(client.getTree).mockRejectedValue(new GitHubNotFoundError("tree-sha"));
			// Force the full tree path by making compareCommits diverge
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "diverged",
				aheadBy: 1,
				files: [],
				headSha: "ref-sha",
			});

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const logger = createMockLogger();
			const engine = new PullEngine({
				client,
				state,
				vault: createMockVault(),
				logger,
				syncFolder: "",
			});

			const changes = await engine.getRemoteChanges("main");

			expect(changes).toHaveLength(0);
			expect(logger.info).toHaveBeenCalledWith("Tree is empty (no files in repo)");
		});

		it("logs warning when tree is truncated via fetchTreeForRef", async () => {
			const client = createMockClient([{ path: "a.md", sha: "sha-a" }]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "ref-sha" });
			vi.mocked(client.getCommit).mockResolvedValue({ sha: "ref-sha", treeSha: "tree-sha" });
			vi.mocked(client.getTree).mockResolvedValue({
				entries: [{ path: "a.md", sha: "sha-a", mode: "100644", type: "blob", size: 100 }],
				truncated: true,
			});
			// Force full tree path
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "diverged",
				aheadBy: 1,
				files: [],
				headSha: "ref-sha",
			});

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const logger = createMockLogger();
			const engine = new PullEngine({
				client,
				state,
				vault: createMockVault(),
				logger,
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");

			expect(logger.warn).toHaveBeenCalledWith(
				"Tree response truncated — some files may be missed",
			);
		});
	});

	describe("pullIncremental edge cases", () => {
		beforeEach(() => {
			vi.mocked(computeGitBlobSha).mockReset();
			vi.mocked(computeHashFromBuffer).mockReset();
			vi.mocked(computeHashFromBuffer).mockResolvedValue("content-hash");
		});

		it("returns empty result when all changes are filtered by skipPaths", async () => {
			const client = createMockClient([]);
			vi.mocked(client.getRef).mockResolvedValue({ ref: "refs/heads/main", sha: "new-head" });
			vi.mocked(client.compareCommits).mockResolvedValue({
				status: "ahead",
				aheadBy: 1,
				files: [{ filename: "skipped.md", status: "modified", sha: "sha-s" }],
				headSha: "new-head",
			});

			const state = createMockState();
			vi.mocked(state.getHeadOid).mockReturnValue("old-head");

			const engine = new PullEngine({
				client,
				state,
				vault: createMockVault(),
				logger: createMockLogger(),
				syncFolder: "",
			});

			await engine.getRemoteChanges("main");
			const result = await engine.pull("main", new Set(["skipped.md"]));

			expect(result.created).toHaveLength(0);
			expect(result.modified).toHaveLength(0);
			expect(result.deleted).toHaveLength(0);
			expect(state.setHeadOid).toHaveBeenCalledWith("new-head");
		});
	});
});
