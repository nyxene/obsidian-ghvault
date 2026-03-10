import { type App, type Plugin, PluginSettingTab, Setting } from "obsidian";
import type { GHVaultSettings, LogLevel } from "./types";
import { VALID_LOG_LEVELS } from "./types";

export function sanitizeSlug(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

export function sanitizeBranch(value: string): string {
	return value.replace(/[^a-zA-Z0-9._/-]/g, "");
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
