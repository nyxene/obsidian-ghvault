import { type App, type Plugin, PluginSettingTab, Setting } from "obsidian";
import type { ConflictStrategy, GHVaultSettings, LogLevel } from "./types";
import { VALID_CONFLICT_STRATEGIES, VALID_LOG_LEVELS } from "./types";
import { isValidExcludePattern, normalizePath } from "./utils/path";

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

interface DescResult {
	desc: string;
	hasError: boolean;
}

function syncFolderDesc(rawValue: string): DescResult {
	if (!rawValue.trim()) {
		return {
			desc: "Folder inside the repo to sync. Leave empty to sync entire repo.",
			hasError: false,
		};
	}
	const validation = validateSyncFolder(rawValue);
	if (validation.hasTraversal) {
		return {
			desc: `⚠ Path must not contain "..". Resolved: ${validation.sanitized || "(empty)"}. ${SYNC_FOLDER_HINT}`,
			hasError: true,
		};
	}
	if (validation.sanitized !== rawValue) {
		return { desc: `Will sync: ${validation.sanitized}/. ${SYNC_FOLDER_HINT}`, hasError: false };
	}
	return { desc: `Will sync: ${validation.sanitized}/`, hasError: false };
}

function debounceDesc(current: number, rawInput?: string): DescResult {
	if (rawInput !== undefined) {
		const num = Number.parseInt(rawInput, 10);
		if (rawInput === "" || Number.isNaN(num)) {
			return { desc: `⚠ Enter 1–300. Active: ${current}s`, hasError: true };
		}
		if (num < 1) {
			return { desc: `⚠ Min 1s. Active: ${current}s`, hasError: true };
		}
		if (num > 300) {
			return { desc: `⚠ Max 300s. Active: ${current}s`, hasError: true };
		}
	}
	return { desc: "Seconds to wait after last change (1–300)", hasError: false };
}

function pullIntervalDesc(current: number, rawInput?: string): DescResult {
	if (rawInput !== undefined) {
		const num = Number.parseInt(rawInput, 10);
		if (rawInput === "" || Number.isNaN(num)) {
			return { desc: `⚠ Enter 30–3600. Active: ${current}s`, hasError: true };
		}
		if (num < 30) {
			return { desc: `⚠ Min 30s. Active: ${current}s`, hasError: true };
		}
		if (num > 3600) {
			return { desc: `⚠ Max 3600s. Active: ${current}s`, hasError: true };
		}
	}
	return {
		desc: "Base interval to check for remote changes (30–3600). Backs off when idle.",
		hasError: false,
	};
}

function applyDescStyle(setting: Setting, result: DescResult): void {
	setting.setDesc(result.desc);
	if (setting.descEl) {
		setting.descEl.style.color = result.hasError ? "var(--text-error)" : "";
	}
}

function excludeDesc(rawValue: string): string {
	return validateExcludePatterns(rawValue).desc;
}

