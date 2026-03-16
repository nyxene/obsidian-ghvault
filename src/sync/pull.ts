import type { GitHubClient } from "../github/client";
import type { FileChange, GitHubRef, RenameInfo, SHACacheEntry } from "../types";
import { GitHubEmptyRepoError, GitHubNotFoundError } from "../types";
import { hasBinaryContent, toSafeArrayBuffer } from "../utils/binary";
import { pMap } from "../utils/concurrency";
import { computeGitBlobSha, computeHashFromBuffer } from "../utils/hash";
import type { Logger } from "../utils/logger";
import { isExcluded, isSafePath, toRepoPath, toVaultPath } from "../utils/path";
import { processZipEntries } from "../utils/zip";
import { computeRemoteChanges } from "./comparator";
import type { SyncStateManager } from "./state";

export interface VaultAdapter {
	writeFile(path: string, content: string): Promise<void>;
	writeFileBinary(path: string, data: ArrayBuffer): Promise<void>;
	deleteFile(path: string): Promise<void>;
	renameFile(oldPath: string, newPath: string): Promise<void>;
}

export interface PullResult {
	created: string[];
	modified: string[];
	deleted: string[];
	renamed: RenameInfo[];
	errors: Array<{ path: string; error: string }>;
}

export interface PullEngineOptions {
	client: GitHubClient;
	state: SyncStateManager;
	vault: VaultAdapter;
	logger: Logger;
	syncFolder: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const PULL_CONCURRENCY = 8;
const ZIP_MIN_FILES = 5;
const ZIP_MAX_SIZE = 100 * 1024 * 1024; // 100MB

export class PullEngine {
	private readonly client: GitHubClient;
	private readonly state: SyncStateManager;
	private readonly vault: VaultAdapter;
	private readonly logger: Logger;
	private readonly syncFolder: string;

	constructor(options: PullEngineOptions) {
		this.client = options.client;
		this.state = options.state;
		this.vault = options.vault;
		this.logger = options.logger;
		this.syncFolder = options.syncFolder;
	}

	private lastMappedTree: Awaited<ReturnType<GitHubClient["getTree"]>>["entries"] = [];

	getLastMappedTree(): Readonly<Awaited<ReturnType<GitHubClient["getTree"]>>["entries"]> {
		return this.lastMappedTree;
	}

	async getRemoteChanges(branch: string): Promise<FileChange[]> {
		let ref: GitHubRef;
		try {
			ref = await this.client.getRef(branch);
		} catch (error: unknown) {
			if (error instanceof GitHubEmptyRepoError) {
				return [];
			}
			throw error;
		}
		const commit = await this.client.getCommit(ref.sha);

		let treeEntries: Awaited<ReturnType<GitHubClient["getTree"]>>["entries"] = [];
		try {
			const tree = await this.client.getTree(commit.treeSha, true);
			treeEntries = tree.entries;
		} catch (error: unknown) {
			if (!(error instanceof GitHubNotFoundError)) throw error;
		}

		// Map repo paths to vault paths, filtering out files outside syncFolder
		const mappedEntries = this.mapTreeToVaultPaths(treeEntries);
		this.lastMappedTree = mappedEntries;

		const cache = this.state.getAllSHAs();
		return computeRemoteChanges(mappedEntries, cache);
	}

