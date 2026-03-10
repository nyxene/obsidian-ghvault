import { describe, expect, it, vi } from "vitest";
import type { FileChange } from "../types";
import type { Logger } from "../utils/logger";
import type { LocalFileInfo } from "./comparator";
import type { SyncVault } from "./engine";
import { SyncEngine } from "./engine";
import type { PullEngine, PullResult } from "./pull";
import type { PushEngine, PushResult } from "./push";
import type { SyncStateManager } from "./state";

const emptyPull: PullResult = { created: [], modified: [], deleted: [], errors: [] };
const emptyPush: PushResult = { pushed: [], deleted: [], oid: "" };

function createMockPullEngine(
	result: PullResult = emptyPull,
	remoteChanges: import("../types").FileChange[] = [],
): PullEngine {
	return {
		pull: vi.fn().mockResolvedValue(result),
		getRemoteChanges: vi.fn().mockResolvedValue(remoteChanges),
		updateCacheFromCommit: vi.fn().mockResolvedValue(undefined),
	} as unknown as PullEngine;
}

function createMockPushEngine(result: PushResult = emptyPush): PushEngine {
	return { push: vi.fn().mockResolvedValue(result) } as unknown as PushEngine;
}

function createMockState(cache: Record<string, unknown> = {}): SyncStateManager {
	return {
		getAllSHAs: vi.fn().mockReturnValue(cache),
		getHeadOid: vi.fn().mockReturnValue("head"),
		load: vi.fn().mockResolvedValue(undefined),
	} as unknown as SyncStateManager;
}

