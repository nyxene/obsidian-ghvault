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
import type { GHVaultSettings, LogLevel } from "./types";
import { DEFAULT_SETTINGS, SECRET_PATTERN, VALID_LOG_LEVELS } from "./types";
import { Logger } from "./utils/logger";

export default class GHVaultPlugin extends Plugin {
	private static readonly SYNC_COOLDOWN_MS = 5000;

	private settings: GHVaultSettings = { ...DEFAULT_SETTINGS };
	private syncEngine: SyncEngine | null = null;
	private statusBarEl: HTMLElement | null = null;
	private logger: Logger | null = null;
	private lastSyncAt = 0;
	private changeQueue: ChangeQueue | null = null;
	private eventRefs: EventRef[] = [];

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
	}

	async onunload(): Promise<void> {
		this.teardownAutoSync();
		this.syncEngine = null;
		this.statusBarEl = null;
		this.logger = null;
	}

	private rebuildSyncEngine(): void {
		const { githubToken, owner, repo, branch, syncFolder } = this.settings;
		if (!githubToken || !owner || !repo) {
			this.syncEngine = null;
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

			if (pullCount === 0 && pushCount === 0) {
				if (!silent) new Notice("GHVault: Already up to date");
			} else {
				new Notice(`GHVault: Synced — ${pullCount} pulled, ${pushCount} pushed`);
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

		this.logger?.info("Auto-sync enabled", { debounce: this.settings.autoSyncDebounce });
	}

	private teardownAutoSync(): void {
		for (const ref of this.eventRefs) {
			this.app.vault.offref(ref);
		}
		this.eventRefs = [];
		this.changeQueue?.destroy();
		this.changeQueue = null;
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
