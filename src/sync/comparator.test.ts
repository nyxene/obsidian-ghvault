import { describe, expect, it, vi } from "vitest";
import type { FileChange, GitHubTreeEntry, SHACacheEntry } from "../types";
import type { LocalFileInfo } from "./comparator";
import {
	computeLocalChanges,
	computeRemoteChanges,
	detectConflicts,
	reconcileFirstSync,
} from "./comparator";

function cacheEntry(overrides: Partial<SHACacheEntry> = {}): SHACacheEntry {
	return {
		remoteSha: "remote-sha",
		localContentHash: "local-hash",
		lastSyncedAt: 1000,
		size: 100,
		isBinary: false,
		...overrides,
	};
}

function treeEntry(path: string, sha: string): GitHubTreeEntry {
	return { path, sha, mode: "100644", type: "blob" };
}

describe("computeLocalChanges", () => {
	it("returns empty array when nothing changed", () => {
		const localFiles: LocalFileInfo[] = [{ path: "a.md", contentHash: "hash-a", size: 10 }];
		const cache = { "a.md": cacheEntry({ localContentHash: "hash-a" }) };

		expect(computeLocalChanges(localFiles, cache)).toEqual([]);
	});

	it("detects new local file", () => {
		const localFiles: LocalFileInfo[] = [{ path: "new.md", contentHash: "hash-new", size: 10 }];

		const changes = computeLocalChanges(localFiles, {});

		expect(changes).toEqual([expect.objectContaining({ path: "new.md", type: "create" })]);
	});

	it("detects modified local file", () => {
		const localFiles: LocalFileInfo[] = [{ path: "a.md", contentHash: "new-hash", size: 10 }];
		const cache = { "a.md": cacheEntry({ localContentHash: "old-hash" }) };

		const changes = computeLocalChanges(localFiles, cache);

		expect(changes).toEqual([expect.objectContaining({ path: "a.md", type: "modify" })]);
	});

	it("detects deleted local file", () => {
		const localFiles: LocalFileInfo[] = [];
		const cache = { "gone.md": cacheEntry() };

		const changes = computeLocalChanges(localFiles, cache);

		expect(changes).toEqual([{ path: "gone.md", type: "delete" }]);
	});

	it("skips excluded files in local list", () => {
		const localFiles: LocalFileInfo[] = [
			{ path: ".obsidian/config.json", contentHash: "hash", size: 10 },
			{ path: "real.md", contentHash: "hash-real", size: 10 },
		];

		const changes = computeLocalChanges(localFiles, {});

		expect(changes).toEqual([expect.objectContaining({ path: "real.md", type: "create" })]);
	});

	it("skips excluded files in cache when detecting deletes", () => {
		const localFiles: LocalFileInfo[] = [];
		const cache = {
			"ghvault.log": cacheEntry(),
			"real.md": cacheEntry(),
		};

		const changes = computeLocalChanges(localFiles, cache);

		expect(changes).toEqual([{ path: "real.md", type: "delete" }]);
	});

	it("handles mixed changes", () => {
		const localFiles: LocalFileInfo[] = [
			{ path: "existing.md", contentHash: "changed", size: 10 },
			{ path: "new.md", contentHash: "new-hash", size: 20 },
		];
		const cache = {
			"existing.md": cacheEntry({ localContentHash: "original" }),
			"deleted.md": cacheEntry(),
		};

		const changes = computeLocalChanges(localFiles, cache);

		expect(changes).toHaveLength(3);
		expect(changes).toContainEqual(
			expect.objectContaining({ path: "existing.md", type: "modify" }),
		);
		expect(changes).toContainEqual(expect.objectContaining({ path: "new.md", type: "create" }));
		expect(changes).toContainEqual(expect.objectContaining({ path: "deleted.md", type: "delete" }));
	});
});

