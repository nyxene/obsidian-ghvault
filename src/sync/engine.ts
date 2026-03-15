import type { ConflictDecision, ConflictInfo, ConflictStrategy, RenameInfo } from "../types";
import type { Logger } from "../utils/logger";
import type { LocalFileInfo } from "./comparator";
import {
	computeLocalChanges,
	detectConflicts,
	detectLocalRenames,
	detectRemoteRenames,
	reconcileFirstSync,
} from "./comparator";
import type { PullEngine, PullResult } from "./pull";
import type { PushCommitOptions, PushEngine, PushResult } from "./push";
import type { SyncStateManager } from "./state";

export interface SyncVault {
	readFile(path: string): Promise<string>;
	readFileBinary(path: string): Promise<ArrayBuffer>;
	writeFile(path: string, content: string): Promise<void>;
	writeFileBinary(path: string, data: ArrayBuffer): Promise<void>;
	deleteFile(path: string): Promise<void>;
	renameFile(oldPath: string, newPath: string): Promise<void>;
	listFiles(): Promise<LocalFileInfo[]>;
}

export interface SyncResult {
	pull: PullResult;
	push: PushResult | null;
	conflicts: ConflictInfo[];
	renames: RenameInfo[];
	resolvedCount: number;
	error?: string;
}

export interface SyncEngineOptions {
	pullEngine: PullEngine;
	pushEngine: PushEngine;
	state: SyncStateManager;
	vault: SyncVault;
	logger: Logger;
	commitOptions: Omit<PushCommitOptions, "message">;
	conflictStrategy?: ConflictStrategy;
	onConflict?: (conflicts: ConflictInfo[]) => Promise<ConflictDecision[]>;
}

export class SyncEngine {
	private readonly pullEngine: PullEngine;
	private readonly pushEngine: PushEngine;
	private readonly state: SyncStateManager;
	private readonly vault: SyncVault;
	private readonly logger: Logger;
	private readonly commitOptions: Omit<PushCommitOptions, "message">;
	private readonly conflictStrategy: ConflictStrategy;
	private readonly onConflict?: (conflicts: ConflictInfo[]) => Promise<ConflictDecision[]>;
	private syncPromise: Promise<SyncResult> | null = null;

	constructor(options: SyncEngineOptions) {
		this.pullEngine = options.pullEngine;
		this.pushEngine = options.pushEngine;
		this.state = options.state;
		this.vault = options.vault;
		this.logger = options.logger;
		this.commitOptions = options.commitOptions;
		this.conflictStrategy = options.conflictStrategy ?? "skip";
		this.onConflict = options.onConflict;
	}

	get isSyncing(): boolean {
		return this.syncPromise !== null;
	}

	async sync(): Promise<SyncResult> {
		if (this.syncPromise) {
			throw new Error("Sync already in progress");
		}

		this.syncPromise = this.executeSyncCycle();
		try {
			return await this.syncPromise;
		} finally {
			this.syncPromise = null;
		}
	}

