import { bench, describe } from "vitest";
import type { GitHubTreeEntry, SHACacheEntry } from "../types";
import type { LocalFileInfo } from "./comparator";
import { computeLocalChanges, computeRemoteChanges } from "./comparator";

function makeCacheEntry(remoteSha: string, localHash: string): SHACacheEntry {
	return {
		remoteSha,
		localContentHash: localHash,
		lastSyncedAt: 1000,
		size: 100,
		isBinary: false,
	};
}

function generateLocalFiles(count: number): LocalFileInfo[] {
	return Array.from({ length: count }, (_, i) => ({
		path: `folder/subfolder/file-${i}.md`,
		contentHash: `hash-${i}`,
		size: 100 + i,
	}));
}

function generateCache(count: number): Record<string, SHACacheEntry> {
	const cache: Record<string, SHACacheEntry> = {};
	for (let i = 0; i < count; i++) {
		cache[`folder/subfolder/file-${i}.md`] = makeCacheEntry(`sha-${i}`, `hash-${i}`);
	}
	return cache;
}

function generateTreeEntries(count: number): GitHubTreeEntry[] {
	return Array.from({ length: count }, (_, i) => ({
		path: `folder/subfolder/file-${i}.md`,
		sha: `sha-${i}`,
		mode: "100644",
		type: "blob" as const,
	}));
}

describe("computeLocalChanges", () => {
	bench("100 files, no changes", () => {
		const files = generateLocalFiles(100);
		const cache = generateCache(100);
		computeLocalChanges(files, cache);
	});

	bench("1000 files, no changes", () => {
		const files = generateLocalFiles(1000);
		const cache = generateCache(1000);
		computeLocalChanges(files, cache);
	});

	bench("5000 files, no changes", () => {
		const files = generateLocalFiles(5000);
		const cache = generateCache(5000);
		computeLocalChanges(files, cache);
	});

	bench("1000 files, 100 new + 50 modified + 50 deleted", () => {
		const files = generateLocalFiles(1000);
		const cache = generateCache(900);
		// Files 900-999 are new (not in cache)
		// Modify first 50 by changing cache hash
		for (let i = 0; i < 50; i++) {
			cache[`folder/subfolder/file-${i}.md`] = makeCacheEntry(`sha-${i}`, `old-hash-${i}`);
		}
		// Add 50 extra cache entries for deleted files
		for (let i = 1000; i < 1050; i++) {
			cache[`folder/subfolder/file-${i}.md`] = makeCacheEntry(`sha-${i}`, `hash-${i}`);
		}
		computeLocalChanges(files, cache);
	});
});

describe("computeRemoteChanges", () => {
	bench("100 entries, no changes", () => {
		const tree = generateTreeEntries(100);
		const cache = generateCache(100);
		computeRemoteChanges(tree, cache);
	});

	bench("1000 entries, no changes", () => {
		const tree = generateTreeEntries(1000);
		const cache = generateCache(1000);
		computeRemoteChanges(tree, cache);
	});

	bench("5000 entries, no changes", () => {
		const tree = generateTreeEntries(5000);
		const cache = generateCache(5000);
		computeRemoteChanges(tree, cache);
	});
});
