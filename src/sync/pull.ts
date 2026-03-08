import type { GitHubClient } from "../github/client";
import type { SHACacheEntry } from "../types";
import type { Logger } from "../utils/logger";
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

		const ref = await this.client.getRef(branch);
		const commit = await this.client.getCommit(ref.sha);
		const tree = await this.client.getTree(commit.treeSha, true);

		if (tree.truncated) {
			this.logger.warn("Tree response truncated — some files may be missed");
		}

		const cache = this.state.getAllSHAs();
		const changes = computeRemoteChanges(tree.entries, cache);

		if (changes.length === 0) {
			this.logger.info("Pull complete — no remote changes");
			this.state.setHeadOid(ref.sha);
			this.state.setLastSyncedAt(Date.now());
			await this.state.save();
			return result;
		}

		this.logger.info("Remote changes detected", { count: changes.length });

		for (const change of changes) {
			try {
				if (change.type === "create" || change.type === "modify") {
					const file = await this.client.getFileContent(change.path, branch);
					const content = decodeBase64Content(file.content);
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
				} else if (change.type === "delete") {
					await this.vault.deleteFile(change.path);
					this.state.deleteSHA(change.path);
					result.deleted.push(change.path);
				}
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
}

function decodeBase64Content(encoded: string): string {
	const cleaned = encoded.replace(/\n/g, "");
	const bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}
