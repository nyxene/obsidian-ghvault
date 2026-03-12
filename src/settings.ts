import { type App, type Plugin, PluginSettingTab, Setting } from "obsidian";
import type { GHVaultSettings, LogLevel } from "./types";
import { VALID_LOG_LEVELS } from "./types";
import { normalizePath } from "./utils/path";

export function sanitizeSlug(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

export function sanitizeBranch(value: string): string {
	return value.replace(/[^a-zA-Z0-9._/-]/g, "");
}

export function sanitizeSyncFolder(value: string): string {
	const normalized = normalizePath(value);
	// Reject any segment that is ".."
	const segments = normalized.split("/").filter((s) => s !== "" && s !== "..");
	return segments.join("/");
}

export interface SyncFolderValidation {
	sanitized: string;
	hasTraversal: boolean;
}

export function validateSyncFolder(value: string): SyncFolderValidation {
	const normalized = normalizePath(value);
	const segments = normalized.split("/").filter((s) => s !== "");
	const hasTraversal = segments.some((s) => s === "..");
	const clean = segments.filter((s) => s !== "..").join("/");
	return { sanitized: clean, hasTraversal };
}

const SYNC_FOLDER_HINT = "Relative path using forward slashes, e.g. docs/vault";

function syncFolderDesc(rawValue: string): string {
	if (!rawValue.trim()) {
		return "Folder inside the repo to sync. Leave empty to sync entire repo.";
	}
	const validation = validateSyncFolder(rawValue);
	if (validation.hasTraversal) {
		return `⚠ Path must not contain "..". Resolved: ${validation.sanitized || "(empty)"}. ${SYNC_FOLDER_HINT}`;
	}
	if (validation.sanitized !== rawValue) {
		return `Will sync: ${validation.sanitized}/. ${SYNC_FOLDER_HINT}`;
	}
	return `Will sync: ${validation.sanitized}/`;
}

export interface SettingTabCallbacks {
	onSave: (settings: GHVaultSettings) => Promise<void>;
	onTestConnection: () => Promise<void>;
}

export class GHVaultSettingTab extends PluginSettingTab {
	private settings: GHVaultSettings;
	private readonly callbacks: SettingTabCallbacks;

	constructor(app: App, plugin: Plugin, settings: GHVaultSettings, callbacks: SettingTabCallbacks) {
		super(app, plugin);
		this.settings = settings;
		this.callbacks = callbacks;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("ghvault-settings");

		new Setting(containerEl)
			.setName("GitHub token")
			.setDesc("Personal access token with repo scope")
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("ghp_...")
					.setValue(this.settings.githubToken)
					.onChange(async (value) => {
						this.settings.githubToken = value;
						await this.callbacks.onSave(this.settings);
					});
			});

		const warning = containerEl.createEl("div", {
			cls: "ghvault-token-warning",
		});
		warning.style.padding = "8px 12px";
		warning.style.marginTop = "4px";
		warning.style.marginBottom = "16px";
		warning.style.borderRadius = "4px";
		warning.style.backgroundColor = "var(--background-modifier-error-rgb, rgba(255, 0, 0, 0.1))";
		warning.style.border = "1px solid var(--text-error)";
		warning.style.color = "var(--text-error)";
		warning.style.fontSize = "12px";
		warning.style.lineHeight = "1.4";
		warning.setText(
			"Token is stored unencrypted in your vault's plugin data. " +
				"Do not share your vault folder. Use a fine-grained PAT with minimal permissions.",
		);

		new Setting(containerEl)
			.setName("Repository owner")
			.setDesc("GitHub username or organization")
			.addText((text) =>
				text
					.setPlaceholder("owner")
					.setValue(this.settings.owner)
					.onChange(async (value) => {
						this.settings.owner = sanitizeSlug(value);
						text.setValue(this.settings.owner);
						await this.callbacks.onSave(this.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Repository name")
			.setDesc("Name of the GitHub repository")
			.addText((text) =>
				text
					.setPlaceholder("my-vault")
					.setValue(this.settings.repo)
					.onChange(async (value) => {
						this.settings.repo = sanitizeSlug(value);
						text.setValue(this.settings.repo);
						await this.callbacks.onSave(this.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Branch")
			.setDesc("Branch to sync with")
			.addText((text) =>
				text
					.setPlaceholder("main")
					.setValue(this.settings.branch)
					.onChange(async (value) => {
						this.settings.branch = sanitizeBranch(value);
						text.setValue(this.settings.branch);
						await this.callbacks.onSave(this.settings);
					}),
			);

		const syncFolderSetting = new Setting(containerEl)
			.setName("Sync folder")
			.setDesc(syncFolderDesc(this.settings.syncFolder))
			.addText((text) =>
				text
					.setPlaceholder("docs/vault")
					.setValue(this.settings.syncFolder)
					.onChange(async (value) => {
						const validation = validateSyncFolder(value);
						this.settings.syncFolder = validation.sanitized;
						syncFolderSetting.setDesc(syncFolderDesc(value));
						await this.callbacks.onSave(this.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Verify token and repository access")
			.addButton((button) => {
				button.setButtonText("Test").onClick(async () => {
					const { githubToken, owner, repo } = this.settings;
					if (!githubToken || !owner || !repo) {
						button.setButtonText("Fill settings first");
						setTimeout(() => button.setButtonText("Test"), 2000);
						return;
					}
					button.setButtonText("Testing...");
					button.setDisabled(true);
					try {
						await this.callbacks.onTestConnection();
						button.setButtonText("Connected ✓");
					} catch {
						button.setButtonText("Failed ✗");
					}
					button.setDisabled(false);
					setTimeout(() => button.setButtonText("Test"), 3000);
				});
			});

		new Setting(containerEl)
			.setName("Log level")
			.setDesc("Minimum level for log messages")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						debug: "Debug",
						info: "Info",
						warn: "Warning",
						error: "Error",
					})
					.setValue(this.settings.logLevel)
					.onChange(async (value) => {
						if (VALID_LOG_LEVELS.includes(value as LogLevel)) {
							this.settings.logLevel = value as LogLevel;
							await this.callbacks.onSave(this.settings);
						}
					}),
			);
	}
}
