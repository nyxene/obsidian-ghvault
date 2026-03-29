import { describe, expect, it, vi } from "vitest";
import type { GitHubGraphQL } from "../github/graphql";
import type { FileChange } from "../types";
import type { Logger } from "../utils/logger";
import type { VaultReader } from "./push";
import { PushEngine } from "./push";
import type { SyncStateManager } from "./state";

vi.mock("../utils/hash", () => ({
	computeHash: vi
		.fn()
		.mockImplementation((content: string) => Promise.resolve(`hash-${content.length}`)),
	computeHashFromBuffer: vi.fn().mockImplementation((data: ArrayBuffer | Uint8Array) => {
		const len = data instanceof Uint8Array ? data.length : data.byteLength;
		return Promise.resolve(`hash-${len}`);
	}),
	computeGitBlobSha: vi.fn().mockImplementation(() => Promise.resolve("computed-blob-sha")),
}));

function createMockGraphQL(): GitHubGraphQL {
	return {
		createCommit: vi.fn().mockResolvedValue({ oid: "new-oid", url: "https://commit" }),
	} as unknown as GitHubGraphQL;
}

function createMockState(headOid = "current-head"): SyncStateManager {
	return {
		getHeadOid: vi.fn().mockReturnValue(headOid),
		setSHA: vi.fn(),
		deleteSHA: vi.fn(),
		setHeadOid: vi.fn(),
		setLastSyncedAt: vi.fn(),
		save: vi.fn().mockResolvedValue(undefined),
	} as unknown as SyncStateManager;
}

