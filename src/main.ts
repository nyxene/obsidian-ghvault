import { type EventRef, Modal, Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { GitHubClient } from "./github/client";
import { GitHubGraphQL } from "./github/graphql";
import { RateLimiter } from "./github/rate-limit";
import { getWorkflowTemplate } from "./publishing/workflow-templates";
import { GHVaultSettingTab, sanitizeBranch, sanitizeSlug, sanitizeSyncFolder } from "./settings";
import { ChangeQueue } from "./sync/change-queue";
import { SyncEngine, type SyncResult } from "./sync/engine";
import { PullEngine } from "./sync/pull";
import { PushEngine } from "./sync/push";
import { SyncStateManager } from "./sync/state";
import { ObsidianVaultAdapter } from "./sync/vault-adapter";
import type {
	BackupRecord,
	ChangeType,
	ConflictContentProvider,
	ConflictDecision,
	ConflictInfo,
	ConflictStrategy,
	GHVaultSettings,
	GistRecord,
	LogLevel,
	PagesGenerator,
} from "./types";
import {
	DEFAULT_SETTINGS,
	SECRET_PATTERN,
	VALID_CONFLICT_STRATEGIES,
	VALID_LOG_LEVELS,
	VALID_PAGES_GENERATORS,
} from "./types";
import { BackupModal, formatSize } from "./ui/backup-modal";
import { ConflictModal } from "./ui/conflict-modal";
import { FileHistoryModal } from "./ui/file-history-modal";
import { GistManagerModal } from "./ui/gist-manager-modal";
import { GistModal } from "./ui/gist-modal";
import { buildSyncStatusData, SYNC_STATUS_VIEW_TYPE, SyncStatusView } from "./ui/sync-status-view";
import { Logger } from "./utils/logger";
import { getEffectiveExcludePatterns, isExcluded, isSafePath, toRepoPath } from "./utils/path";
import { createZipFromEntries, MAX_BACKUP_SIZE, processZipEntries } from "./utils/zip";

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
	private lastDispatchAt = 0;
	private lastSuccessfulSyncAt = 0;
	private statusRefreshInterval: ReturnType<typeof setInterval> | null = null;
	private changeQueue: ChangeQueue | null = null;
	private lastConflicts: ConflictInfo[] = [];
	private gistRegistry: Record<string, GistRecord> = {};
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
				onGenerateWorkflow: () => this.generatePagesWorkflow(),
			}),
		);

		this.addRibbonIcon("refresh-cw", "GHVault: Sync now", () => {
			this.runSync();
		});

		this.addRibbonIcon("share", "GHVault: Share as Gist", () => {
			const file = this.app.workspace.getActiveFile();
			if (!file || file.extension !== "md") {
				new Notice("GHVault: Open a markdown file to share as Gist");
				return;
			}
			if (!this.githubClient) {
				new Notice("GHVault: Configure settings first (token, owner, repo)");
				return;
			}
			this.shareAsGist(file.path);
		});

		this.addRibbonIcon("list", "GHVault: Manage shared gists", () => {
			if (!this.githubClient) {
				new Notice("GHVault: Configure settings first (token, owner, repo)");
				return;
			}
			this.openGistManager();
		});

		this.addRibbonIcon("archive", "GHVault: Backup vault", () => {
			this.backupVault();
		});

		this.addRibbonIcon("history", "GHVault: Manage backups", () => {
			if (!this.githubClient) {
				new Notice("GHVault: Configure settings first (token, owner, repo)");
				return;
			}
			this.openBackupManager();
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

		this.addCommand({
			id: "ghvault-share-gist",
			name: "Share note as Gist",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !this.githubClient || file.extension !== "md") return false;
				if (!checking) {
					this.shareAsGist(file.path);
				}
				return true;
			},
		});

		this.addCommand({
			id: "ghvault-manage-gists",
			name: "Manage shared gists",
			checkCallback: (checking) => {
				if (!this.githubClient) return false;
				if (!checking) {
					this.openGistManager();
				}
				return true;
			},
		});

		this.addCommand({
			id: "ghvault-backup-vault",
			name: "Backup vault",
			callback: () => {
				this.backupVault();
			},
		});

		this.addCommand({
			id: "ghvault-manage-backups",
			name: "Manage backups",
			checkCallback: (checking) => {
				if (!this.githubClient) return false;
				if (!checking) {
					this.openBackupManager();
				}
				return true;
			},
		});

		this.statusBarEl = this.addStatusBarItem();
		this.setStatus("idle");

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile && file.extension === "md" && this.githubClient) {
					menu.addItem((item) => {
						item
							.setTitle("Share as Gist")
							.setIcon("share")
							.onClick(() => {
								this.shareAsGist(file.path);
							});
					});
				}
			}),
		);

		await this.loadGistRegistry();
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

			if (pushCount > 0 && this.settings.dispatchOnPush && this.settings.dispatchEventType) {
				const now = Date.now();
				const debounceMs = this.settings.publishDebounce * 1000;
				if (now - this.lastDispatchAt >= debounceMs) {
					this.lastDispatchAt = now;
					this.fireDispatch(result).catch((err: unknown) => {
						const msg = err instanceof Error ? err.message : String(err);
						this.logger?.warn("Repository dispatch failed", { error: msg });
					});
				} else {
					this.logger?.debug("Publish debounce: skipping dispatch", {
						nextIn: Math.ceil((debounceMs - (now - this.lastDispatchAt)) / 1000),
					});
				}
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

	private async fireDispatch(result: SyncResult): Promise<void> {
		if (!this.githubClient) return;
		await this.githubClient.triggerDispatch(this.settings.dispatchEventType, {
			branch: this.settings.branch,
			pushed: result.push?.pushed ?? [],
			deleted: result.push?.deleted ?? [],
			commitOid: result.push?.oid ?? "",
		});
		this.logger?.info("Repository dispatch triggered", {
			eventType: this.settings.dispatchEventType,
		});
	}

	private async generatePagesWorkflow(): Promise<void> {
		if (!this.githubClient) throw new Error("Not connected");
		const template = getWorkflowTemplate(
			this.settings.pagesGenerator,
			this.settings.branch,
			this.settings.syncFolder,
			this.settings.excludePatterns,
		);
		await this.githubClient.createOrUpdateFile(
			".github/workflows/deploy.yml",
			template,
			`ci: add ${this.settings.pagesGenerator} deploy workflow`,
			this.settings.branch,
		);

		// Check if Pages is already enabled and cache site URL
		try {
			const pages = await this.githubClient.getPagesConfig();
			if (pages) {
				this.settings.pagesUrl = pages.htmlUrl;
				await this.saveSettings();
			}
		} catch {
			// Pages check is best-effort, don't fail workflow generation
		}

		// Trigger the workflow immediately so it runs on first deploy
		if (this.settings.dispatchOnPush && this.settings.dispatchEventType) {
			await this.githubClient.triggerDispatch(this.settings.dispatchEventType, {
				branch: this.settings.branch,
				pushed: [".github/workflows/deploy.yml"],
				deleted: [],
				commitOid: "",
			});
		}

		new Notice("GHVault: Workflow created \u2713");
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

	private async shareAsGist(vaultPath: string): Promise<void> {
		if (!this.githubClient) {
			new Notice("GHVault: Configure settings first");
			return;
		}

		const file = this.app.vault.getFileByPath(vaultPath);
		if (!file) {
			new Notice("GHVault: File not found");
			return;
		}

		if (file.stat.size > 1024 * 1024) {
			new Notice("GHVault: File too large for Gist (max 1MB)");
			return;
		}

		const content = await this.app.vault.read(file);
		const fileName = vaultPath.split("/").pop() ?? vaultPath;
		const existingGist = this.gistRegistry[vaultPath];

		const modal = new GistModal(
			this.app,
			vaultPath,
			fileName,
			content,
			this.githubClient,
			existingGist,
		);
		modal.open();

		const result = await modal.waitForResult();
		if (result) {
			this.gistRegistry[vaultPath] = result.record;
			await this.saveGistRegistry();
		}
	}

	private openGistManager(): void {
		if (!this.githubClient) {
			new Notice("GHVault: Configure settings first");
			return;
		}

		const modal = new GistManagerModal(
			this.app,
			this.githubClient,
			this.gistRegistry,
			async (registry) => {
				this.gistRegistry = registry;
				await this.saveGistRegistry();
			},
			async (path) => {
				const file = this.app.vault.getFileByPath(path);
				if (!file) throw new Error(`File not found: ${path}`);
				return this.app.vault.read(file);
			},
		);
		modal.open();
	}

	private async backupVault(): Promise<void> {
		if (!this.githubClient) {
			new Notice("GHVault: Configure settings first (token, owner, repo)");
			return;
		}

		try {
			const excludePatterns = getEffectiveExcludePatterns(this.settings.excludePatterns);
			const allFiles = this.app.vault.getFiles().filter((f) => {
				if (isExcluded(f.path, excludePatterns)) return false;
				if (this.isSyncExcludedByFrontmatter(f.path)) return false;
				return true;
			});

			// Check total size
			let totalSize = 0;
			for (const file of allFiles) {
				totalSize += file.stat.size;
			}
			if (totalSize > MAX_BACKUP_SIZE) {
				new Notice(
					`GHVault: Vault too large for backup (${Math.round(totalSize / 1024 / 1024)}MB, max 500MB)`,
				);
				return;
			}

			// Confirmation
			const confirmed = await this.confirmBackup(allFiles.length, totalSize);
			if (!confirmed) return;

			new Notice("GHVault: Creating backup...");

			// Read all files as binary
			const entries: Record<string, Uint8Array> = {};
			for (const file of allFiles) {
				const buffer = await this.app.vault.readBinary(file);
				entries[file.path] = new Uint8Array(buffer);
			}

			// Create ZIP
			const zipBuffer = createZipFromEntries(entries);

			// Create release with timestamp tag
			const now = new Date();
			const pad = (n: number): string => String(n).padStart(2, "0");
			const tagName = `backup-${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

			const release = await this.githubClient.createRelease({
				tagName,
				name: `Vault Backup ${tagName}`,
				body: `Vault backup created at ${now.toISOString()}\n\nFiles: ${allFiles.length}\nSize: ${Math.round(totalSize / 1024 / 1024)}MB`,
			});

			// Upload ZIP as asset
			await this.githubClient.uploadReleaseAsset(release.uploadUrl, "vault-backup.zip", zipBuffer);

			// Copy URL to clipboard
			try {
				await navigator.clipboard.writeText(release.htmlUrl);
				new Notice(`GHVault: Backup created (${allFiles.length} files) — URL copied to clipboard`);
			} catch {
				new Notice(`GHVault: Backup created (${allFiles.length} files) — ${release.htmlUrl}`);
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger?.error("Backup failed", { error: message });
			new Notice(`GHVault: Backup failed — ${message}`);
		}
	}

	private async restoreFromBackup(backup: BackupRecord): Promise<void> {
		if (!this.githubClient) {
			new Notice("GHVault: Configure settings first");
			return;
		}

		new Notice("GHVault: Downloading backup...");
		const zipBuffer = await this.githubClient.downloadReleaseAsset(backup.assetDownloadUrl);

		let restored = 0;
		await processZipEntries(zipBuffer, async (path, data) => {
			if (!isSafePath(path)) return;
			const existing = this.app.vault.getFileByPath(path);
			if (existing) {
				await this.app.vault.modifyBinary(existing, data.buffer as ArrayBuffer);
			} else {
				// Ensure parent directories exist
				const parentPath = path.substring(0, path.lastIndexOf("/"));
				if (parentPath) {
					const parentExists = this.app.vault.getFolderByPath(parentPath);
					if (!parentExists) {
						await this.app.vault.createFolder(parentPath);
					}
				}
				await this.app.vault.createBinary(path, data.buffer as ArrayBuffer);
			}
			restored++;
		});

		new Notice(`GHVault: Restored ${restored} files from backup`);
	}

	private openBackupManager(): void {
		if (!this.githubClient) {
			new Notice("GHVault: Configure settings first");
			return;
		}

		const modal = new BackupModal(
			this.app,
			this.githubClient,
			async (backup) => {
				await this.restoreFromBackup(backup);
			},
			async (backup) => {
				await this.githubClient?.deleteRelease(backup.id);
			},
		);
		modal.open();
	}

	private async loadGistRegistry(): Promise<void> {
		const data = await this.loadData();
		const raw = data?.gistRegistry;
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			this.gistRegistry = raw as Record<string, GistRecord>;
		}
	}

	private async saveGistRegistry(): Promise<void> {
		const data = (await this.loadData()) || {};
		data.gistRegistry = this.gistRegistry;
		await this.saveData(data);
	}

	private confirmBackup(fileCount: number, totalBytes: number): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			const modal = new Modal(this.app);
			modal.contentEl.createEl("h2", { text: "Create Backup" });
			modal.contentEl.createEl("p", {
				text: `${fileCount} files (${formatSize(totalBytes)}) will be archived and uploaded to GitHub.`,
			});

			const btnRow = modal.contentEl.createEl("div");
			Object.assign(btnRow.style, {
				display: "flex",
				gap: "8px",
				justifyContent: "flex-end",
				marginTop: "16px",
			});

			const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
			cancelBtn.addEventListener("click", () => {
				resolve(false);
				modal.close();
			});

			const confirmBtn = btnRow.createEl("button", { text: "Backup", cls: "mod-cta" });
			confirmBtn.addEventListener("click", () => {
				resolve(true);
				modal.close();
			});

			modal.onClose = () => {
				resolve(false);
			};

			modal.open();
		});
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
				dispatchOnPush:
					typeof raw.dispatchOnPush === "boolean"
						? raw.dispatchOnPush
						: DEFAULT_SETTINGS.dispatchOnPush,
				dispatchEventType:
					typeof raw.dispatchEventType === "string" && raw.dispatchEventType.trim()
						? raw.dispatchEventType.trim()
						: DEFAULT_SETTINGS.dispatchEventType,
				pagesEnabled:
					typeof raw.pagesEnabled === "boolean" ? raw.pagesEnabled : DEFAULT_SETTINGS.pagesEnabled,
				pagesGenerator:
					typeof raw.pagesGenerator === "string" &&
					VALID_PAGES_GENERATORS.includes(raw.pagesGenerator as PagesGenerator)
						? (raw.pagesGenerator as PagesGenerator)
						: DEFAULT_SETTINGS.pagesGenerator,
				pagesUrl: typeof raw.pagesUrl === "string" ? raw.pagesUrl : DEFAULT_SETTINGS.pagesUrl,
				publishDebounce:
					typeof raw.publishDebounce === "number" &&
					raw.publishDebounce >= 0 &&
					raw.publishDebounce <= 3600
						? raw.publishDebounce
						: DEFAULT_SETTINGS.publishDebounce,
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
