import type { ConflictInfo, ConflictStrategy } from "../types";
import type { Logger } from "../utils/logger";
import type { LocalFileInfo } from "./comparator";
import { computeLocalChanges, detectConflicts } from "./comparator";
import type { PullEngine, PullResult } from "./pull";
import type { PushCommitOptions, PushEngine, PushResult } from "./push";
import type { SyncStateManager } from "./state";

export interface SyncVault {
	readFile(path: string): Promise<string>;
	readFileBinary(path: string): Promise<ArrayBuffer>;
	writeFile(path: string, content: string): Promise<void>;
	writeFileBinary(path: string, data: ArrayBuffer): Promise<void>;
	deleteFile(path: string): Promise<void>;
	listFiles(): Promise<LocalFileInfo[]>;
}

export interface SyncResult {
	pull: PullResult;
	push: PushResult | null;
	conflicts: ConflictInfo[];
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
}

export class SyncEngine {
	private readonly pullEngine: PullEngine;
	private readonly pushEngine: PushEngine;
	private readonly state: SyncStateManager;
	private readonly vault: SyncVault;
	private readonly logger: Logger;
	private readonly commitOptions: Omit<PushCommitOptions, "message">;
	private readonly conflictStrategy: ConflictStrategy;
	private syncPromise: Promise<SyncResult> | null = null;

	constructor(options: SyncEngineOptions) {
		this.pullEngine = options.pullEngine;
		this.pushEngine = options.pushEngine;
		this.state = options.state;
		this.vault = options.vault;
		this.logger = options.logger;
		this.commitOptions = options.commitOptions;
		this.conflictStrategy = options.conflictStrategy ?? "skip";
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
		const localChanges = computeLocalChanges(localFiles, cache);

		// Get remote changes without applying them
		const remoteChanges = await this.pullEngine.getRemoteChanges(this.commitOptions.branch);

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

		// Determine which sides get the conflicted files based on strategy
		const pullSkipPaths =
			this.conflictStrategy === "remote-wins" ? new Set<string>() : conflictPaths;

		const pull = await this.pullEngine.pull(this.commitOptions.branch, pullSkipPaths);

		// Filter local changes: include conflicts only for local-wins
		const safePushChanges = localChanges.filter((c) => {
			if (!conflictPaths.has(c.path)) return true;
			return this.conflictStrategy === "local-wins";
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

		return { pull, push, conflicts };
	}
}
