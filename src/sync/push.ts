import type { GitHubGraphQL } from "../github/graphql";
import type { FileChange } from "../types";
import type { Logger } from "../utils/logger";
import type { SyncStateManager } from "./state";

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

		for (const change of changes) {
			if (change.type === "create" || change.type === "modify") {
				const content = await this.vault.readFile(change.path);
				const base64Content = encodeToBase64(content);
				additions.push({ path: change.path, base64Content });
				result.pushed.push(change.path);
			} else if (change.type === "delete") {
				deletions.push({ path: change.path });
				result.deleted.push(change.path);
			}
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

		for (const change of changes) {
			if (change.type === "create" || change.type === "modify") {
				this.state.setSHA(change.path, {
					remoteSha: "",
					localContentHash: "",
					lastSyncedAt: Date.now(),
					size: 0,
					isBinary: false,
				});
			} else if (change.type === "delete") {
				this.state.deleteSHA(change.path);
			}
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
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}
