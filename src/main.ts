import { type EventRef, Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
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
import type {
	ChangeType,
	ConflictContentProvider,
	ConflictDecision,
	ConflictInfo,
	ConflictStrategy,
	GHVaultSettings,
	LogLevel,
} from "./types";
import {
	DEFAULT_SETTINGS,
	SECRET_PATTERN,
	VALID_CONFLICT_STRATEGIES,
	VALID_LOG_LEVELS,
} from "./types";
import { ConflictModal } from "./ui/conflict-modal";
import { FileHistoryModal } from "./ui/file-history-modal";
import { buildSyncStatusData, SYNC_STATUS_VIEW_TYPE, SyncStatusView } from "./ui/sync-status-view";
import { Logger } from "./utils/logger";
import { getEffectiveExcludePatterns, isExcluded, isSafePath, toRepoPath } from "./utils/path";

const PENDING_CHANGES_KEY = "pendingChanges";
const VALID_CHANGE_TYPES = new Set<string>(["create", "modify", "delete"]);

export default class GHVaultPlugin extends Plugin {
	private static readonly SYNC_COOLDOWN_MS = 5000;
	private static readonly PULL_CHECK_BACKOFF_MULTIPLIER = 2;
	private static readonly PULL_CHECK_BACKOFF_CAP = 8;
	private static readonly STATUS_REFRESH_INTERVAL_MS = 30_000;

	private settings: GHVaultSettings = { ...DEFAULT_SETTINGS };
	private syncEngine: SyncEngine | null = null;
	private githubClient: GitHubClient | null = null;
	private rateLimiter: RateLimiter | null = null;
	private syncState: SyncStateManager | null = null;
	private statusBarEl: HTMLElement | null = null;
	private logger: Logger | null = null;
	private lastSyncAt = 0;
	private lastSuccessfulSyncAt = 0;
	private statusRefreshInterval: ReturnType<typeof setInterval> | null = null;
	private changeQueue: ChangeQueue | null = null;
	private lastConflicts: ConflictInfo[] = [];
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

		this.addCommand({
			id: "ghvault-file-history",
			name: "Show file history",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.githubClient) return false;
				if (!checking) {
					this.showFileHistory(file.path);
				}
				return true;
			},
		});

		this.registerView(SYNC_STATUS_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
			const view = new SyncStatusView(leaf);
			view.setCallbacks(
				() => this.runSync(),
				(path) => {
					const file = this.app.vault.getFileByPath(path);
					if (file) {
						this.app.workspace.openLinkText(path, "", false);
					}
				},
			);
			return view;
		});

		this.addCommand({
			id: "ghvault-toggle-sync-status",
			name: "Toggle sync status panel",
			callback: () => {
				this.toggleSyncStatusPanel();
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
		this.clearStatusRefresh();
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

		const excludePatterns = getEffectiveExcludePatterns(this.settings.excludePatterns);
		const vaultAdapter = new ObsidianVaultAdapter(this.app.vault, excludePatterns, (path) =>
			this.isSyncExcludedByFrontmatter(path),
		);

		const pullEngine = new PullEngine({
			client,
			state,
			vault: vaultAdapter,
			logger,
			syncFolder,
			excludePatterns,
		});

		const pushEngine = new PushEngine({
			graphql,
			client,
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
			conflictStrategy: this.settings.conflictStrategy,
			onConflict: (conflicts, contentProvider) =>
				this.showConflictModal(conflicts, contentProvider),
			excludePatterns,
		});

		this.githubClient = client;
		this.rateLimiter = rateLimiter;
		this.syncState = state;
	}

	private async showConflictModal(
		conflicts: ConflictInfo[],
		contentProvider: ConflictContentProvider,
	): Promise<ConflictDecision[]> {
		const modal = new ConflictModal(this.app, conflicts, contentProvider);
		modal.open();
		return modal.waitForDecisions();
	}

	private showFileHistory(vaultPath: string): void {
		if (!this.githubClient) {
			new Notice("GHVault: Configure settings first (token, owner, repo)");
			return;
		}
		const repoPath = toRepoPath(vaultPath, this.settings.syncFolder);
		const modal = new FileHistoryModal(this.app, repoPath, this.settings.branch, this.githubClient);
		modal.open();
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

			const renameCount = result.renames?.length ?? 0;

			if (pullCount === 0 && pushCount === 0 && conflictCount === 0 && renameCount === 0) {
				if (!silent) new Notice("GHVault: Already up to date");
			} else {
				const parts = [`${pullCount} pulled`, `${pushCount} pushed`];
				if (renameCount > 0) {
					parts.push(`${renameCount} renamed`);
				}
				if (conflictCount > 0) {
					const strategy = this.settings.conflictStrategy;
					if (strategy === "skip" || result.resolvedCount === 0) {
						parts.push(`${conflictCount} conflict${conflictCount === 1 ? "" : "s"}`);
					} else if (strategy === "ask") {
						parts.push(`${result.resolvedCount} resolved (per-file)`);
					} else {
						const label = strategy === "local-wins" ? "local wins" : "remote wins";
						parts.push(`${conflictCount} resolved (${label})`);
					}
				}
				new Notice(`GHVault: Synced — ${parts.join(", ")}`);
			}

			this.lastSuccessfulSyncAt = Date.now();
			this.lastConflicts = result.conflicts;
			this.setStatus("idle");
			this.refreshSyncStatusPanel();
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
		this.setStatus("idle");

		if (!this.settings.autoSync || !this.syncEngine) return;

		this.changeQueue = new ChangeQueue({
			debounceMs: this.settings.autoSyncDebounce * 1000,
			onReady: () => {
				this.runSync(true);
			},
			onPersist: (pending) => {
				this.persistPendingChanges(pending);
			},
			excludePatterns: getEffectiveExcludePatterns(this.settings.excludePatterns),
			isSyncExcluded: (path) => this.isSyncExcludedByFrontmatter(path),
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
			if (!isSafePath(path)) continue;
			if (typeof type !== "string" || !VALID_CHANGE_TYPES.has(type)) continue;
			this.changeQueue.push(path, type as ChangeType);
			restored++;
		}

		if (restored > 0) {
			this.logger?.info("Restored pending changes from previous session", { count: restored });
		}
	}

	private setStatus(status: string): void {
		this.clearStatusRefresh();

		if (!this.statusBarEl) return;

		if (status !== "idle") {
			this.statusBarEl.setText(`GHVault: ${status}`);
			return;
		}

		if (this.lastSuccessfulSyncAt === 0) {
			this.statusBarEl.setText("GHVault: idle");
			return;
		}

		if (this.settings.autoSync) {
			this.statusBarEl.setText(`GHVault: ${formatAbsoluteTime(this.lastSuccessfulSyncAt)}`);
		} else {
			this.refreshStatusBar();
			this.statusRefreshInterval = setInterval(() => {
				this.refreshStatusBar();
			}, GHVaultPlugin.STATUS_REFRESH_INTERVAL_MS);
		}
	}

	private refreshStatusBar(): void {
		if (!this.statusBarEl) return;
		this.statusBarEl.setText(
			`GHVault: ${formatRelativeTime(this.lastSuccessfulSyncAt, Date.now())}`,
		);
	}

	private clearStatusRefresh(): void {
		if (this.statusRefreshInterval !== null) {
			clearInterval(this.statusRefreshInterval);
			this.statusRefreshInterval = null;
		}
	}

	private async toggleSyncStatusPanel(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(SYNC_STATUS_VIEW_TYPE);
		if (existing.length > 0) {
			existing[0].detach();
		} else {
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: SYNC_STATUS_VIEW_TYPE, active: true });
				this.app.workspace.revealLeaf(leaf);
				this.refreshSyncStatusPanel();
			}
		}
	}

	private refreshSyncStatusPanel(): void {
		const leaves = this.app.workspace.getLeavesOfType(SYNC_STATUS_VIEW_TYPE);
		if (leaves.length === 0) return;

		const view = leaves[0].view as SyncStatusView;
		if (!this.syncState || !this.syncEngine) {
			view.refresh({
				synced: [],
				pending: [],
				conflicts: [],
				untracked: [],
				lastSyncedAt: 0,
			});
			return;
		}

		const cache = this.syncState.getAllSHAs();
		const vaultFiles = this.app.vault.getFiles().map((f) => f.path);
		const pending = this.changeQueue?.getPending() ?? new Map();
		const excludePatterns = getEffectiveExcludePatterns(this.settings.excludePatterns);
		const excludedPaths = new Set(
			vaultFiles.filter(
				(p) => isExcluded(p, excludePatterns) || this.isSyncExcludedByFrontmatter(p),
			),
		);

		const data = buildSyncStatusData(
			cache,
			vaultFiles,
			pending,
			this.lastConflicts,
			this.lastSuccessfulSyncAt,
			excludedPaths,
		);
		view.refresh(data);
	}

	private isSyncExcludedByFrontmatter(path: string): boolean {
		const cache = this.app.metadataCache.getCache(path);
		return cache?.frontmatter?.["ghvault-sync"] === false;
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
				conflictStrategy: VALID_CONFLICT_STRATEGIES.includes(
					raw.conflictStrategy as ConflictStrategy,
				)
					? (raw.conflictStrategy as ConflictStrategy)
					: DEFAULT_SETTINGS.conflictStrategy,
				excludePatterns:
					typeof raw.excludePatterns === "string"
						? raw.excludePatterns
						: DEFAULT_SETTINGS.excludePatterns,
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

export function formatRelativeTime(timestampMs: number, nowMs: number): string {
	const diffSec = Math.floor((nowMs - timestampMs) / 1000);

	if (diffSec < 60) return "synced just now";

	const diffMin = Math.floor(diffSec / 60);
	if (diffMin < 60) return `synced ${diffMin} min ago`;

	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `synced ${diffHr} hr ago`;

	const diffDay = Math.floor(diffHr / 24);
	return `synced ${diffDay} d ago`;
}

export function formatAbsoluteTime(timestampMs: number): string {
	const date = new Date(timestampMs);
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");
	return `synced ${hours}:${minutes}`;
}
