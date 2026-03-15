import type { ConflictInfo, FileChange, GitHubTreeEntry, SHACacheEntry } from "../types";
import { isExcluded } from "../utils/path";

export interface LocalFileInfo {
	path: string;
	contentHash: string;
	size: number;
	isBinary?: boolean;
}

/**
 * Detect local changes by comparing local files against the SHA cache.
 * - File exists locally but not in cache → create
 * - File exists in both, local hash differs → modify
 * - File exists in cache but not locally → delete
 */
export function computeLocalChanges(
	localFiles: LocalFileInfo[],
	cache: Readonly<Record<string, SHACacheEntry>>,
): FileChange[] {
	const changes: FileChange[] = [];
	const localPaths = new Set<string>();

	for (const file of localFiles) {
		if (isExcluded(file.path)) continue;
		localPaths.add(file.path);

		const cached = cache[file.path];
		if (!cached) {
			changes.push({ path: file.path, type: "create", sizeHint: file.size });
		} else if (cached.localContentHash !== file.contentHash) {
			changes.push({ path: file.path, type: "modify", sizeHint: file.size });
		}
	}

	for (const path of Object.keys(cache)) {
		if (isExcluded(path)) continue;
		if (!localPaths.has(path)) {
			changes.push({ path, type: "delete" });
		}
	}

	return changes;
}

/**
 * Detect remote changes by comparing remote tree against the SHA cache.
 * - File exists in tree but not in cache → create
 * - File exists in both, remote SHA differs → modify
 * - File exists in cache but not in tree → delete
 */
export function computeRemoteChanges(
	remoteTree: GitHubTreeEntry[],
	cache: Readonly<Record<string, SHACacheEntry>>,
): FileChange[] {
	const changes: FileChange[] = [];
	const remotePaths = new Set<string>();

	for (const entry of remoteTree) {
		if (entry.type !== "blob") continue;
		if (isExcluded(entry.path)) continue;
		remotePaths.add(entry.path);

		const cached = cache[entry.path];
		if (!cached) {
			changes.push({ path: entry.path, type: "create" });
		} else if (cached.remoteSha !== entry.sha) {
			changes.push({ path: entry.path, type: "modify" });
		}
	}

	for (const path of Object.keys(cache)) {
		if (isExcluded(path)) continue;
		if (!remotePaths.has(path)) {
			changes.push({ path, type: "delete" });
		}
	}

	return changes;
}

export interface RemoteFileHash {
	contentHash: string;
	remoteSha: string;
	size: number;
	isBinary: boolean;
}

export interface FirstSyncReconciliation {
	localChanges: FileChange[];
	remoteChanges: FileChange[];
	cacheEntries: Record<string, SHACacheEntry>;
}

/**
 * On first sync (empty cache), files existing on both sides are all detected as
 * "create" changes, which `detectConflicts` would mark as conflicts. This function
 * compares content hashes for overlapping files:
 * - Identical content → remove from both change lists, add to cache
 * - Different content → leave as-is (will become a conflict)
 */
export async function reconcileFirstSync(
	localChanges: FileChange[],
	remoteChanges: FileChange[],
	localFiles: LocalFileInfo[],
	getRemoteFileHash: (path: string) => Promise<RemoteFileHash>,
): Promise<FirstSyncReconciliation> {
	const localByPath = new Map(localChanges.map((c) => [c.path, c]));
	const remoteByPath = new Map(remoteChanges.map((c) => [c.path, c]));
	const localFileByPath = new Map(localFiles.map((f) => [f.path, f]));

	// Find paths that appear in both change lists
	const overlapping: string[] = [];
	for (const path of localByPath.keys()) {
		if (remoteByPath.has(path)) {
			overlapping.push(path);
		}
	}

	const identicalPaths = new Set<string>();
	const cacheEntries: Record<string, SHACacheEntry> = {};

	for (const path of overlapping) {
		const localFile = localFileByPath.get(path);
		if (!localFile) continue;

		const remote = await getRemoteFileHash(path);

		if (localFile.contentHash === remote.contentHash) {
			identicalPaths.add(path);
			cacheEntries[path] = {
				remoteSha: remote.remoteSha,
				localContentHash: localFile.contentHash,
				lastSyncedAt: Date.now(),
				size: remote.size,
				isBinary: remote.isBinary,
			};
		}
	}

	return {
		localChanges: localChanges.filter((c) => !identicalPaths.has(c.path)),
		remoteChanges: remoteChanges.filter((c) => !identicalPaths.has(c.path)),
		cacheEntries,
	};
}

/**
 * Detect conflicts: files that appear in both local and remote change sets.
 * Returns the list of conflicted paths so they can be skipped in both pull and push.
 */
export function detectConflicts(
	localChanges: FileChange[],
	remoteChanges: FileChange[],
): ConflictInfo[] {
	const localByPath = new Map<string, FileChange>();
	for (const change of localChanges) {
		localByPath.set(change.path, change);
	}

	const conflicts: ConflictInfo[] = [];
	for (const remote of remoteChanges) {
		const local = localByPath.get(remote.path);
		if (local) {
			conflicts.push({
				path: remote.path,
				localChange: local.type,
				remoteChange: remote.type,
			});
		}
	}

	return conflicts;
}
