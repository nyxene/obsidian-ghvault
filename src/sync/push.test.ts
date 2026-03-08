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

describe("PushEngine", () => {
	it("skips push when no changes", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const engine = new PushEngine({ graphql, state, vault, logger: createMockLogger() });

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
		const engine = new PushEngine({ graphql, state, vault, logger: createMockLogger() });

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
		const engine = new PushEngine({ graphql, state, vault, logger: createMockLogger() });

		const changes: FileChange[] = [{ path: "doc.md", type: "modify" }];
		const result = await engine.push(changes, commitOptions);

		expect(result.pushed).toEqual(["doc.md"]);
		expect(vault.readFile).toHaveBeenCalledWith("doc.md");
	});

	it("pushes deletions", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState();
		const vault = createMockVault();
		const engine = new PushEngine({ graphql, state, vault, logger: createMockLogger() });

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
		const engine = new PushEngine({ graphql, state, vault, logger: createMockLogger() });

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
		const engine = new PushEngine({
			graphql: createMockGraphQL(),
			state,
			vault: createMockVault(),
			logger: createMockLogger(),
		});

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
		const engine = new PushEngine({
			graphql: createMockGraphQL(),
			state,
			vault: createMockVault(),
			logger: createMockLogger(),
		});

		await engine.push([{ path: "f.md", type: "create" }], commitOptions);

		expect(state.setHeadOid).toHaveBeenCalledWith("new-oid");
		expect(state.setLastSyncedAt).toHaveBeenCalledWith(expect.any(Number));
		expect(state.save).toHaveBeenCalled();
	});

	it("uses correct head OID as expectedHeadOid", async () => {
		const graphql = createMockGraphQL();
		const state = createMockState("specific-head-oid");
		const engine = new PushEngine({
			graphql,
			state,
			vault: createMockVault(),
			logger: createMockLogger(),
		});

		await engine.push([{ path: "f.md", type: "create" }], commitOptions);

		expect(graphql.createCommit).toHaveBeenCalledWith(
			expect.objectContaining({ expectedHeadOid: "specific-head-oid" }),
		);
	});

	it("encodes file content to base64", async () => {
		const graphql = createMockGraphQL();
		const vault = createMockVault();
		vi.mocked(vault.readFile).mockResolvedValue("hello world");
		const engine = new PushEngine({
			graphql,
			state: createMockState(),
			vault,
			logger: createMockLogger(),
		});

		await engine.push([{ path: "f.md", type: "create" }], commitOptions);

		const call = vi.mocked(graphql.createCommit).mock.calls[0][0];
		const decoded = atob(call.additions[0].base64Content);
		expect(decoded).toBe("hello world");
	});
});
