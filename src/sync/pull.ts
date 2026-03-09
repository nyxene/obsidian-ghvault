import type { GitHubClient } from "../github/client";
import type { FileChange, GitHubRef, SHACacheEntry } from "../types";
import { GitHubEmptyRepoError, GitHubNotFoundError } from "../types";
import { pMap } from "../utils/concurrency";
import { computeGitBlobSha } from "../utils/hash";
import type { Logger } from "../utils/logger";
import { isSafePath } from "../utils/path";
import { computeRemoteChanges } from "./comparator";
import type { SyncStateManager } from "./state";

export interface VaultAdapter {
	writeFile(path: string, content: string): Promise<void>;
	deleteFile(path: string): Promise<void>;
}

export interface PullResult {
	created: string[];
	modified: string[];
	deleted: string[];
	errors: Array<{ path: string; error: string }>;
}

export interface PullEngineOptions {
	client: GitHubClient;
	state: SyncStateManager;
	vault: VaultAdapter;
	logger: Logger;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const PULL_CONCURRENCY = 8;

export class PullEngine {
	private readonly client: GitHubClient;
	private readonly state: SyncStateManager;
	private readonly vault: VaultAdapter;
	private readonly logger: Logger;

	constructor(options: PullEngineOptions) {
		this.client = options.client;
		this.state = options.state;
		this.vault = options.vault;
		this.logger = options.logger;
	}

	async pull(branch: string): Promise<PullResult> {
		const result: PullResult = { created: [], modified: [], deleted: [], errors: [] };

		this.logger.info("Pull started", { branch });

		let ref: GitHubRef;
		try {
			ref = await this.client.getRef(branch);
		} catch (error: unknown) {
			if (error instanceof GitHubEmptyRepoError) {
				this.logger.info("Repository is empty — initializing");
				const init = await this.client.createFile(
					".ghvault",
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

		const treeSizeMap = new Map<string, number>();
		for (const entry of treeEntries) {
			if (entry.size !== undefined) {
				treeSizeMap.set(entry.path, entry.size);
			}
		}

		const cache = this.state.getAllSHAs();
		const changes = computeRemoteChanges(treeEntries, cache);

		if (changes.length === 0) {
			this.logger.info("Pull complete — no remote changes");
			this.state.setHeadOid(ref.sha);
			this.state.setLastSyncedAt(Date.now());
			await this.state.save();
			return result;
		}

		this.logger.info("Remote changes detected", { count: changes.length });

		// Separate deletes (no HTTP needed) from downloads (create/modify)
		const downloads: FileChange[] = [];
		const deletes: FileChange[] = [];
		for (const change of changes) {
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

		// Process downloads in parallel with controlled concurrency
		await pMap(
			downloads,
			async (change) => {
				try {
					const file = await this.client.getFileContent(change.path, branch);
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

					const content = new TextDecoder().decode(rawBytes);
					await this.vault.writeFile(change.path, content);

					const entry: SHACacheEntry = {
						remoteSha: file.sha,
						localContentHash: "",
						lastSyncedAt: Date.now(),
						size: file.size,
						isBinary: false,
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
			const cached = this.state.getSHA(entry.path);
			if (cached) {
				this.state.setSHA(entry.path, { ...cached, remoteSha: entry.sha });
			}
		}
		await this.state.save();
	}
}

function decodeBase64ToBytes(encoded: string): Uint8Array {
	const cleaned = encoded.replace(/\n/g, "");
	return Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
}
