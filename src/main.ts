import { type EventRef, Notice, Plugin, TFile } from "obsidian";
import { GitHubClient } from "./github/client";
import { GitHubGraphQL } from "./github/graphql";
import { RateLimiter } from "./github/rate-limit";
import { GHVaultSettingTab, sanitizeBranch, sanitizeSlug, sanitizeSyncFolder } from "./settings";
import { ChangeQueue } from "./sync/change-queue";
import { SyncEngine } from "./sync/engine";
import { PullEngine } from "./sync/pull";
import { PushEngine } from "./sync/push";
import { SyncStateManager } from "./sync/state";
import { ObsidianVaultAdapter } from "./sync/vault-adapter";
import type { ChangeType, GHVaultSettings, LogLevel } from "./types";
import { DEFAULT_SETTINGS, SECRET_PATTERN, VALID_LOG_LEVELS } from "./types";
import { Logger } from "./utils/logger";

const PENDING_CHANGES_KEY = "pendingChanges";
const VALID_CHANGE_TYPES = new Set<string>(["create", "modify", "delete"]);

export default class GHVaultPlugin extends Plugin {
	private static readonly SYNC_COOLDOWN_MS = 5000;
	private static readonly PULL_CHECK_BACKOFF_MULTIPLIER = 2;
	private static readonly PULL_CHECK_BACKOFF_CAP = 8;

	private settings: GHVaultSettings = { ...DEFAULT_SETTINGS };
	private syncEngine: SyncEngine | null = null;
	private githubClient: GitHubClient | null = null;
	private rateLimiter: RateLimiter | null = null;
	private syncState: SyncStateManager | null = null;
	private statusBarEl: HTMLElement | null = null;
	private logger: Logger | null = null;
	private lastSyncAt = 0;
	private changeQueue: ChangeQueue | null = null;
	private eventRefs: EventRef[] = [];
	private pullCheckTimeout: ReturnType<typeof setTimeout> | null = null;
	private pullCheckCurrentInterval = 0;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.logger = new Logger({ app: this.app, minLevel: this.settings.logLevel });
		await this.logger.init();

		this.addSettingTab(
			new GHVaultSettingTab(this.app, this, this.settings, {
				onSave: async (settings) => {
					const prevSyncFolder = this.settings.syncFolder;
					this.settings = settings;
					await this.saveSettings();
					this.logger?.setLevel(settings.logLevel);
					if (settings.syncFolder !== prevSyncFolder) {
						await this.clearSyncState();
					}
					this.rebuildSyncEngine();
					this.setupAutoSync();
				},
				onTestConnection: () => this.testConnection(),
			}),
		);

		this.addRibbonIcon("refresh-cw", "GHVault: Sync now", () => {
			this.runSync();
		});

		this.addCommand({
			id: "ghvault-sync",
			name: "Sync now",
			callback: () => {
				this.runSync();
			},
		});

		this.statusBarEl = this.addStatusBarItem();
		this.setStatus("idle");