function createMockVault(): VaultReader {
	return {
		readFileBinary: vi.fn().mockImplementation((path: string) => {
			const bytes = new TextEncoder().encode(`content of ${path}`);
			return Promise.resolve(bytes.buffer as ArrayBuffer);
		}),
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

const commitOptions = {
	branch: "main",
	owner: "testowner",
	repo: "testrepo",
	message: "sync: update vault",
};

function createMockClient(): import("../github/client").GitHubClient {
	return {
		getCommit: vi.fn().mockResolvedValue({ sha: "head", treeSha: "tree-sha" }),
		createBlob: vi.fn().mockResolvedValue("blob-sha"),
		createTreeFromEntries: vi.fn().mockResolvedValue("new-tree-sha"),
		createCommitRest: vi.fn().mockResolvedValue("new-commit-sha"),
		updateRef: vi.fn().mockResolvedValue(undefined),
	} as unknown as import("../github/client").GitHubClient;
}

function createPushEngine(
	overrides: {
		graphql?: GitHubGraphQL;
		client?: import("../github/client").GitHubClient;
		state?: SyncStateManager;
		vault?: VaultReader;
		logger?: Logger;
		syncFolder?: string;
	} = {},
): PushEngine {
	return new PushEngine({
		graphql: overrides.graphql ?? createMockGraphQL(),
		client: overrides.client ?? createMockClient(),
		state: overrides.state ?? createMockState(),
		vault: overrides.vault ?? createMockVault(),
		logger: overrides.logger ?? createMockLogger(),
		syncFolder: overrides.syncFolder ?? "",
	});
}

describe("PushEngine", () => {
	it("skips push when no changes", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const engine = createPushEngine({ graphql, state, vault });

		const result = await engine.push([], commitOptions);

		expect(result.pushed).toEqual([]);
		expect(result.deleted).toEqual([]);
		expect(result.oid).toBe("");
		expect(graphql.createCommit).not.toHaveBeenCalled();
	});

	it("pushes new files", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const engine = createPushEngine({ graphql, state, vault });

		const changes: FileChange[] = [{ path: "new.md", type: "create" }];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toEqual(["new.md"]);
		expect(result.oid).toBe("new-oid");
		expect(vault.readFileBinary).toHaveBeenCalledWith("new.md");
		expect(graphql.createCommit).toHaveBeenCalledWith(
			expect.objectContaining({
				additions: [{ path: "new.md", base64Content: expect.any(String) }],
				deletions: [],
				expectedHeadOid: "current-head",
			}),
		);
	});

	it("pushes modified files", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const engine = createPushEngine({ graphql, state, vault });

		const changes: FileChange[] = [{ path: "doc.md", type: "modify" }];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toEqual(["doc.md"]);
		expect(vault.readFileBinary).toHaveBeenCalledWith("doc.md");
	});

	it("pushes deletions", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const engine = createPushEngine({ graphql, state, vault });

		const changes: FileChange[] = [{ path: "old.md", type: "delete" }];
		const result = await engine.push(changes, commitOptions);

		expect(result.deleted).toEqual(["old.md"]);
		expect(vault.readFileBinary).not.toHaveBeenCalled();
		expect(graphql.createCommit).toHaveBeenCalledWith(
			expect.objectContaining({
				additions: [],
				deletions: [{ path: "old.md" }],
			}),
		);
	});

	it("handles mixed changes", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const engine = createPushEngine({ graphql, state, vault });

		const changes: FileChange[] = [
			{ path: "new.md", type: "create" },
			{ path: "changed.md", type: "modify" },
			{ path: "gone.md", type: "delete" },
		];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toEqual(["new.md", "changed.md"]);
		expect(result.deleted).toEqual(["gone.md"]);
		expect(graphql.createCommit).toHaveBeenCalledWith(
			expect.objectContaining({
				additions: expect.arrayContaining([
					expect.objectContaining({ path: "new.md" }),
					expect.objectContaining({ path: "changed.md" }),
				]),
				deletions: [{ path: "gone.md" }],
			}),
		);
	});

	it("updates SHA cache after push", async () => {
		const state = createMockState();
		const engine = createPushEngine({ state });

		const changes: FileChange[] = [
			{ path: "added.md", type: "create" },
			{ path: "removed.md", type: "delete" },
		];
		await engine.push(changes, commitOptions);

		expect(state.setSHA).toHaveBeenCalledWith("added.md", expect.any(Object));
		expect(state.deleteSHA).toHaveBeenCalledWith("removed.md");
	});

	it("updates head OID and saves state", async () => {
		const state = createMockState();
		const engine = createPushEngine({ state });

		await engine.push([{ path: "f.md", type: "create" }], commitOptions);

		expect(state.setHeadOid).toHaveBeenCalledWith("new-oid");
		expect(state.setLastSyncedAt).toHaveBeenCalledWith(expect.any(Number));
		expect(state.save).toHaveBeenCalled();
	});

	it("uses correct head OID as expectedHeadOid", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState("specific-head-oid");
		const engine = createPushEngine({ graphql, state });

		await engine.push([{ path: "f.md", type: "create" }], commitOptions);

		expect(graphql.createCommit).toHaveBeenCalledWith(
			expect.objectContaining({ expectedHeadOid: "specific-head-oid" }),
		);
	});

	it("skips unsafe paths", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = createPushEngine({ graphql, state, vault, logger });

		const changes: FileChange[] = [
			{ path: "../etc/passwd", type: "create" },
			{ path: "good.md", type: "create" },
		];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toEqual(["good.md"]);
		expect(logger.warn).toHaveBeenCalledWith("Skipping unsafe path", {
			path: "../etc/passwd",
		});
		expect(graphql.createCommit).toHaveBeenCalledWith(
			expect.objectContaining({
				additions: [expect.objectContaining({ path: "good.md" })],
			}),
		);
	});

	it("skips oversized files (>50MB)", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const logger = createMockLogger();
		const bigBytes = new Uint8Array(51 * 1024 * 1024);
		vi.mocked(vault.readFileBinary).mockImplementation((path: string) => {
			if (path === "huge.bin") return Promise.resolve(bigBytes.buffer as ArrayBuffer);
			return Promise.resolve(new TextEncoder().encode(`content of ${path}`).buffer as ArrayBuffer);
		});
		const engine = createPushEngine({ graphql, state, vault, logger });

		const changes: FileChange[] = [
			{ path: "huge.bin", type: "create" },
			{ path: "small.md", type: "create" },
		];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toEqual(["small.md"]);
		expect(logger.warn).toHaveBeenCalledWith("Skipping oversized file", {
			path: "huge.bin",
			size: expect.any(Number),
		});
	});

	it("returns early when all changes are filtered", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = createPushEngine({ graphql, state, vault, logger });

		const changes: FileChange[] = [
			{ path: "../etc/passwd", type: "create" },
			{ path: "/absolute/path", type: "modify" },
		];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toEqual([]);
		expect(result.deleted).toEqual([]);
		expect(result.oid).toBe("");
		expect(graphql.createCommit).not.toHaveBeenCalled();
		expect(logger.info).toHaveBeenCalledWith("Push skipped — all changes filtered");
	});

	it("does not update state for filtered files", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const logger = createMockLogger();
		const bigBytes = new Uint8Array(51 * 1024 * 1024);
		vi.mocked(vault.readFileBinary).mockImplementation((path: string) => {
			if (path === "huge.bin") return Promise.resolve(bigBytes.buffer as ArrayBuffer);
			return Promise.resolve(new TextEncoder().encode(`content of ${path}`).buffer as ArrayBuffer);
		});
		const engine = createPushEngine({ graphql, state, vault, logger });

		const changes: FileChange[] = [
			{ path: "../etc/passwd", type: "create" },
			{ path: "huge.bin", type: "modify" },
			{ path: "good.md", type: "create" },
		];
		await engine.push(changes, commitOptions);

		expect(state.setSHA).toHaveBeenCalledTimes(1);
		expect(state.setSHA).toHaveBeenCalledWith("good.md", expect.any(Object));
		expect(state.setSHA).not.toHaveBeenCalledWith("../etc/passwd", expect.any(Object));
		expect(state.setSHA).not.toHaveBeenCalledWith("huge.bin", expect.any(Object));
	});

	it("pushes files >1.5MB via REST fallback instead of skipping", async () => {
		const graphql = createMockGraphQL();
		const client = createMockClient();
		const state = createMockState();
		const vault = createMockVault();
		const logger = createMockLogger();
		const largeBytes = new Uint8Array(1.6 * 1024 * 1024); // ~1.6MB of zeros
		vi.mocked(vault.readFileBinary).mockImplementation((path: string) => {
			if (path === "large.bin") return Promise.resolve(largeBytes.buffer as ArrayBuffer);
			return Promise.resolve(new TextEncoder().encode(`content of ${path}`).buffer as ArrayBuffer);
		});
		const engine = createPushEngine({ graphql, client, state, vault, logger });

		const changes: FileChange[] = [
			{ path: "large.bin", type: "create" },
			{ path: "small.md", type: "create" },
		];
		const result = await engine.push(changes, commitOptions);

		// Both files should be pushed — small via GraphQL, large via REST
		expect(result.pushed).toContain("small.md");
		expect(result.pushed).toContain("large.bin");
		// REST client methods should have been called for large file
		expect(client.createBlob).toHaveBeenCalled();
		expect(client.createTreeFromEntries).toHaveBeenCalled();
		expect(client.createCommitRest).toHaveBeenCalled();
		expect(client.updateRef).toHaveBeenCalled();
		// GraphQL should also have been called for small file
		expect(graphql.createCommit).toHaveBeenCalled();
	});

	it("pushes via REST only when all files >1.5MB (no GraphQL)", async () => {
		const graphql = createMockGraphQL();
		const client = createMockClient();
		const state = createMockState();
		const vault = createMockVault();
		const largeBytes = new Uint8Array(1.6 * 1024 * 1024);
		vi.mocked(vault.readFileBinary).mockResolvedValue(largeBytes.buffer as ArrayBuffer);
		const engine = createPushEngine({ graphql, client, state, vault });

		const changes: FileChange[] = [
			{ path: "big1.bin", type: "create" },
			{ path: "big2.bin", type: "create" },
		];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toContain("big1.bin");
		expect(result.pushed).toContain("big2.bin");
		// GraphQL should NOT have been called (no small files)
		expect(graphql.createCommit).not.toHaveBeenCalled();
		// REST should have been called
		expect(client.createBlob).toHaveBeenCalledTimes(2);
		expect(client.createTreeFromEntries).toHaveBeenCalled();
		expect(client.createCommitRest).toHaveBeenCalled();
		expect(client.updateRef).toHaveBeenCalled();
	});

	it("propagates updateRef failure in REST fallback path", async () => {
		const graphql = createMockGraphQL();
		const client = createMockClient();
		const state = createMockState();
		const vault = createMockVault();
		const largeBytes = new Uint8Array(1.6 * 1024 * 1024);
		vi.mocked(vault.readFileBinary).mockResolvedValue(largeBytes.buffer as ArrayBuffer);
		(client.updateRef as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("Reference update failed: not a fast-forward"),
		);
		const engine = createPushEngine({ graphql, client, state, vault });

		const changes: FileChange[] = [{ path: "big.bin", type: "create" }];

		await expect(engine.push(changes, commitOptions)).rejects.toThrow(
			"Reference update failed: not a fast-forward",
		);
		// State should NOT have been saved (push didn't complete)
		expect(state.save).not.toHaveBeenCalled();
		// createBlob, createTreeFromEntries, createCommitRest should have been called
		expect(client.createBlob).toHaveBeenCalled();
		expect(client.createTreeFromEntries).toHaveBeenCalled();
		expect(client.createCommitRest).toHaveBeenCalled();
	});

	it("handles createBlob failure mid-batch without corrupting state", async () => {
		const graphql = createMockGraphQL();
		const client = createMockClient();
		const state = createMockState();
		const vault = createMockVault();
		const largeBytes = new Uint8Array(1.6 * 1024 * 1024);
		vi.mocked(vault.readFileBinary).mockResolvedValue(largeBytes.buffer as ArrayBuffer);
		// First blob succeeds, second fails
		(client.createBlob as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce("blob-sha-1")
			.mockRejectedValueOnce(new Error("API rate limit exceeded"));
		const engine = createPushEngine({ graphql, client, state, vault });

		const changes: FileChange[] = [
			{ path: "ok.bin", type: "create" },
			{ path: "fail.bin", type: "create" },
		];

		await expect(engine.push(changes, commitOptions)).rejects.toThrow("API rate limit exceeded");
		// State should NOT have been saved (push didn't complete)
		expect(state.save).not.toHaveBeenCalled();
		// No partial state updates: setSHA and setHeadOid should not be called
		expect(state.setSHA).not.toHaveBeenCalled();
		expect(state.setHeadOid).not.toHaveBeenCalled();
		expect(state.setLastSyncedAt).not.toHaveBeenCalled();
	});

	it("stores correct remoteSha (git blob SHA) in cache after push", async () => {
		const state = createMockState();
		const vault = createMockVault();
		const engine = createPushEngine({ state, vault });

		const changes: FileChange[] = [{ path: "file.md", type: "create" }];
		await engine.push(changes, commitOptions);

		expect(state.setSHA).toHaveBeenCalledWith(
			"file.md",
			expect.objectContaining({
				remoteSha: "computed-blob-sha",
				localContentHash: expect.any(String),
			}),
		);
		// remoteSha should NOT be empty
		const call = vi.mocked(state.setSHA).mock.calls[0];
		expect(call[1].remoteSha).not.toBe("");
	});

	it("skips oversized file via sizeHint pre-check without reading content", async () => {
		const state = createMockState();
		const vault = createMockVault();
		const logger = createMockLogger();
		const engine = createPushEngine({ state, vault, logger });

		const oversized = 51 * 1024 * 1024;
		const changes: FileChange[] = [
			{ path: "huge.bin", type: "create", sizeHint: oversized },
			{ path: "small.md", type: "create" },
		];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toEqual(["small.md"]);
		expect(vault.readFileBinary).not.toHaveBeenCalledWith("huge.bin");
		expect(logger.warn).toHaveBeenCalledWith("Skipping oversized file (pre-check)", {
			path: "huge.bin",
			size: oversized,
		});
	});

	it("routes file to REST fallback when sizeHint is under 50MB but content exceeds 1.5MB", async () => {
		const graphql = createMockGraphQL();
		const client = createMockClient();
		const state = createMockState();
		const vault = createMockVault();
		const logger = createMockLogger();
		const largeBytes = new Uint8Array(2 * 1024 * 1024); // 2MB content
		vi.mocked(vault.readFileBinary).mockImplementation((path: string) => {
			if (path === "big-note.md") return Promise.resolve(largeBytes.buffer as ArrayBuffer);
			return Promise.resolve(new TextEncoder().encode(`content of ${path}`).buffer as ArrayBuffer);
		});
		const engine = createPushEngine({ graphql, client, state, vault, logger });

		// sizeHint is 2MB — below 50MB cutoff, so file is NOT pre-skipped
		const changes: FileChange[] = [
			{ path: "big-note.md", type: "create", sizeHint: 2 * 1024 * 1024 },
			{ path: "small.md", type: "create" },
		];
		const result = await engine.push(changes, commitOptions);

		// Both files should be pushed
		expect(result.pushed).toContain("big-note.md");
		expect(result.pushed).toContain("small.md");
		// big-note.md should go through REST (>1.5MB), small.md through GraphQL
		expect(client.createBlob).toHaveBeenCalled();
		expect(graphql.createCommit).toHaveBeenCalled();
		// sizeHint pre-check warning should NOT have been logged
		expect(logger.warn).not.toHaveBeenCalledWith(
			"Skipping oversized file (pre-check)",
			expect.anything(),
		);
	});

	it("does not skip files just under 1.5MB GraphQL limit", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const logger = createMockLogger();
		const justUnderBytes = new Uint8Array(1.4 * 1024 * 1024); // ~1.4MB
		// Fill with non-zero to avoid binary detection
		justUnderBytes.fill(0x78); // 'x'
		vi.mocked(vault.readFileBinary).mockImplementation((path: string) => {
			if (path === "medium.bin") return Promise.resolve(justUnderBytes.buffer as ArrayBuffer);
			return Promise.resolve(new TextEncoder().encode(`content of ${path}`).buffer as ArrayBuffer);
		});
		const engine = createPushEngine({ graphql, state, vault, logger });

		const changes: FileChange[] = [{ path: "medium.bin", type: "create" }];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toEqual(["medium.bin"]);
	});

	it("encodes file content to base64", async () => {
		const graphql = createMockGraphQL();
		const vault = createMockVault();
		const helloBytes = new TextEncoder().encode("hello world");
		vi.mocked(vault.readFileBinary).mockResolvedValue(helloBytes.buffer as ArrayBuffer);
		const engine = createPushEngine({ graphql, vault });

		await engine.push([{ path: "f.md", type: "create" }], commitOptions);

		const call = vi.mocked(graphql.createCommit).mock.calls[0][0];
		const decoded = atob(call.additions[0].base64Content);
		expect(decoded).toBe("hello world");
	});

	describe("binary file handling", () => {
		it("uses arrayBufferToBase64 for binary files with null bytes", async () => {
			const graphql = createMockGraphQL();
			const state = createMockState();
			const vault = createMockVault();
			// Binary content with null bytes (PNG-like header)
			const binaryBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
			vi.mocked(vault.readFileBinary).mockImplementation((path: string) => {
				if (path === "image.png") return Promise.resolve(binaryBytes.buffer as ArrayBuffer);
				return Promise.resolve(
					new TextEncoder().encode(`content of ${path}`).buffer as ArrayBuffer,
				);
			});
			const engine = createPushEngine({ graphql, state, vault });

			const changes: FileChange[] = [{ path: "image.png", type: "create" }];
			const result = await engine.push(changes, commitOptions);

			expect(result.pushed).toEqual(["image.png"]);
			// Verify the base64 content decodes to the original binary bytes
			const call = vi.mocked(graphql.createCommit).mock.calls[0][0];
			const decoded = atob(call.additions[0].base64Content);
			const decodedBytes = new Uint8Array([...decoded].map((c) => c.charCodeAt(0)));
			expect(decodedBytes).toEqual(binaryBytes);
		});

		it("stores isBinary: true in cache for binary files", async () => {
			const state = createMockState();
			const vault = createMockVault();
			const binaryBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
			vi.mocked(vault.readFileBinary).mockResolvedValue(binaryBytes.buffer as ArrayBuffer);
			const engine = createPushEngine({ state, vault });

			await engine.push([{ path: "photo.png", type: "create" }], commitOptions);

			expect(state.setSHA).toHaveBeenCalledWith(
				"photo.png",
				expect.objectContaining({ isBinary: true }),
			);
		});

		it("stores isBinary: false in cache for text files", async () => {
			const state = createMockState();
			const vault = createMockVault();
			// Text content without null bytes
			vi.mocked(vault.readFileBinary).mockResolvedValue(
				new TextEncoder().encode("hello world").buffer as ArrayBuffer,
			);
			const engine = createPushEngine({ state, vault });

			await engine.push([{ path: "note.md", type: "create" }], commitOptions);

			expect(state.setSHA).toHaveBeenCalledWith(
				"note.md",
				expect.objectContaining({ isBinary: false }),
			);
		});
	});

	describe("syncFolder support", () => {
		it("maps vault paths to repo paths in commit additions", async () => {
			const graphql = createMockGraphQL();
			const vault = createMockVault();
			const engine = createPushEngine({ graphql, vault, syncFolder: "docs" });

			const changes: FileChange[] = [{ path: "notes/hello.md", type: "create" }];
			const result = await engine.push(changes, commitOptions);

			expect(result.pushed).toEqual(["notes/hello.md"]);
			expect(graphql.createCommit).toHaveBeenCalledWith(
				expect.objectContaining({
					additions: [expect.objectContaining({ path: "docs/notes/hello.md" })],
				}),
			);
		});

		it("maps vault paths to repo paths in commit deletions", async () => {
			const graphql = createMockGraphQL();
			const engine = createPushEngine({ graphql, syncFolder: "docs" });

			const changes: FileChange[] = [{ path: "old.md", type: "delete" }];
			const result = await engine.push(changes, commitOptions);

			expect(result.deleted).toEqual(["old.md"]);
			expect(graphql.createCommit).toHaveBeenCalledWith(
				expect.objectContaining({
					deletions: [{ path: "docs/old.md" }],
				}),
			);
		});

		it("stores cache entries with vault paths (not repo paths)", async () => {
			const state = createMockState();
			const engine = createPushEngine({ state, syncFolder: "docs" });

			const changes: FileChange[] = [{ path: "note.md", type: "create" }];
			await engine.push(changes, commitOptions);

			// Cache key should be vault path, not repo path
			expect(state.setSHA).toHaveBeenCalledWith("note.md", expect.any(Object));
			expect(state.setSHA).not.toHaveBeenCalledWith("docs/note.md", expect.any(Object));
		});

		it("empty syncFolder preserves paths as-is (backward compatible)", async () => {
			const graphql = createMockGraphQL();
			const engine = createPushEngine({ graphql, syncFolder: "" });

			const changes: FileChange[] = [{ path: "notes/hello.md", type: "create" }];
			await engine.push(changes, commitOptions);

			expect(graphql.createCommit).toHaveBeenCalledWith(
				expect.objectContaining({
					additions: [expect.objectContaining({ path: "notes/hello.md" })],
				}),
			);
		});
	});
});
