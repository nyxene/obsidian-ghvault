import { Notice, Plugin } from "obsidian";
import { GitHubClient } from "./github/client";
import { GitHubGraphQL } from "./github/graphql";
import { RateLimiter } from "./github/rate-limit";
import { GHVaultSettingTab } from "./settings";
import { SyncEngine } from "./sync/engine";
import { PullEngine } from "./sync/pull";
import { PushEngine } from "./sync/push";
import { SyncStateManager } from "./sync/state";
import { ObsidianVaultAdapter } from "./sync/vault-adapter";
import type { GHVaultSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { Logger } from "./utils/logger";

export default class GHVaultPlugin extends Plugin {
	private settings: GHVaultSettings = { ...DEFAULT_SETTINGS };
	private syncEngine: SyncEngine | null = null;
	private statusBarEl: HTMLElement | null = null;
	private logger: Logger | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.logger = new Logger({ app: this.app, minLevel: this.settings.logLevel });

		this.addSettingTab(
			new GHVaultSettingTab(this.app, this, this.settings, async (settings) => {
				this.settings = settings;
				await this.saveSettings();
				this.logger?.setLevel(settings.logLevel);
				this.rebuildSyncEngine();
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
	}

	async onunload(): Promise<void> {
		this.syncEngine = null;
		this.statusBarEl = null;
		this.logger = null;
	}

	private rebuildSyncEngine(): void {
		const { githubToken, owner, repo, branch } = this.settings;
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
		});

		const pushEngine = new PushEngine({
			graphql,
			state,
			vault: vaultAdapter,
			logger,
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

	private async runSync(): Promise<void> {
		if (!this.syncEngine) {
			new Notice("GHVault: Configure settings first (token, owner, repo)");
			return;
		}

		if (this.syncEngine.isSyncing) {
			new Notice("GHVault: Sync already in progress");
			return;
		}

		this.setStatus("syncing...");
		try {
			const result = await this.syncEngine.sync();
			const pullCount =
				result.pull.created.length + result.pull.modified.length + result.pull.deleted.length;
			const pushCount = (result.push?.pushed.length ?? 0) + (result.push?.deleted.length ?? 0);

			if (pullCount === 0 && pushCount === 0) {
				new Notice("GHVault: Already up to date");
			} else {
				new Notice(`GHVault: Synced — ${pullCount} pulled, ${pushCount} pushed`);
			}

			this.setStatus("idle");
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.logger?.error("Sync failed", { error: message });
			new Notice(`GHVault: Sync failed — ${message}`);
			this.setStatus("error");
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
			this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
		}
	}

	private async saveSettings(): Promise<void> {
		const data = (await this.loadData()) || {};
		data.settings = this.settings;
		await this.saveData(data);
	}
}
