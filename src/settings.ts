import { type App, type Plugin, PluginSettingTab, Setting } from "obsidian";
import type { GHVaultSettings, LogLevel } from "./types";

function sanitizeSlug(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

function sanitizeBranch(value: string): string {
	return value.replace(/[^a-zA-Z0-9._/-]/g, "");
}

export class GHVaultSettingTab extends PluginSettingTab {
	private settings: GHVaultSettings;
	private readonly onSave: (settings: GHVaultSettings) => Promise<void>;

	constructor(
		app: App,
		plugin: Plugin,
		settings: GHVaultSettings,
		onSave: (settings: GHVaultSettings) => Promise<void>,
	) {
		super(app, plugin);
		this.settings = settings;
		this.onSave = onSave;
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
						await this.onSave(this.settings);
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
						await this.onSave(this.settings);
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
						await this.onSave(this.settings);
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
						await this.onSave(this.settings);
					}),
			);

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
						this.settings.logLevel = value as LogLevel;
						await this.onSave(this.settings);
					}),
			);
	}
}