describe("computeRemoteChanges", () => {
	it("returns empty array when nothing changed", () => {
		const tree: GitHubTreeEntry[] = [treeEntry("a.md", "sha-a")];
		const cache = { "a.md": cacheEntry({ remoteSha: "sha-a" }) };

		expect(computeRemoteChanges(tree, cache)).toEqual([]);
	});

	it("detects new remote file", () => {
		const tree: GitHubTreeEntry[] = [treeEntry("new.md", "sha-new")];

		const changes = computeRemoteChanges(tree, {});

		expect(changes).toEqual([{ path: "new.md", type: "create" }]);
	});

	it("detects modified remote file", () => {
		const tree: GitHubTreeEntry[] = [treeEntry("a.md", "new-sha")];
		const cache = { "a.md": cacheEntry({ remoteSha: "old-sha" }) };

		const changes = computeRemoteChanges(tree, cache);

		expect(changes).toEqual([{ path: "a.md", type: "modify" }]);
	});

	it("detects deleted remote file", () => {
		const tree: GitHubTreeEntry[] = [];
		const cache = { "gone.md": cacheEntry() };

		const changes = computeRemoteChanges(tree, cache);

		expect(changes).toEqual([{ path: "gone.md", type: "delete" }]);
	});

	it("skips tree entries (directories)", () => {
		const tree: GitHubTreeEntry[] = [
			{ path: "folder", sha: "tree-sha", mode: "040000", type: "tree" },
			treeEntry("file.md", "sha"),
		];

		const changes = computeRemoteChanges(tree, {});

		expect(changes).toEqual([{ path: "file.md", type: "create" }]);
	});

	it("skips excluded files in remote tree", () => {
		const tree: GitHubTreeEntry[] = [
			treeEntry(".obsidian/plugins.json", "sha"),
			treeEntry("real.md", "sha-real"),
		];

		const changes = computeRemoteChanges(tree, {});

		expect(changes).toEqual([{ path: "real.md", type: "create" }]);
	});

	it("skips excluded files in cache when detecting deletes", () => {
		const tree: GitHubTreeEntry[] = [];
		const cache = {
			".trash/old.md": cacheEntry(),
			"real.md": cacheEntry(),
		};

		const changes = computeRemoteChanges(tree, cache);

		expect(changes).toEqual([{ path: "real.md", type: "delete" }]);
	});

	it("handles mixed changes", () => {
		const tree: GitHubTreeEntry[] = [
			treeEntry("existing.md", "new-sha"),
			treeEntry("added.md", "sha-added"),
		];
		const cache = {
			"existing.md": cacheEntry({ remoteSha: "old-sha" }),
			"removed.md": cacheEntry(),
		};

		const changes = computeRemoteChanges(tree, cache);

		expect(changes).toHaveLength(3);
		expect(changes).toContainEqual({ path: "existing.md", type: "modify" });
		expect(changes).toContainEqual({ path: "added.md", type: "create" });
		expect(changes).toContainEqual({ path: "removed.md", type: "delete" });
	});
});

describe("detectConflicts", () => {
	it("returns empty when no overlapping paths", () => {
		const local: FileChange[] = [{ path: "local.md", type: "create" }];
		const remote: FileChange[] = [{ path: "remote.md", type: "create" }];

		expect(detectConflicts(local, remote)).toEqual([]);
	});

	it("detects conflict when same file modified both locally and remotely", () => {
		const local: FileChange[] = [{ path: "doc.md", type: "modify" }];
		const remote: FileChange[] = [{ path: "doc.md", type: "modify" }];

		const conflicts = detectConflicts(local, remote);

		expect(conflicts).toEqual([{ path: "doc.md", localChange: "modify", remoteChange: "modify" }]);
	});

	it("detects conflict when file created locally and remotely", () => {
		const local: FileChange[] = [{ path: "new.md", type: "create" }];
		const remote: FileChange[] = [{ path: "new.md", type: "create" }];

		const conflicts = detectConflicts(local, remote);

		expect(conflicts).toEqual([{ path: "new.md", localChange: "create", remoteChange: "create" }]);
	});

	it("detects conflict when file modified locally and deleted remotely", () => {
		const local: FileChange[] = [{ path: "doc.md", type: "modify" }];
		const remote: FileChange[] = [{ path: "doc.md", type: "delete" }];

		const conflicts = detectConflicts(local, remote);

		expect(conflicts).toEqual([{ path: "doc.md", localChange: "modify", remoteChange: "delete" }]);
	});

	it("detects conflict when file deleted locally and modified remotely", () => {
		const local: FileChange[] = [{ path: "doc.md", type: "delete" }];
		const remote: FileChange[] = [{ path: "doc.md", type: "modify" }];

		const conflicts = detectConflicts(local, remote);

		expect(conflicts).toEqual([{ path: "doc.md", localChange: "delete", remoteChange: "modify" }]);
	});

	it("detects multiple conflicts in mixed change sets", () => {
		const local: FileChange[] = [
			{ path: "a.md", type: "modify" },
			{ path: "b.md", type: "create" },
			{ path: "c.md", type: "delete" },
			{ path: "local-only.md", type: "create" },
		];
		const remote: FileChange[] = [
			{ path: "a.md", type: "modify" },
			{ path: "b.md", type: "create" },
			{ path: "remote-only.md", type: "create" },
		];

		const conflicts = detectConflicts(local, remote);

		expect(conflicts).toHaveLength(2);
		expect(conflicts).toContainEqual({
			path: "a.md",
			localChange: "modify",
			remoteChange: "modify",
		});
		expect(conflicts).toContainEqual({
			path: "b.md",
			localChange: "create",
			remoteChange: "create",
		});
	});

	it("returns empty when both change lists are empty", () => {
		expect(detectConflicts([], [])).toEqual([]);
	});
});