		this.rebuildSyncEngine();
		this.setupAutoSync();
		await this.restorePendingChanges();
	}

	async onunload(): Promise<void> {
		this.teardownAutoSync();
		this.syncEngine = null;
		this.githubClient = null;
		this.rateLimiter = null;
		this.syncState = null;
		this.statusBarEl = null;
		this.logger = null;
	}

	private rebuildSyncEngine(): void {
		const { githubToken, owner, repo, branch, syncFolder } = this.settings;
		if (!githubToken || !owner || !repo) {
			this.syncEngine = null;
			this.githubClient = null;
			this.rateLimiter = null;
			this.syncState = null;
			return;
		}

		const logger = this.logger as Logger;
		const rateLimiter = new RateLimiter();

		const client = new GitHubClient({
			token: githubToken,
			owner,
			repo,
			logger,
			rateLimiter,
		});

		const graphql = new GitHubGraphQL({
			token: githubToken,
			logger,
			rateLimiter,
		});

		const state = new SyncStateManager({
			loadData: () => this.loadData(),
			saveData: (data) => this.saveData(data),
		});

		const vaultAdapter = new ObsidianVaultAdapter(this.app.vault);

		const pullEngine = new PullEngine({
			client,
			state,
			vault: vaultAdapter,
			logger,
			syncFolder,
		});

		const pushEngine = new PushEngine({
			graphql,
			state,
			vault: vaultAdapter,
			logger,
			syncFolder,
		});

		this.syncEngine = new SyncEngine({
			pullEngine,
			pushEngine,
			state,
			vault: vaultAdapter,
			logger,
			commitOptions: { branch, owner, repo },
		});

		this.githubClient = client;
		this.rateLimiter = rateLimiter;
		this.syncState = state;
	}

	private async testConnection(): Promise<void> {
		const { githubToken, owner, repo } = this.settings;
		const logger = this.logger as Logger;
		const rateLimiter = new RateLimiter();

		const client = new GitHubClient({
			token: githubToken,
			owner,
			repo,
			logger,
			rateLimiter,
		});

		try {
			const info = await client.getRepoInfo();
			const visibility = info.private ? "private" : "public";
			new Notice(`GHVault: Connected — ${info.fullName} (${visibility})`);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`GHVault: Connection failed — ${sanitizeErrorForUI(message)}`);
			throw error;
		}
	}

	private async runSync(silent = false): Promise<void> {
		if (!this.syncEngine) {
			if (!silent) new Notice("GHVault: Configure settings first (token, owner, repo)");
			return;
		}

		if (this.syncEngine.isSyncing) {
			if (!silent) new Notice("GHVault: Sync already in progress");
			return;
		}

		const now = Date.now();
		if (now - this.lastSyncAt < GHVaultPlugin.SYNC_COOLDOWN_MS) {
			if (!silent) new Notice("GHVault: Please wait before syncing again");
			return;
		}
		this.lastSyncAt = now;

		this.changeQueue?.pause();
		this.setStatus("syncing...");
		try {
			const result = await this.syncEngine.sync();
			const pullCount =
				result.pull.created.length + result.pull.modified.length + result.pull.deleted.length;
			const pushCount = (result.push?.pushed.length ?? 0) + (result.push?.deleted.length ?? 0);
			const conflictCount = result.conflicts.length;

			if (pullCount === 0 && pushCount === 0 && conflictCount === 0) {
				if (!silent) new Notice("GHVault: Already up to date");
			} else {
				const parts = [`${pullCount} pulled`, `${pushCount} pushed`];
				if (conflictCount > 0) {
					parts.push(`${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`);
				}
				new Notice(`GHVault: Synced — ${parts.join(", ")}`);
			}

			this.setStatus("idle");
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger?.error("Sync failed", { error: message });
			new Notice(`GHVault: Sync failed — ${sanitizeErrorForUI(message)}`);
			this.setStatus("error");
		} finally {
			this.changeQueue?.resume();
		}
	}

	private setupAutoSync(): void {
		this.teardownAutoSync();

		if (!this.settings.autoSync || !this.syncEngine) return;

		this.changeQueue = new ChangeQueue({
			debounceMs: this.settings.autoSyncDebounce * 1000,
			onReady: () => {
				this.runSync(true);
			},
			onPersist: (pending) => {
				this.persistPendingChanges(pending);
			},
		});

		this.eventRefs = [
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile) this.changeQueue?.push(file.path, "create");
			}),
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) this.changeQueue?.push(file.path, "modify");
			}),
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile) this.changeQueue?.push(file.path, "delete");
			}),
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					this.changeQueue?.push(oldPath, "delete");
					this.changeQueue?.push(file.path, "create");
				}
			}),
		];

		this.setupPullCheck();

		this.logger?.info("Auto-sync enabled", {
			debounce: this.settings.autoSyncDebounce,
			pullInterval: this.settings.autoSyncPullInterval,
		});
	}

	private teardownAutoSync(): void {
		this.teardownPullCheck();
		for (const ref of this.eventRefs) {
			this.app.vault.offref(ref);
		}
		this.eventRefs = [];
		this.changeQueue?.destroy();
		this.changeQueue = null;
	}

	private setupPullCheck(): void {
		this.teardownPullCheck();
		const baseMs = this.settings.autoSyncPullInterval * 1000;
		this.pullCheckCurrentInterval = baseMs;
		this.schedulePullCheck();
	}

	private teardownPullCheck(): void {
		if (this.pullCheckTimeout !== null) {
			clearTimeout(this.pullCheckTimeout);
			this.pullCheckTimeout = null;
		}
		this.pullCheckCurrentInterval = 0;
	}

	private schedulePullCheck(): void {
		if (!this.pullCheckCurrentInterval || this.pullCheckCurrentInterval <= 0) return;
		this.pullCheckTimeout = setTimeout(() => {
			this.pullCheckTick();
		}, this.pullCheckCurrentInterval);
	}

	private async pullCheckTick(): Promise<void> {
		this.pullCheckTimeout = null;

		if (!this.syncEngine || !this.githubClient || !this.rateLimiter || !this.syncState) {
			return;
		}

		if (this.syncEngine.isSyncing) {
			this.schedulePullCheck();
			return;
		}

		if (!this.rateLimiter.canMakeRequest("rest")) {
			this.logger?.debug("Pull check skipped: rate limit low");
			this.schedulePullCheck();
			return;
		}

		const baseMs = this.settings.autoSyncPullInterval * 1000;
		const maxMs = baseMs * GHVaultPlugin.PULL_CHECK_BACKOFF_CAP;

		try {
			const ref = await this.githubClient.getRef(this.settings.branch);
			const localHead = this.syncState.getHeadOid();

			if (localHead && ref.sha !== localHead) {
				this.logger?.info("Pull check: remote changed", {
					local: localHead.slice(0, 8),
					remote: ref.sha.slice(0, 8),
				});
				this.pullCheckCurrentInterval = baseMs;
				await this.runSync(true);
			} else {
				this.pullCheckCurrentInterval = Math.min(
					this.pullCheckCurrentInterval * GHVaultPlugin.PULL_CHECK_BACKOFF_MULTIPLIER,
					maxMs,
				);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger?.warn("Pull check failed", { error: message });
			this.pullCheckCurrentInterval = Math.min(
				this.pullCheckCurrentInterval * GHVaultPlugin.PULL_CHECK_BACKOFF_MULTIPLIER,
				maxMs,
			);
		}

		if (this.settings.autoSync && this.syncEngine) {
			this.schedulePullCheck();
		}
	}

	private persistPendingChanges(pending: Record<string, ChangeType>): void {
		this.loadData()
			.then((data) => {
				const store = data || {};
				store[PENDING_CHANGES_KEY] = pending;
				return this.saveData(store);
			})
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				this.logger?.warn("Failed to persist pending changes", { error: message });
			});
	}

	private async restorePendingChanges(): Promise<void> {
		if (!this.changeQueue || !this.settings.autoSync) return;

		const data = await this.loadData();
		const raw = data?.[PENDING_CHANGES_KEY];
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;

		const entries = raw as Record<string, unknown>;
		let restored = 0;
		for (const [path, type] of Object.entries(entries)) {
			if (typeof path !== "string" || !path) continue;
			if (typeof type !== "string" || !VALID_CHANGE_TYPES.has(type)) continue;
			this.changeQueue.push(path, type as ChangeType);
			restored++;
		}

		if (restored > 0) {
			this.logger?.info("Restored pending changes from previous session", { count: restored });
		}
	}

	private setStatus(status: string): void {
		if (this.statusBarEl) {
			this.statusBarEl.setText(`GHVault: ${status}`);
		}
	}

	private async loadSettings(): Promise<void> {
		const data = await this.loadData();
		if (data?.settings) {
			const raw = data.settings as Record<string, unknown>;
			const token = typeof raw.githubToken === "string" ? raw.githubToken : "";
			const owner = typeof raw.owner === "string" ? raw.owner : "";
			const repo = typeof raw.repo === "string" ? raw.repo : "";
			const branch = typeof raw.branch === "string" ? raw.branch : DEFAULT_SETTINGS.branch;
			const folder = typeof raw.syncFolder === "string" ? raw.syncFolder : "";
			const autoSync = typeof raw.autoSync === "boolean" ? raw.autoSync : DEFAULT_SETTINGS.autoSync;
			const autoSyncDebounce =
				typeof raw.autoSyncDebounce === "number" &&
				raw.autoSyncDebounce >= 1 &&
				raw.autoSyncDebounce <= 300
					? raw.autoSyncDebounce
					: DEFAULT_SETTINGS.autoSyncDebounce;
			const autoSyncPullInterval =
				typeof raw.autoSyncPullInterval === "number" &&
				raw.autoSyncPullInterval >= 30 &&
				raw.autoSyncPullInterval <= 3600
					? raw.autoSyncPullInterval
					: DEFAULT_SETTINGS.autoSyncPullInterval;
			this.settings = {
				githubToken: token,
				owner: sanitizeSlug(owner),
				repo: sanitizeSlug(repo),
				branch: sanitizeBranch(branch),
				syncFolder: sanitizeSyncFolder(folder),
				logLevel: VALID_LOG_LEVELS.includes(raw.logLevel as LogLevel)
					? (raw.logLevel as LogLevel)
					: DEFAULT_SETTINGS.logLevel,
				autoSync,
				autoSyncDebounce,
				autoSyncPullInterval,
			};
		}
	}

	private async saveSettings(): Promise<void> {
		const data = (await this.loadData()) || {};
		data.settings = this.settings;
		await this.saveData(data);
	}

	private async clearSyncState(): Promise<void> {
		const state = new SyncStateManager({
			loadData: () => this.loadData(),
			saveData: (data) => this.saveData(data),
		});
		state.clear();
		await state.save();
		this.logger?.info("Sync state cleared (syncFolder changed)");
	}
}

export function sanitizeErrorForUI(message: string): string {
	return message.replace(SECRET_PATTERN, "[REDACTED]");
}
