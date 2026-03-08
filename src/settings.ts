import { type App, type Plugin, PluginSettingTab, Setting } from "obsidian";
import type { GHVaultSettings, LogLevel } from "./types";

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
			.addText((text) =>
				text
					.setPlaceholder("ghp_...")
					.setValue(this.settings.githubToken)
					.onChange(async (value) => {
						this.settings.githubToken = value;
						await this.onSave(this.settings);
					}),
			);

		new Setting(containerEl)
			.setName("Repository owner")
			.setDesc("GitHub username or organization")
			.addText((text) =>
				text
					.setPlaceholder("owner")
					.setValue(this.settings.owner)
					.onChange(async (value) => {
						this.settings.owner = value;
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
						this.settings.repo = value;
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
						this.settings.branch = value;
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