function createMockVault(files: LocalFileInfo[] = []): SyncVault {
	return {
		readFile: vi.fn().mockResolvedValue("content"),
		writeFile: vi.fn().mockResolvedValue(undefined),
		deleteFile: vi.fn().mockResolvedValue(undefined),
		listFiles: vi.fn().mockResolvedValue(files),
	} as unknown as SyncVault;
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

const commitOptions = { branch: "main", owner: "testowner", repo: "testrepo" };

function createEngine(
	overrides: {
		pullEngine?: PullEngine;
		pushEngine?: PushEngine;
		state?: SyncStateManager;
		vault?: SyncVault;
	} = {},
) {
	const pullEngine = overrides.pullEngine ?? createMockPullEngine();
	const pushEngine = overrides.pushEngine ?? createMockPushEngine();
	const state = overrides.state ?? createMockState();
	const vault = overrides.vault ?? createMockVault();
	const engine = new SyncEngine({
		pullEngine,
		pushEngine,
		state,
		vault,
		logger: createMockLogger(),
		commitOptions,
	});
	return { engine, pullEngine, pushEngine, state, vault };
}

describe("SyncEngine", () => {
	it("runs pull then checks for local changes", async () => {
		const { engine, pullEngine, pushEngine } = createEngine();

		const result = await engine.sync();

		expect(pullEngine.pull).toHaveBeenCalledWith("main", expect.any(Set));
		expect(pushEngine.push).not.toHaveBeenCalled();
		expect(result.pull).toEqual(emptyPull);
		expect(result.push).toBeNull();
		expect(result.conflicts).toEqual([]);
	});

	it("pulls only when no local changes", async () => {
		const pullResult: PullResult = {
			created: ["remote.md"],
			modified: [],
			deleted: [],
			errors: [],
		};
		const { engine, pushEngine } = createEngine({
			pullEngine: createMockPullEngine(pullResult),
		});

		const result = await engine.sync();

		expect(result.pull.created).toEqual(["remote.md"]);
		expect(result.push).toBeNull();
		expect(pushEngine.push).not.toHaveBeenCalled();
	});

	it("pushes local changes after pull", async () => {
		const pushResult: PushResult = { pushed: ["local.md"], deleted: [], oid: "new-oid" };
		const vault = createMockVault([{ path: "local.md", contentHash: "new-hash", size: 10 }]);
		const state = createMockState({});
		const { engine, pushEngine } = createEngine({
			pushEngine: createMockPushEngine(pushResult),
			vault,
			state,
		});

		const result = await engine.sync();

		expect(pushEngine.push).toHaveBeenCalledWith(
			[{ path: "local.md", type: "create" }],
			expect.objectContaining({ branch: "main", message: expect.any(String) }),
		);
		expect(result.push?.pushed).toEqual(["local.md"]);
	});

	it("detects modified local files", async () => {
		const vault = createMockVault([{ path: "doc.md", contentHash: "changed", size: 10 }]);
		const state = createMockState({
			"doc.md": {
				remoteSha: "sha",
				localContentHash: "original",
				lastSyncedAt: 1000,
				size: 10,
				isBinary: false,
			},
		});
		const pushEngine = createMockPushEngine();
		const { engine } = createEngine({ pushEngine, vault, state });

		await engine.sync();

		expect(pushEngine.push).toHaveBeenCalledWith(
			[{ path: "doc.md", type: "modify" }],
			expect.any(Object),
		);
	});

	it("detects deleted local files", async () => {
		const vault = createMockVault([]);
		const state = createMockState({
			"gone.md": {
				remoteSha: "sha",
				localContentHash: "hash",
				lastSyncedAt: 1000,
				size: 10,
				isBinary: false,
			},
		});
		const pushEngine = createMockPushEngine();
		const { engine } = createEngine({ pushEngine, vault, state });

		await engine.sync();

		expect(pushEngine.push).toHaveBeenCalledWith(
			[{ path: "gone.md", type: "delete" }],
			expect.any(Object),
		);
	});

	it("rejects concurrent sync", async () => {
		const pullEngine = {
			pull: vi
				.fn()
				.mockImplementation(
					() => new Promise((resolve) => setTimeout(() => resolve(emptyPull), 50)),
				),
			getRemoteChanges: vi.fn().mockResolvedValue([]),
		} as unknown as PullEngine;
		const { engine } = createEngine({ pullEngine });

		const first = engine.sync();
		const second = engine.sync();

		await expect(second).rejects.toThrow("Sync already in progress");
		await first;
		expect(engine.isSyncing).toBe(false);
	});

	it("releases mutex after error in pull", async () => {
		const pullEngine = {
			pull: vi.fn().mockRejectedValue(new Error("network error")),
			getRemoteChanges: vi.fn().mockRejectedValue(new Error("network error")),
		} as unknown as PullEngine;
		const { engine } = createEngine({ pullEngine });

		await expect(engine.sync()).rejects.toThrow("network error");
		expect(engine.isSyncing).toBe(false);
	});

	it("releases mutex after error in push", async () => {
		const vault = createMockVault([{ path: "f.md", contentHash: "h", size: 1 }]);
		const state = createMockState({});
		const pullEngine = createMockPullEngine(emptyPull, []);
		const pushEngine = {
			push: vi.fn().mockRejectedValue(new Error("push failed")),
		} as unknown as PushEngine;
		const { engine } = createEngine({ pullEngine, pushEngine, vault, state });

		await expect(engine.sync()).rejects.toThrow("push failed");
		expect(engine.isSyncing).toBe(false);
	});

	it("loads state from disk before sync", async () => {
		const state = createMockState();
		const { engine } = createEngine({ state });

		await engine.sync();

		expect(state.load).toHaveBeenCalled();
	});

	describe("conflict detection", () => {
		it("skips conflicted files in both pull and push", async () => {
			const remoteChanges: FileChange[] = [{ path: "conflict.md", type: "modify" }];
			const pullResult: PullResult = { created: [], modified: [], deleted: [], errors: [] };
			const pullEngine = createMockPullEngine(pullResult, remoteChanges);

			const vault = createMockVault([
				{ path: "conflict.md", contentHash: "new-local-hash", size: 10 },
			]);
			const state = createMockState({
				"conflict.md": {
					remoteSha: "old-sha",
					localContentHash: "old-local-hash",
					lastSyncedAt: 1000,
					size: 10,
					isBinary: false,
				},
			});
			const pushEngine = createMockPushEngine();
			const { engine } = createEngine({ pullEngine, pushEngine, vault, state });

			const result = await engine.sync();

			// Conflict detected
			expect(result.conflicts).toHaveLength(1);
			expect(result.conflicts[0]).toEqual({
				path: "conflict.md",
				localChange: "modify",
				remoteChange: "modify",
			});

			// Pull should receive conflict paths as skipPaths
			expect(pullEngine.pull).toHaveBeenCalledWith("main", new Set(["conflict.md"]));

			// Push should not include conflicted file
			expect(pushEngine.push).not.toHaveBeenCalled();
		});

		it("allows non-conflicting files through while skipping conflicts", async () => {
			const remoteChanges: FileChange[] = [
				{ path: "conflict.md", type: "modify" },
				{ path: "remote-only.md", type: "create" },
			];
			const pullResult: PullResult = {
				created: ["remote-only.md"],
				modified: [],
				deleted: [],
				errors: [],
			};
			const pullEngine = createMockPullEngine(pullResult, remoteChanges);

			const vault = createMockVault([
				{ path: "conflict.md", contentHash: "new-local", size: 10 },
				{ path: "local-only.md", contentHash: "hash-local", size: 20 },
			]);
			const state = createMockState({
				"conflict.md": {
					remoteSha: "old-sha",
					localContentHash: "old-local",
					lastSyncedAt: 1000,
					size: 10,
					isBinary: false,
				},
			});
			const pushResult: PushResult = { pushed: ["local-only.md"], deleted: [], oid: "oid" };
			const pushEngine = createMockPushEngine(pushResult);
			const { engine } = createEngine({ pullEngine, pushEngine, vault, state });

			const result = await engine.sync();

			expect(result.conflicts).toHaveLength(1);
			expect(result.pull.created).toContain("remote-only.md");

			// Push should only include non-conflicting local changes
			expect(pushEngine.push).toHaveBeenCalledWith(
				[{ path: "local-only.md", type: "create" }],
				expect.any(Object),
			);
		});

		it("reports no conflicts when changes are on different files", async () => {
			const remoteChanges: FileChange[] = [{ path: "remote.md", type: "create" }];
			const pullEngine = createMockPullEngine(emptyPull, remoteChanges);

			const vault = createMockVault([{ path: "local.md", contentHash: "hash", size: 10 }]);
			const state = createMockState({});
			const pushEngine = createMockPushEngine();
			const { engine } = createEngine({ pullEngine, pushEngine, vault, state });

			const result = await engine.sync();

			expect(result.conflicts).toEqual([]);
		});
	});
});
