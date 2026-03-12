import { bench, describe } from "vitest";
import type { SHACacheEntry } from "../types";
import { SyncStateManager } from "./state";

function makeEntry(i: number): SHACacheEntry {
	return {
		remoteSha: `sha-${i}`,
		localContentHash: `hash-${i}`,
		lastSyncedAt: 1000 + i,
		size: 100 + i,
		isBinary: false,
	};
}

function createStorageWithCache(count: number) {
	const cache: Record<string, SHACacheEntry> = {};
	for (let i = 0; i < count; i++) {
		cache[`folder/subfolder/file-${i}.md`] = makeEntry(i);
	}
	const data = {
		syncState: {
			lastRemoteHeadSha: "a".repeat(40),
			lastSyncedAt: Date.now(),
			cache,
		},
	};
	return {
		loadData: async () => structuredClone(data),
		saveData: async (_d: Record<string, unknown>) => {},
	};
}

describe("SyncStateManager.load", () => {
	bench("load 100 cache entries", async () => {
		const mgr = new SyncStateManager(createStorageWithCache(100));
		await mgr.load();
	});

	bench("load 1000 cache entries", async () => {
		const mgr = new SyncStateManager(createStorageWithCache(1000));
		await mgr.load();
	});

	bench("load 5000 cache entries", async () => {
		const mgr = new SyncStateManager(createStorageWithCache(5000));
		await mgr.load();
	});
});

describe("SyncStateManager.getAllSHAs", () => {
	bench("copy 1000 entries", async () => {
		const mgr = new SyncStateManager(createStorageWithCache(1000));
		await mgr.load();
		for (let i = 0; i < 100; i++) {
			mgr.getAllSHAs();
		}
	});
});