	async pull(
		branch: string,
		skipPaths?: ReadonlySet<string>,
		remoteRenames?: readonly RenameInfo[],
	): Promise<PullResult> {
		const result: PullResult = { created: [], modified: [], deleted: [], renamed: [], errors: [] };

		this.logger.info("Pull started", { branch });

		let ref: GitHubRef;
		try {
			ref = await this.client.getRef(branch);
		} catch (error: unknown) {
			if (error instanceof GitHubEmptyRepoError) {
				this.logger.info("Repository is empty — initializing");
				const initPath = toRepoPath(".ghvault", this.syncFolder);
				const init = await this.client.createFile(
					initPath,
					"initialized",
					"chore: initialize repository",
					branch,
				);
				this.state.setHeadOid(init.commitSha);
				this.state.setLastSyncedAt(Date.now());
				await this.state.save();
				return result;
			}
			throw error;
		}
		const commit = await this.client.getCommit(ref.sha);

		let treeEntries: Awaited<ReturnType<GitHubClient["getTree"]>>["entries"] = [];
		try {
			const tree = await this.client.getTree(commit.treeSha, true);
			treeEntries = tree.entries;
			if (tree.truncated) {
				this.logger.warn("Tree response truncated — some files may be missed");
			}
		} catch (error: unknown) {
			if (error instanceof GitHubNotFoundError) {
				this.logger.info("Tree is empty (no files in repo)");
			} else {
				throw error;
			}
		}

		// Map repo paths to vault paths, filtering out files outside syncFolder.
		// Build a vault->repo path map for API calls and a vault->size map.
		const mappedEntries = this.mapTreeToVaultPaths(treeEntries);
		const repoPathMap = this.buildRepoPathMap(treeEntries);

		const treeSizeMap = new Map<string, number>();
		const treeShaMap = new Map<string, string>();
		for (const entry of mappedEntries) {
			if (entry.size !== undefined) {
				treeSizeMap.set(entry.path, entry.size);
			}
			treeShaMap.set(entry.path, entry.sha);
		}

		const cache = this.state.getAllSHAs();
		const allChanges = computeRemoteChanges(mappedEntries, cache);

		const changes = skipPaths?.size ? allChanges.filter((c) => !skipPaths.has(c.path)) : allChanges;

		if (changes.length === 0) {
			this.logger.info("Pull complete — no remote changes");
			this.state.setHeadOid(ref.sha);
			this.state.setLastSyncedAt(Date.now());
			await this.state.save();
			return result;
		}

		this.logger.info("Remote changes detected", { count: changes.length });

		// Handle remote renames: rename local file + update cache (no download)
		const renamePaths = new Set<string>();
		if (remoteRenames && remoteRenames.length > 0) {
			for (const rename of remoteRenames) {
				try {
					const oldCache = this.state.getSHA(rename.oldPath);
					await this.vault.renameFile(rename.oldPath, rename.newPath);
					this.state.deleteSHA(rename.oldPath);
					if (oldCache) {
						const newTreeEntry = mappedEntries.find((e) => e.path === rename.newPath);
						this.state.setSHA(rename.newPath, {
							...oldCache,
							remoteSha: newTreeEntry?.sha ?? oldCache.remoteSha,
							lastSyncedAt: Date.now(),
						});
					}
					result.renamed.push(rename);
					renamePaths.add(rename.oldPath);
					renamePaths.add(rename.newPath);
					this.logger.info("Remote rename applied", {
						from: rename.oldPath,
						to: rename.newPath,
					});
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : String(error);
					this.logger.error("Remote rename failed", {
						from: rename.oldPath,
						to: rename.newPath,
						error: message,
					});
					result.errors.push({ path: rename.oldPath, error: message });
				}
			}
		}

		// Separate deletes (no HTTP needed) from downloads (create/modify)
		const downloads: FileChange[] = [];
		const deletes: FileChange[] = [];
		for (const change of changes) {
			// Skip paths already handled by rename
			if (renamePaths.has(change.path)) continue;

			if (!isSafePath(change.path)) {
				this.logger.warn("Skipping unsafe path from remote", { path: change.path });
				result.errors.push({ path: change.path, error: "Unsafe path rejected" });
				continue;
			}

			const fileSize = treeSizeMap.get(change.path) ?? 0;
			if (fileSize > MAX_FILE_SIZE) {
				this.logger.warn("Skipping oversized file", {
					path: change.path,
					size: fileSize,
					maxSize: MAX_FILE_SIZE,
				});
				result.errors.push({
					path: change.path,
					error: `File too large (${Math.round(fileSize / 1024 / 1024)}MB)`,
				});
				continue;
			}

			if (change.type === "delete") {
				deletes.push(change);
			} else {
				downloads.push(change);
			}
		}

		// Choose download strategy: ZIP for full-repo bulk downloads, per-file otherwise
		const totalDownloadSize = downloads.reduce((sum, c) => sum + (treeSizeMap.get(c.path) ?? 0), 0);
		const useZip =
			!this.syncFolder && downloads.length > ZIP_MIN_FILES && totalDownloadSize <= ZIP_MAX_SIZE;

		if (useZip) {
			await this.pullViaZip(branch, ref.sha, downloads, treeShaMap, result);
		} else {
			await this.pullPerFile(branch, downloads, repoPathMap, result);
		}

		// Process deletes sequentially (fast, no HTTP)
		for (const change of deletes) {
			try {
				await this.vault.deleteFile(change.path);
				this.state.deleteSHA(change.path);
				result.deleted.push(change.path);
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				this.logger.error("Pull failed for file", { path: change.path, error: message });
				result.errors.push({ path: change.path, error: message });
			}
		}

		this.state.setHeadOid(ref.sha);
		this.state.setLastSyncedAt(Date.now());
		await this.state.save();

		this.logger.info("Pull complete", {
			created: result.created.length,
			modified: result.modified.length,
			deleted: result.deleted.length,
			errors: result.errors.length,
		});

		return result;
	}

