import type { GitHubGraphQL } from "../github/graphql";
import type { FileChange } from "../types";
import { computeHash } from "../utils/hash";
import type { Logger } from "../utils/logger";
import { isSafePath } from "../utils/path";
import type { SyncStateManager } from "./state";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_GRAPHQL_FILE_SIZE = 1.5 * 1024 * 1024; // 1.5MB — GraphQL ~2MB base64 limit

export interface VaultReader {
	readFile(path: string): Promise<string>;
}

export interface PushResult {
	pushed: string[];
	deleted: string[];
	oid: string;
}

export interface PushEngineOptions {
	graphql: GitHubGraphQL;
	state: SyncStateManager;
	vault: VaultReader;
	logger: Logger;
}

export interface PushCommitOptions {
	branch: string;
	owner: string;
	repo: string;
	message: string;
}

export class PushEngine {
	private readonly graphql: GitHubGraphQL;
	private readonly state: SyncStateManager;
	private readonly vault: VaultReader;
	private readonly logger: Logger;

	constructor(options: PushEngineOptions) {
		this.graphql = options.graphql;
		this.state = options.state;
		this.vault = options.vault;
		this.logger = options.logger;
	}

	async push(changes: FileChange[], commitOptions: PushCommitOptions): Promise<PushResult> {
		const result: PushResult = { pushed: [], deleted: [], oid: "" };

		if (changes.length === 0) {
			this.logger.info("Push skipped — no local changes");
			return result;
		}

		this.logger.info("Push started", { changes: changes.length });

		const additions = [];
		const deletions = [];
		const contentHashes = new Map<string, { hash: string; size: number }>();

		for (const change of changes) {
			if (!isSafePath(change.path)) {
				this.logger.warn("Skipping unsafe path", { path: change.path });
				continue;
			}

			if (change.type === "create" || change.type === "modify") {
				const content = await this.vault.readFile(change.path);
				const contentSize = new TextEncoder().encode(content).length;
				if (contentSize > MAX_FILE_SIZE) {
					this.logger.warn("Skipping oversized file", {
						path: change.path,
						size: contentSize,
					});
					continue;
				}
				if (contentSize > MAX_GRAPHQL_FILE_SIZE) {
					this.logger.warn("Skipping large file — exceeds GraphQL payload limit", {
						path: change.path,
						size: contentSize,
						maxSize: MAX_GRAPHQL_FILE_SIZE,
					});
					continue;
				}
				const base64Content = encodeToBase64(content);
				const hash = await computeHash(content);
				additions.push({ path: change.path, base64Content });
				contentHashes.set(change.path, { hash, size: contentSize });
				result.pushed.push(change.path);
			} else if (change.type === "delete") {
				deletions.push({ path: change.path });
				result.deleted.push(change.path);
			}
		}

		if (additions.length === 0 && deletions.length === 0) {
			this.logger.info("Push skipped — all changes filtered");
			return result;
		}

		const headOid = this.state.getHeadOid();
		const commitResult = await this.graphql.createCommit({
			branch: commitOptions.branch,
			owner: commitOptions.owner,
			repo: commitOptions.repo,
			expectedHeadOid: headOid,
			message: commitOptions.message,
			additions,
			deletions,
		});

		result.oid = commitResult.oid;

		for (const path of result.pushed) {
			const info = contentHashes.get(path);
			this.state.setSHA(path, {
				remoteSha: "",
				localContentHash: info?.hash ?? "",
				lastSyncedAt: Date.now(),
				size: info?.size ?? 0,
				isBinary: false,
			});
		}
		for (const path of result.deleted) {
			this.state.deleteSHA(path);
		}

		this.state.setHeadOid(commitResult.oid);
		this.state.setLastSyncedAt(Date.now());
		await this.state.save();

		this.logger.info("Push complete", {
			pushed: result.pushed.length,
			deleted: result.deleted.length,
			oid: commitResult.oid,
		});

		return result;
	}
}

function encodeToBase64(content: string): string {
	const bytes = new TextEncoder().encode(content);
	const chunkSize = 8192;
	const chunks: string[] = [];
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const end = Math.min(i + chunkSize, bytes.length);
		const slice = bytes.subarray(i, end);
		chunks.push(String.fromCharCode(...slice));
	}
	return btoa(chunks.join(""));
}
