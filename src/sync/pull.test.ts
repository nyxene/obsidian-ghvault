import { describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../github/client";
import { GitHubEmptyRepoError } from "../types";
import type { Logger } from "../utils/logger";
import type { VaultAdapter } from "./pull";
import { PullEngine } from "./pull";
import type { SyncStateManager } from "./state";

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
			return Promise.resolve({
				content: btoa(`content of ${path}`),
				sha: entry?.sha ?? "unknown-sha",
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
	overrides: { client?: GitHubClient; state?: SyncStateManager; vault?: VaultAdapter } = {},
): { engine: PullEngine; client: GitHubClient; state: SyncStateManager; vault: VaultAdapter } {
	const client = overrides.client ?? createMockClient();
	const state = overrides.state ?? createMockState();
	const vault = overrides.vault ?? createMockVault();
	const engine = new PullEngine({ client, state, vault, logger: createMockLogger() });
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

	it("initializes empty repo with .ghvault file", async () => {
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
});