describe("reconcileFirstSync", () => {
	it("removes identical files from both change lists and populates cache", async () => {
		const localChanges: FileChange[] = [
			{ path: "shared.md", type: "create" },
			{ path: "local-only.md", type: "create" },
		];
		const remoteChanges: FileChange[] = [
			{ path: "shared.md", type: "create" },
			{ path: "remote-only.md", type: "create" },
		];
		const localFiles: LocalFileInfo[] = [
			{ path: "shared.md", contentHash: "abc123", size: 10 },
			{ path: "local-only.md", contentHash: "def456", size: 20 },
		];

		const getRemoteFileHash = vi.fn().mockResolvedValue({
			contentHash: "abc123",
			remoteSha: "sha-remote",
			size: 10,
			isBinary: false,
		});

		const result = await reconcileFirstSync(
			localChanges,
			remoteChanges,
			localFiles,
			getRemoteFileHash,
		);

		expect(result.localChanges).toEqual([{ path: "local-only.md", type: "create" }]);
		expect(result.remoteChanges).toEqual([{ path: "remote-only.md", type: "create" }]);
		expect(result.cacheEntries["shared.md"]).toBeDefined();
		expect(result.cacheEntries["shared.md"].remoteSha).toBe("sha-remote");
		expect(result.cacheEntries["shared.md"].localContentHash).toBe("abc123");
		expect(getRemoteFileHash).toHaveBeenCalledWith("shared.md");
	});

	it("keeps files with different content in change lists", async () => {
		const localChanges: FileChange[] = [{ path: "diff.md", type: "create" }];
		const remoteChanges: FileChange[] = [{ path: "diff.md", type: "create" }];
		const localFiles: LocalFileInfo[] = [{ path: "diff.md", contentHash: "local-hash", size: 10 }];

		const getRemoteFileHash = vi.fn().mockResolvedValue({
			contentHash: "remote-hash",
			remoteSha: "sha-remote",
			size: 15,
			isBinary: false,
		});

		const result = await reconcileFirstSync(
			localChanges,
			remoteChanges,
			localFiles,
			getRemoteFileHash,
		);

		expect(result.localChanges).toEqual([{ path: "diff.md", type: "create" }]);
		expect(result.remoteChanges).toEqual([{ path: "diff.md", type: "create" }]);
		expect(result.cacheEntries).toEqual({});
	});

	it("handles mix of identical and different overlapping files", async () => {
		const localChanges: FileChange[] = [
			{ path: "same.md", type: "create" },
			{ path: "diff.md", type: "create" },
			{ path: "local-only.md", type: "create" },
		];
		const remoteChanges: FileChange[] = [
			{ path: "same.md", type: "create" },
			{ path: "diff.md", type: "create" },
			{ path: "remote-only.md", type: "create" },
		];
		const localFiles: LocalFileInfo[] = [
			{ path: "same.md", contentHash: "hash-same", size: 10 },
			{ path: "diff.md", contentHash: "hash-local", size: 20 },
			{ path: "local-only.md", contentHash: "hash-lo", size: 5 },
		];

		const getRemoteFileHash = vi.fn().mockImplementation(async (path: string) => {
			if (path === "same.md") {
				return { contentHash: "hash-same", remoteSha: "sha-same", size: 10, isBinary: false };
			}
			return { contentHash: "hash-remote", remoteSha: "sha-diff", size: 25, isBinary: false };
		});

		const result = await reconcileFirstSync(
			localChanges,
			remoteChanges,
			localFiles,
			getRemoteFileHash,
		);

		expect(result.localChanges).toHaveLength(2);
		expect(result.localChanges.map((c) => c.path)).toContain("diff.md");
		expect(result.localChanges.map((c) => c.path)).toContain("local-only.md");
		expect(result.remoteChanges).toHaveLength(2);
		expect(result.remoteChanges.map((c) => c.path)).toContain("diff.md");
		expect(result.remoteChanges.map((c) => c.path)).toContain("remote-only.md");
		expect(Object.keys(result.cacheEntries)).toEqual(["same.md"]);
	});

	it("returns unchanged lists when no overlapping files", async () => {
		const localChanges: FileChange[] = [{ path: "a.md", type: "create" }];
		const remoteChanges: FileChange[] = [{ path: "b.md", type: "create" }];
		const localFiles: LocalFileInfo[] = [{ path: "a.md", contentHash: "h", size: 5 }];

		const getRemoteFileHash = vi.fn();

		const result = await reconcileFirstSync(
			localChanges,
			remoteChanges,
			localFiles,
			getRemoteFileHash,
		);

		expect(result.localChanges).toEqual(localChanges);
		expect(result.remoteChanges).toEqual(remoteChanges);
		expect(result.cacheEntries).toEqual({});
		expect(getRemoteFileHash).not.toHaveBeenCalled();
	});

	it("only calls getRemoteFileHash for overlapping files", async () => {
		const localChanges: FileChange[] = [
			{ path: "shared.md", type: "create" },
			{ path: "local.md", type: "create" },
		];
		const remoteChanges: FileChange[] = [
			{ path: "shared.md", type: "create" },
			{ path: "remote.md", type: "create" },
		];
		const localFiles: LocalFileInfo[] = [
			{ path: "shared.md", contentHash: "h", size: 5 },
			{ path: "local.md", contentHash: "h2", size: 5 },
		];

		const getRemoteFileHash = vi.fn().mockResolvedValue({
			contentHash: "h",
			remoteSha: "sha",
			size: 5,
			isBinary: false,
		});

		await reconcileFirstSync(localChanges, remoteChanges, localFiles, getRemoteFileHash);

		expect(getRemoteFileHash).toHaveBeenCalledTimes(1);
		expect(getRemoteFileHash).toHaveBeenCalledWith("shared.md");
	});
});