function validateExcludePatterns(rawValue: string): {
	desc: string;
	cleanValue: string;
	hasErrors: boolean;
} {
	if (!rawValue.trim()) {
		return {
			desc: "Glob patterns to exclude from sync, one per line. Formats: dir/**, *.ext, **/name, exact/path",
			cleanValue: "",
			hasErrors: false,
		};
	}
	const allLines = rawValue.split("\n");
	const valid: string[] = [];
	const invalid: string[] = [];
	for (const raw of allLines) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) {
			valid.push(raw);
			continue;
		}
		if (isValidExcludePattern(line)) {
			valid.push(raw);
		} else {
			invalid.push(line);
		}
	}
	if (invalid.length > 0) {
		return {
			desc: `⚠ Invalid pattern${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}. Use: dir/**, *.ext, **/name, or exact/path`,
			cleanValue: valid.join("\n"),
			hasErrors: true,
		};
	}
	const activeCount = valid.map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).length;
	return {
		desc: `${activeCount} custom pattern${activeCount === 1 ? "" : "s"} active`,
		cleanValue: rawValue,
		hasErrors: false,
	};
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
			.setDesc(
				"Fine-grained PAT. Repository permissions: Contents (Read/Write), Metadata (Read). Account permissions: Gists (Read/Write) — optional, for Share as Gist.",
			)
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
			"Token is stored unencrypted in your vault's plugin data (data.json). " +
				"Do not sync your vault folder via cloud storage (Dropbox, iCloud, Google Drive) " +
				"if security is a concern. Use a fine-grained PAT with contents:write scope only on the target repo.",
		);

		if (this.settings.githubToken) {
			new Setting(containerEl)
				.setName("Forget token")
				.setDesc("Clear the stored token from plugin data")
				.addButton((button) => {
					button
						.setButtonText("Forget")
						.setWarning()
						.onClick(async () => {
							this.settings.githubToken = "";
							await this.callbacks.onSave(this.settings);
							this.display();
						});
				});
		}

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

		const syncFolderSetting = new Setting(containerEl).setName("Sync folder").addText((text) =>
			text
				.setPlaceholder("docs/vault")
				.setValue(this.settings.syncFolder)
				.onChange(async (value) => {
					const validation = validateSyncFolder(value);
					this.settings.syncFolder = validation.sanitized;
					applyDescStyle(syncFolderSetting, syncFolderDesc(value));
					await this.callbacks.onSave(this.settings);
				}),
		);
		applyDescStyle(syncFolderSetting, syncFolderDesc(this.settings.syncFolder));

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
			.setName("Auto-sync")
			.setDesc("Automatically sync when files change in the vault")
			.addToggle((toggle) =>
				toggle.setValue(this.settings.autoSync).onChange(async (value) => {
					this.settings.autoSync = value;
					await this.callbacks.onSave(this.settings);
				}),
			);

		const debounceSetting = new Setting(containerEl)
			.setName("Auto-sync debounce")
			.addText((text) => {
				text
					.setPlaceholder("10")
					.setValue(String(this.settings.autoSyncDebounce))
					.onChange(async (value) => {
						const num = Number.parseInt(value, 10);
						if (Number.isNaN(num) || num < 1 || num > 300) {
							applyDescStyle(debounceSetting, debounceDesc(this.settings.autoSyncDebounce, value));
							return;
						}
						this.settings.autoSyncDebounce = num;
						applyDescStyle(debounceSetting, debounceDesc(num));
						await this.callbacks.onSave(this.settings);
					});
				text.inputEl.addEventListener("blur", () => {
					text.setValue(String(this.settings.autoSyncDebounce));
					applyDescStyle(debounceSetting, debounceDesc(this.settings.autoSyncDebounce));
				});
			});
		applyDescStyle(debounceSetting, debounceDesc(this.settings.autoSyncDebounce));

		const pullIntervalSetting = new Setting(containerEl)
			.setName("Remote pull interval")
			.addText((text) => {
				text
					.setPlaceholder("300")
					.setValue(String(this.settings.autoSyncPullInterval))
					.onChange(async (value) => {
						const num = Number.parseInt(value, 10);
						if (Number.isNaN(num) || num < 30 || num > 3600) {
							applyDescStyle(
								pullIntervalSetting,
								pullIntervalDesc(this.settings.autoSyncPullInterval, value),
							);
							return;
						}
						this.settings.autoSyncPullInterval = num;
						applyDescStyle(pullIntervalSetting, pullIntervalDesc(num));
						await this.callbacks.onSave(this.settings);
					});
				text.inputEl.addEventListener("blur", () => {
					text.setValue(String(this.settings.autoSyncPullInterval));
					applyDescStyle(pullIntervalSetting, pullIntervalDesc(this.settings.autoSyncPullInterval));
				});
			});
		applyDescStyle(pullIntervalSetting, pullIntervalDesc(this.settings.autoSyncPullInterval));

		new Setting(containerEl)
			.setName("Conflict strategy")
			.setDesc("How to handle files changed on both sides")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						skip: "Skip",
						"local-wins": "Local wins",
						"remote-wins": "Remote wins",
						ask: "Ask",
					})
					.setValue(this.settings.conflictStrategy)
					.onChange(async (value) => {
						if (VALID_CONFLICT_STRATEGIES.includes(value as ConflictStrategy)) {
							this.settings.conflictStrategy = value as ConflictStrategy;
							await this.callbacks.onSave(this.settings);
						}
					}),
			);

		const excludeSetting = new Setting(containerEl)
			.setName("Exclude patterns")
			.setDesc(excludeDesc(this.settings.excludePatterns))
			.addTextArea((text) =>
				text
					.setPlaceholder("drafts/**\n*.tmp\nprivate/**")
					.setValue(this.settings.excludePatterns)
					.onChange(async (value) => {
						const validation = validateExcludePatterns(value);
						excludeSetting.setDesc(validation.desc);
						const descEl = excludeSetting.descEl;
						if (descEl) {
							descEl.style.color = validation.hasErrors ? "var(--text-error)" : "";
						}
						this.settings.excludePatterns = validation.cleanValue;
						await this.callbacks.onSave(this.settings);
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
						if (VALID_LOG_LEVELS.includes(value as LogLevel)) {
							this.settings.logLevel = value as LogLevel;
							await this.callbacks.onSave(this.settings);
						}
					}),
			);
	}
}