	private async executeSyncCycle(): Promise<SyncResult> {
		this.logger.info("Sync started");

		await this.state.load();

		// Compute local changes BEFORE pull to enable conflict detection
		const localFiles = await this.vault.listFiles();
		const cache = this.state.getAllSHAs();
		let localChanges = computeLocalChanges(localFiles, cache);

		// Get remote changes without applying them
		let remoteChanges = await this.pullEngine.getRemoteChanges(this.commitOptions.branch);

		// First sync: reconcile overlapping files by comparing content hashes
		const isFirstSync = this.state.getHeadOid() === "" && Object.keys(cache).length === 0;
		if (isFirstSync && localChanges.length > 0 && remoteChanges.length > 0) {
			this.logger.info("First sync with non-empty vault and repo — reconciling");
			const reconciliation = await reconcileFirstSync(
				localChanges,
				remoteChanges,
				localFiles,
				(path) => this.pullEngine.getRemoteFileHash(this.commitOptions.branch, path),
			);
			localChanges = reconciliation.localChanges;
			remoteChanges = reconciliation.remoteChanges;

			// Pre-populate cache for identical files
			const identicalCount = Object.keys(reconciliation.cacheEntries).length;
			if (identicalCount > 0) {
				this.state.setSHABatch(reconciliation.cacheEntries);
				this.logger.info("First sync: identical files cached", { count: identicalCount });
			}
		}

		// Detect renames: delete + create pairs with matching content hash
		const localRenames = detectLocalRenames(localChanges, localFiles, cache);
		const remoteTree = this.pullEngine.getLastMappedTree();
		const remoteRenames = detectRemoteRenames(remoteChanges, remoteTree, cache);
		const allRenames = [...localRenames, ...remoteRenames];

		if (allRenames.length > 0) {
			for (const rename of allRenames) {
				this.logger.info("Rename detected", { from: rename.oldPath, to: rename.newPath });
			}
		}

		// Detect conflicts: files changed both locally and remotely
		const conflicts = detectConflicts(localChanges, remoteChanges);
		const conflictPaths = new Set(conflicts.map((c) => c.path));

		if (conflicts.length > 0) {
			for (const conflict of conflicts) {
				this.logger.warn(`Conflict detected — strategy: ${this.conflictStrategy}`, {
					path: conflict.path,
					localChange: conflict.localChange,
					remoteChange: conflict.remoteChange,
				});
			}
		}

		// Resolve conflict decisions based on strategy
		const decisions = await this.resolveConflictDecisions(conflicts);
		const localWinPaths = new Set(
			decisions.filter((d) => d.resolution === "local").map((d) => d.path),
		);
		const remoteWinPaths = new Set(
			decisions.filter((d) => d.resolution === "remote").map((d) => d.path),
		);

		// Pull skips: all conflict paths EXCEPT those resolved as remote-wins
		const pullSkipPaths = new Set([...conflictPaths].filter((p) => !remoteWinPaths.has(p)));

		const pull = await this.pullEngine.pull(
			this.commitOptions.branch,
			pullSkipPaths,
			remoteRenames,
		);

		// Push includes conflict paths only if resolved as local-wins
		const safePushChanges = localChanges.filter((c) => {
			if (!conflictPaths.has(c.path)) return true;
			return localWinPaths.has(c.path);
		});

		let push: PushResult | null = null;

		if (safePushChanges.length > 0) {
			this.logger.info("Local changes detected", { count: safePushChanges.length });
			push = await this.pushEngine.push(safePushChanges, {
				...this.commitOptions,
				message: `vault sync: ${safePushChanges.length} file(s)`,
			});

			if (push.oid) {
				await this.pullEngine.updateCacheFromCommit(push.oid);
			}
		} else {
			this.logger.info("No local changes to push");
		}

		this.logger.info("Sync complete", {
			pullCreated: pull.created.length,
			pullModified: pull.modified.length,
			pullDeleted: pull.deleted.length,
			pushed: push?.pushed.length ?? 0,
			pushDeleted: push?.deleted.length ?? 0,
			conflicts: conflicts.length,
		});

		return { pull, push, conflicts, renames: allRenames, resolvedCount: decisions.length };
	}

	private async resolveConflictDecisions(conflicts: ConflictInfo[]): Promise<ConflictDecision[]> {
		if (conflicts.length === 0) return [];

		switch (this.conflictStrategy) {
			case "local-wins":
				return conflicts.map((c) => ({ path: c.path, resolution: "local" }));
			case "remote-wins":
				return conflicts.map((c) => ({ path: c.path, resolution: "remote" }));
			case "ask":
				if (this.onConflict) {
					try {
						return await this.onConflict(conflicts);
					} catch (error: unknown) {
						const message = error instanceof Error ? error.message : String(error);
						this.logger.warn("Conflict callback failed, falling back to skip", {
							error: message,
						});
						return [];
					}
				}
				this.logger.warn("Ask strategy with no onConflict callback, falling back to skip");
				return [];
			default:
				return [];
		}
	}
}