	async getRemoteFileHash(
		branch: string,
		vaultPath: string,
	): Promise<{ contentHash: string; remoteSha: string; size: number; isBinary: boolean }> {
		const repoPath = toRepoPath(vaultPath, this.syncFolder);
		const file = await this.client.getFileContent(repoPath, branch);
		const rawBytes = decodeBase64ToBytes(file.content);
		const isBinary = hasBinaryContent(rawBytes);
		const contentHash = await computeHashFromBuffer(rawBytes);
		return { contentHash, remoteSha: file.sha, size: file.size, isBinary };
	}

	async updateCacheFromCommit(commitOid: string): Promise<void> {
		const commit = await this.client.getCommit(commitOid);
		let entries: Awaited<ReturnType<GitHubClient["getTree"]>>["entries"] = [];
		try {
			const tree = await this.client.getTree(commit.treeSha, true);
			entries = tree.entries;
		} catch (error: unknown) {
			if (!(error instanceof GitHubNotFoundError)) throw error;
		}

		for (const entry of entries) {
			if (entry.type !== "blob") continue;
			// Map repo path to vault path; skip files outside syncFolder
			const vaultPath = toVaultPath(entry.path, this.syncFolder);
			if (vaultPath === null) continue;
			const cached = this.state.getSHA(vaultPath);
			if (cached) {
				this.state.setSHA(vaultPath, { ...cached, remoteSha: entry.sha });
			}
		}
		await this.state.save();
	}

	/**
	 * Map tree entries from repo paths to vault paths, filtering out
	 * entries outside the syncFolder. Returns new entries with vault paths.
	 */
	private mapTreeToVaultPaths(
		entries: Awaited<ReturnType<GitHubClient["getTree"]>>["entries"],
	): Awaited<ReturnType<GitHubClient["getTree"]>>["entries"] {
		if (!this.syncFolder) return entries;

		const mapped: Awaited<ReturnType<GitHubClient["getTree"]>>["entries"] = [];
		for (const entry of entries) {
			const vaultPath = toVaultPath(entry.path, this.syncFolder);
			if (vaultPath !== null) {
				mapped.push({ ...entry, path: vaultPath });
			}
		}
		return mapped;
	}

	/**
	 * Build a map from vault path -> repo path for API calls.
	 * Only needed when syncFolder is set.
	 */
	private buildRepoPathMap(
		entries: Awaited<ReturnType<GitHubClient["getTree"]>>["entries"],
	): Map<string, string> {
		const map = new Map<string, string>();
		if (!this.syncFolder) return map;

		for (const entry of entries) {
			const vaultPath = toVaultPath(entry.path, this.syncFolder);
			if (vaultPath !== null) {
				map.set(vaultPath, entry.path);
			}
		}
		return map;
	}

