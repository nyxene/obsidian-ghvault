import { describe, expect, it, vi } from "vitest";
import type { GitHubGraphQL } from "../github/graphql";
import type { FileChange } from "../types";
import type { Logger } from "../utils/logger";
import type { VaultReader } from "./push";
import { PushEngine } from "./push";
import type { SyncStateManager } from "./state";

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
		readFile: vi.fn().mockImplementation((path: string) => Promise.resolve(`content of ${path}`)),
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

function createPushEngine(
	overrides: {
		graphql?: GitHubGraphQL;
		state?: SyncStateManager;
		vault?: VaultReader;
		logger?: Logger;
		syncFolder?: string;
	} = {},
): PushEngine {
	return new PushEngine({
		graphql: overrides.graphql ?? createMockGraphQL(),
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
		expect(vault.readFile).toHaveBeenCalledWith("new.md");
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
		expect(vault.readFile).toHaveBeenCalledWith("doc.md");
	});

	it("pushes deletions", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const engine = createPushEngine({ graphql, state, vault });

		const changes: FileChange[] = [{ path: "old.md", type: "delete" }];
		const result = await engine.push(changes, commitOptions);

		expect(result.deleted).toEqual(["old.md"]);
		expect(vault.readFile).not.toHaveBeenCalled();
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
		const bigContent = "x".repeat(51 * 1024 * 1024);
		vi.mocked(vault.readFile).mockImplementation((path: string) => {
			if (path === "huge.bin") return Promise.resolve(bigContent);
			return Promise.resolve(`content of ${path}`);
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
		const bigContent = "x".repeat(51 * 1024 * 1024);
		vi.mocked(vault.readFile).mockImplementation((path: string) => {
			if (path === "huge.bin") return Promise.resolve(bigContent);
			return Promise.resolve(`content of ${path}`);
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

	it("skips files exceeding GraphQL 1.5MB limit", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const logger = createMockLogger();
		const largeContent = "x".repeat(1.6 * 1024 * 1024); // ~1.6MB
		vi.mocked(vault.readFile).mockImplementation((path: string) => {
			if (path === "large.bin") return Promise.resolve(largeContent);
			return Promise.resolve(`content of ${path}`);
		});
		const engine = createPushEngine({ graphql, state, vault, logger });

		const changes: FileChange[] = [
			{ path: "large.bin", type: "create" },
			{ path: "small.md", type: "create" },
		];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toEqual(["small.md"]);
		expect(logger.warn).toHaveBeenCalledWith(
			"Skipping large file — exceeds GraphQL payload limit",
			expect.objectContaining({
				path: "large.bin",
				size: expect.any(Number),
				maxSize: expect.any(Number),
			}),
		);
	});

	it("does not skip files just under 1.5MB GraphQL limit", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const logger = createMockLogger();
		const justUnderContent = "x".repeat(1.4 * 1024 * 1024); // ~1.4MB
		vi.mocked(vault.readFile).mockImplementation((path: string) => {
			if (path === "medium.bin") return Promise.resolve(justUnderContent);
			return Promise.resolve(`content of ${path}`);
		});
		const engine = createPushEngine({ graphql, state, vault, logger });

		const changes: FileChange[] = [{ path: "medium.bin", type: "create" }];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toEqual(["medium.bin"]);
	});

	it("encodes file content to base64", async () => {
		const graphql = createMockGraphQL();
		const vault = createMockVault();
		vi.mocked(vault.readFile).mockResolvedValue("hello world");
		const engine = createPushEngine({ graphql, vault });

		await engine.push([{ path: "f.md", type: "create" }], commitOptions);

		const call = vi.mocked(graphql.createCommit).mock.calls[0][0];
		const decoded = atob(call.additions[0].base64Content);
		expect(decoded).toBe("hello world");
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
