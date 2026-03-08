import type { Logger } from "../utils/logger";
import type { LocalFileInfo } from "./comparator";
import { computeLocalChanges } from "./comparator";
import type { PullEngine, PullResult } from "./pull";
import type { PushCommitOptions, PushEngine, PushResult } from "./push";
import type { SyncStateManager } from "./state";

export interface SyncVault {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
	deleteFile(path: string): Promise<void>;
	listFiles(): Promise<LocalFileInfo[]>;
}

export interface SyncResult {
	pull: PullResult;
	push: PushResult | null;
	error?: string;
}

export interface SyncEngineOptions {
	pullEngine: PullEngine;
	pushEngine: PushEngine;
	state: SyncStateManager;
	vault: SyncVault;
	logger: Logger;
	commitOptions: Omit<PushCommitOptions, "message">;
}

export class SyncEngine {
	private readonly pullEngine: PullEngine;
	private readonly pushEngine: PushEngine;
	private readonly state: SyncStateManager;
	private readonly vault: SyncVault;
	private readonly logger: Logger;
	private readonly commitOptions: Omit<PushCommitOptions, "message">;
	private syncing = false;

	constructor(options: SyncEngineOptions) {
		this.pullEngine = options.pullEngine;
		this.pushEngine = options.pushEngine;
		this.state = options.state;
		this.vault = options.vault;
		this.logger = options.logger;
		this.commitOptions = options.commitOptions;
	}

	get isSyncing(): boolean {
		return this.syncing;
	}

	async sync(): Promise<SyncResult> {
		if (this.syncing) {
			throw new Error("Sync already in progress");
		}

		this.syncing = true;
		try {
			return await this.executeSyncCycle();
		} finally {
			this.syncing = false;
		}
	}

	private async executeSyncCycle(): Promise<SyncResult> {
		this.logger.info("Sync started");

		await this.state.load();

		const pull = await this.pullEngine.pull(this.commitOptions.branch);

		const localFiles = await this.vault.listFiles();
		const cache = this.state.getAllSHAs();
		const localChanges = computeLocalChanges(localFiles, cache);

		let push: PushResult | null = null;

		if (localChanges.length > 0) {
			this.logger.info("Local changes detected", { count: localChanges.length });
			push = await this.pushEngine.push(localChanges, {
				...this.commitOptions,
				message: `vault sync: ${localChanges.length} file(s)`,
			});
		} else {
			this.logger.info("No local changes to push");
		}

		this.logger.info("Sync complete", {
			pullCreated: pull.created.length,
			pullModified: pull.modified.length,
			pullDeleted: pull.deleted.length,
			pushed: push?.pushed.length ?? 0,
			pushDeleted: push?.deleted.length ?? 0,
		});

		return { pull, push };
	}
}