	private async pullViaZip(
		branch: string,
		refSha: string,
		downloads: FileChange[],
		treeShaMap: Map<string, string>,
		result: PullResult,
	): Promise<void> {
		const downloadPaths = new Set(downloads.map((c) => c.path));
		const downloadTypes = new Map(downloads.map((c) => [c.path, c.type]));

		this.logger.info("ZIP pull started", { files: downloads.length, ref: refSha.slice(0, 8) });

		let zipBuffer: ArrayBuffer;
		try {
			zipBuffer = await this.client.downloadZipball(refSha);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.warn("ZIP download failed, falling back to per-file", { error: message });
			await this.pullPerFile(branch, downloads, new Map(), result);
			return;
		}

		try {
			await processZipEntries(zipBuffer, async (path, data) => {
				if (isExcluded(path)) return;
				if (!downloadPaths.has(path)) return;
				if (!isSafePath(path)) return;

				const blobSha = await computeGitBlobSha(data);
				const expectedSha = treeShaMap.get(path);
				if (expectedSha && blobSha !== expectedSha) {
					this.logger.error("SHA integrity check failed (ZIP)", {
						path,
						expected: expectedSha,
						actual: blobSha,
					});
					result.errors.push({
						path,
						error: "SHA integrity check failed — content may be tampered",
					});
					return;
				}

				const isBinary = hasBinaryContent(data);
				const contentHash = await computeHashFromBuffer(data);

				if (isBinary) {
					await this.vault.writeFileBinary(path, toSafeArrayBuffer(data));
				} else {
					const content = new TextDecoder().decode(data);
					await this.vault.writeFile(path, content);
				}

				const cacheEntry: SHACacheEntry = {
					remoteSha: expectedSha ?? blobSha,
					localContentHash: contentHash,
					lastSyncedAt: Date.now(),
					size: data.length,
					isBinary,
				};
				this.state.setSHA(path, cacheEntry);

				const changeType = downloadTypes.get(path);
				if (changeType === "create") {
					result.created.push(path);
				} else {
					result.modified.push(path);
				}

				downloadPaths.delete(path);
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger.warn("ZIP parse failed, falling back to per-file for remaining", {
				error: message,
			});
		}

		// Fallback: any files not found in ZIP → per-file download
		if (downloadPaths.size > 0) {
			const remaining = downloads.filter((c) => downloadPaths.has(c.path));
			this.logger.info("ZIP fallback: per-file for missing entries", {
				count: remaining.length,
			});
			await this.pullPerFile(branch, remaining, new Map(), result);
		}

		this.logger.info("ZIP pull complete", {
			created: result.created.length,
			modified: result.modified.length,
		});
	}

	private async pullPerFile(
		branch: string,
		downloads: FileChange[],
		repoPathMap: Map<string, string>,
		result: PullResult,
	): Promise<void> {
		await pMap(
			downloads,
			async (change) => {
				try {
					const repoPath = repoPathMap.get(change.path) ?? change.path;
					const file = await this.client.getFileContent(repoPath, branch);
					const rawBytes = decodeBase64ToBytes(file.content);

					const blobSha = await computeGitBlobSha(rawBytes);
					if (blobSha !== file.sha) {
						this.logger.error("SHA integrity check failed", {
							path: change.path,
							expected: file.sha,
							actual: blobSha,
						});
						result.errors.push({
							path: change.path,
							error: "SHA integrity check failed — content may be tampered",
						});
						return;
					}

					const isBinary = hasBinaryContent(rawBytes);
					const contentHash = await computeHashFromBuffer(rawBytes);

					if (isBinary) {
						await this.vault.writeFileBinary(change.path, toSafeArrayBuffer(rawBytes));
					} else {
						const content = new TextDecoder().decode(rawBytes);
						await this.vault.writeFile(change.path, content);
					}

					const entry: SHACacheEntry = {
						remoteSha: file.sha,
						localContentHash: contentHash,
						lastSyncedAt: Date.now(),
						size: file.size,
						isBinary,
					};
					this.state.setSHA(change.path, entry);

					if (change.type === "create") {
						result.created.push(change.path);
					} else {
						result.modified.push(change.path);
					}
				} catch (error: unknown) {
					const message = error instanceof Error ? error.message : String(error);
					this.logger.error("Pull failed for file", { path: change.path, error: message });
					result.errors.push({ path: change.path, error: message });
				}
			},
			PULL_CONCURRENCY,
		);
	}
}

const BASE64_RE = /^[A-Za-z0-9+/\n]+=*\n?$/;

function decodeBase64ToBytes(encoded: string): Uint8Array {
	if (!BASE64_RE.test(encoded)) {
		throw new Error("Invalid base64 content received from GitHub API");
	}
	const cleaned = encoded.replace(/\n/g, "");
	return Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
}
