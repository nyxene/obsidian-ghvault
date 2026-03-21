import type { GitHubClient } from "../github/client";
import type { GitHubGraphQL } from "../github/graphql";
import type { FileChange } from "../types";
import { arrayBufferToBase64, toBase64 } from "../utils/base64";
import { hasBinaryContent } from "../utils/binary";
import { pMap } from "../utils/concurrency";
import { computeGitBlobSha, computeHashFromBuffer } from "../utils/hash";
import type { Logger } from "../utils/logger";
import { isSafePath, toRepoPath } from "../utils/path";
import type { SyncStateManager } from "./state";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_GRAPHQL_FILE_SIZE = 1.5 * 1024 * 1024; // 1.5MB — GraphQL ~2MB base64 limit
const PUSH_READ_CONCURRENCY = 10;

export interface VaultReader {
	readFileBinary(path: string): Promise<ArrayBuffer>;
}

export interface PushResult {
	pushed: string[];
	deleted: string[];
	oid: string;
}

export interface PushEngineOptions {
	graphql: GitHubGraphQL;
	client: GitHubClient;
	state: SyncStateManager;
	vault: VaultReader;
	logger: Logger;
	syncFolder: string;
}

export interface PushCommitOptions {
	branch: string;
	owner: string;
	repo: string;
	message: string;
}

export class PushEngine {
	private readonly graphql: GitHubGraphQL;
	private readonly client: GitHubClient;
	private readonly state: SyncStateManager;
	private readonly vault: VaultReader;
	private readonly logger: Logger;
	private readonly syncFolder: string;

	constructor(options: PushEngineOptions) {
		this.graphql = options.graphql;
		this.client = options.client;
		this.state = options.state;
		this.vault = options.vault;
		this.logger = options.logger;
		this.syncFolder = options.syncFolder;
	}

	async push(changes: FileChange[], commitOptions: PushCommitOptions): Promise<PushResult> {
		const result: PushResult = { pushed: [], deleted: [], oid: "" };

		if (changes.length === 0) {
			this.logger.info("Push skipped — no local changes");
			return result;
		}

		this.logger.info("Push started", { changes: changes.length });

		const additions: Array<{ path: string; base64Content: string }> = [];
		const deletions: Array<{ path: string }> = [];
		const contentHashes = new Map<
			string,
			{ hash: string; size: number; blobSha: string; isBinary: boolean }
		>();

		// Collect deletes (no I/O needed)
		const uploads: FileChange[] = [];
		for (const change of changes) {
			if (!isSafePath(change.path)) {
				this.logger.warn("Skipping unsafe path", { path: change.path });
				continue;
			}
			if (change.type === "delete") {
				const repoPath = toRepoPath(change.path, this.syncFolder);
				deletions.push({ path: repoPath });
				result.deleted.push(change.path);
			} else if (change.type === "create" || change.type === "modify") {
				if (change.sizeHint !== undefined && change.sizeHint > MAX_FILE_SIZE) {
					this.logger.warn("Skipping oversized file (pre-check)", {
						path: change.path,
						size: change.sizeHint,
					});
					continue;
				}
				uploads.push(change);
			}
		}

		// Large files deferred to REST fallback (read lazily, one at a time)
		const largeFilePaths: Array<{
			path: string;
			repoPath: string;
		}> = [];

		// Read + hash + encode files in parallel
		await pMap(
			uploads,
			async (change) => {
				const rawBuffer = await this.vault.readFileBinary(change.path);
				const rawBytes = new Uint8Array(rawBuffer);
				const contentSize = rawBytes.length;
				const isBinary = hasBinaryContent(rawBytes);

				if (contentSize > MAX_FILE_SIZE) {
					this.logger.warn("Skipping oversized file", {
						path: change.path,
						size: contentSize,
					});
					return;
				}

				const repoPath = toRepoPath(change.path, this.syncFolder);

				// Defer large files to REST phase — skip encoding/hashing here
				if (contentSize > MAX_GRAPHQL_FILE_SIZE) {
					largeFilePaths.push({ path: change.path, repoPath });
					return;
				}

				const base64Content = isBinary
					? arrayBufferToBase64(rawBuffer)
					: toBase64(new TextDecoder().decode(rawBytes));
				const hash = await computeHashFromBuffer(rawBytes);
				const blobSha = await computeGitBlobSha(rawBytes);
				additions.push({ path: repoPath, base64Content });
				contentHashes.set(change.path, { hash, size: contentSize, blobSha, isBinary });
				result.pushed.push(change.path);
			},
			PUSH_READ_CONCURRENCY,
		);

		if (additions.length === 0 && deletions.length === 0 && largeFilePaths.length === 0) {
			this.logger.info("Push skipped — all changes filtered");
			return result;
		}

		let currentOid = this.state.getHeadOid();

		// GraphQL path: small files + deletions (batch, fast)
		if (additions.length > 0 || deletions.length > 0) {
			const commitResult = await this.graphql.createCommit({
				branch: commitOptions.branch,
				owner: commitOptions.owner,
				repo: commitOptions.repo,
				expectedHeadOid: currentOid,
				message: commitOptions.message,
				additions,
				deletions,
			});
			currentOid = commitResult.oid;
			result.oid = commitResult.oid;
		}

		// REST path: large files (1.5–50MB) via Git Data API
		// Files are read and uploaded one at a time to minimize memory usage
		if (largeFilePaths.length > 0) {
			this.logger.info("REST push for large files", { count: largeFilePaths.length });

			const commit = await this.client.getCommit(currentOid);
			const blobEntries: Array<{ path: string; sha: string }> = [];

			for (const { path, repoPath } of largeFilePaths) {
				const rawBuffer = await this.vault.readFileBinary(path);
				const rawBytes = new Uint8Array(rawBuffer);
				const isBinary = hasBinaryContent(rawBytes);
				const base64Content = isBinary
					? arrayBufferToBase64(rawBuffer)
					: toBase64(new TextDecoder().decode(rawBytes));

				const blobSha = await this.client.createBlob(base64Content);
				blobEntries.push({ path: repoPath, sha: blobSha });

				const hash = await computeHashFromBuffer(rawBytes);
				const localBlobSha = await computeGitBlobSha(rawBytes);
				contentHashes.set(path, {
					hash,
					size: rawBytes.length,
					blobSha: localBlobSha,
					isBinary,
				});
				result.pushed.push(path);
			}

			const treeSha = await this.client.createTreeFromEntries(commit.treeSha, blobEntries);
			const restMessage =
				largeFilePaths.length === 1
					? `vault sync: large file ${largeFilePaths[0].path}`
					: `vault sync: ${largeFilePaths.length} large file(s)`;
			const newCommitSha = await this.client.createCommitRest(treeSha, currentOid, restMessage);
			await this.client.updateRef(commitOptions.branch, newCommitSha);

			currentOid = newCommitSha;
			result.oid = newCommitSha;
		}

		for (const path of result.pushed) {
			const info = contentHashes.get(path);
			this.state.setSHA(path, {
				remoteSha: info?.blobSha ?? "",
				localContentHash: info?.hash ?? "",
				lastSyncedAt: Date.now(),
				size: info?.size ?? 0,
				isBinary: info?.isBinary ?? false,
			});
		}
		for (const path of result.deleted) {
			this.state.deleteSHA(path);
		}

		this.state.setHeadOid(currentOid);
		this.state.setLastSyncedAt(Date.now());
		await this.state.save();

		this.logger.info("Push complete", {
			pushed: result.pushed.length,
			deleted: result.deleted.length,
			oid: result.oid,
		});

		return result;
	}
}
