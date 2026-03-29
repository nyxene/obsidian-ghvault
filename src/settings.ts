import {
	type App,
	Notice,
	type Plugin,
	PluginSettingTab,
	type Setting,
	SettingGroup,
} from "obsidian";
import type { ConflictStrategy, GHVaultSettings, LogLevel, PagesGenerator } from "./types";
import { VALID_CONFLICT_STRATEGIES, VALID_LOG_LEVELS, VALID_PAGES_GENERATORS } from "./types";
import { isValidExcludePattern, normalizePath } from "./utils/path";

const GUIDE_BASE = "https://github.com/nyxene/obsidian-ghvault/blob/main/docs/guide";

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
	onGenerateWorkflow: () => Promise<void>;
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

		// ── Connection ──────────────────────────────────────────────────
		const connectionGroup = new SettingGroup(containerEl);
		connectionGroup.setHeading("Connection");

		connectionGroup.addSetting((setting) => {
			setting.setName("GitHub token");
			setting.descEl.createSpan({
				text: "Fine-grained PAT. Required: Contents (R/W). Optional: Workflows, Gists (R/W).",
			});
			setting.descEl.createEl("br");
			setting.descEl.createEl("a", {
				text: "How to create a token",
				href: `${GUIDE_BASE}/getting-started.md#step-1-create-a-github-token`,
			});
			setting.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("ghp_...")
					.setValue(this.settings.githubToken)
					.onChange(async (value) => {
						this.settings.githubToken = value;
						await this.callbacks.onSave(this.settings);
					});
			});
		});

		connectionGroup.addSetting((setting) => {
			setting.settingEl.addClass("ghvault-token-warning");
			setting.setDesc(
				"Token is stored unencrypted in plugin data. Use a fine-grained PAT with minimal scopes.",
			);
			setting.settingEl.style.borderTop = "none";
			setting.settingEl.style.paddingTop = "0";
		});

		if (this.settings.githubToken) {
			connectionGroup.addSetting((setting) => {
				setting.setName("Forget token");
				setting.setDesc("Clear the stored token from plugin data");
				setting.addButton((button) => {
					button
						.setButtonText("Forget")
						.setWarning()
						.onClick(async () => {
							this.settings.githubToken = "";
							await this.callbacks.onSave(this.settings);
							this.display();
						});
				});
			});
		}

		connectionGroup.addSetting((setting) => {
			setting.setName("Repository owner");
			setting.setDesc("GitHub username or organization");
			setting.addText((text) =>
				text
					.setPlaceholder("owner")
					.setValue(this.settings.owner)
					.onChange(async (value) => {
						this.settings.owner = sanitizeSlug(value);
						text.setValue(this.settings.owner);
						await this.callbacks.onSave(this.settings);
					}),
			);
		});

		connectionGroup.addSetting((setting) => {
			setting.setName("Repository name");
			setting.setDesc("Name of the GitHub repository");
			setting.addText((text) =>
				text
					.setPlaceholder("my-vault")
					.setValue(this.settings.repo)
					.onChange(async (value) => {
						this.settings.repo = sanitizeSlug(value);
						text.setValue(this.settings.repo);
						await this.callbacks.onSave(this.settings);
					}),
			);
		});

		connectionGroup.addSetting((setting) => {
			setting.setName("Branch");
			setting.setDesc("Branch to sync with");
			setting.addText((text) =>
				text
					.setPlaceholder("main")
					.setValue(this.settings.branch)
					.onChange(async (value) => {
						this.settings.branch = sanitizeBranch(value);
						text.setValue(this.settings.branch);
						await this.callbacks.onSave(this.settings);
					}),
			);
		});

		connectionGroup.addSetting((setting) => {
			setting.setName("Sync folder");
			applyDescStyle(setting, syncFolderDesc(this.settings.syncFolder));
			setting.addText((text) =>
				text
					.setPlaceholder("docs/vault")
					.setValue(this.settings.syncFolder)
					.onChange(async (value) => {
						const validation = validateSyncFolder(value);
						this.settings.syncFolder = validation.sanitized;
						applyDescStyle(setting, syncFolderDesc(value));
						await this.callbacks.onSave(this.settings);
					}),
			);
		});

		connectionGroup.addSetting((setting) => {
			setting.setName("Test connection");
			setting.setDesc("Verify token and repository access");
			setting.addButton((button) => {
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
						button.setButtonText("Connected \u2713");
					} catch {
						button.setButtonText("Failed \u2717");
					}
					button.setDisabled(false);
					setTimeout(() => button.setButtonText("Test"), 3000);
				});
			});
		});

		// ── Sync ────────────────────────────────────────────────────────
		const syncGroup = new SettingGroup(containerEl);
		syncGroup.setHeading("Sync");

		syncGroup.addSetting((setting) => {
			setting.setName("Auto-sync");
			setting.setDesc("Automatically sync when files change in the vault");
			setting.addToggle((toggle) =>
				toggle.setValue(this.settings.autoSync).onChange(async (value) => {
					this.settings.autoSync = value;
					await this.callbacks.onSave(this.settings);
				}),
			);
		});

		syncGroup.addSetting((setting) => {
			applyDescStyle(setting, debounceDesc(this.settings.autoSyncDebounce));
			setting.setName("Auto-sync debounce");
			setting.addText((text) => {
				text
					.setPlaceholder("10")
					.setValue(String(this.settings.autoSyncDebounce))
					.onChange(async (value) => {
						const num = Number.parseInt(value, 10);
						if (Number.isNaN(num) || num < 1 || num > 300) {
							applyDescStyle(setting, debounceDesc(this.settings.autoSyncDebounce, value));
							return;
						}
						this.settings.autoSyncDebounce = num;
						applyDescStyle(setting, debounceDesc(num));
						await this.callbacks.onSave(this.settings);
					});
				text.inputEl.addEventListener("blur", () => {
					text.setValue(String(this.settings.autoSyncDebounce));
					applyDescStyle(setting, debounceDesc(this.settings.autoSyncDebounce));
				});
			});
		});

		syncGroup.addSetting((setting) => {
			applyDescStyle(setting, pullIntervalDesc(this.settings.autoSyncPullInterval));
			setting.setName("Remote pull interval");
			setting.addText((text) => {
				text
					.setPlaceholder("300")
					.setValue(String(this.settings.autoSyncPullInterval))
					.onChange(async (value) => {
						const num = Number.parseInt(value, 10);
						if (Number.isNaN(num) || num < 30 || num > 3600) {
							applyDescStyle(setting, pullIntervalDesc(this.settings.autoSyncPullInterval, value));
							return;
						}
						this.settings.autoSyncPullInterval = num;
						applyDescStyle(setting, pullIntervalDesc(num));
						await this.callbacks.onSave(this.settings);
					});
				text.inputEl.addEventListener("blur", () => {
					text.setValue(String(this.settings.autoSyncPullInterval));
					applyDescStyle(setting, pullIntervalDesc(this.settings.autoSyncPullInterval));
				});
			});
		});

		syncGroup.addSetting((setting) => {
			setting.setName("Conflict strategy");
			setting.descEl.createSpan({ text: "How to handle files changed on both sides." });
			setting.descEl.createEl("br");
			setting.descEl.createEl("a", {
				text: "Learn more",
				href: `${GUIDE_BASE}/settings.md#conflict-strategy`,
			});
			setting.addDropdown((dropdown) =>
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
		});

		// ── Filtering ───────────────────────────────────────────────────
		const filteringGroup = new SettingGroup(containerEl);
		filteringGroup.setHeading("Filtering");

		filteringGroup.addSetting((setting) => {
			setting.setName("Exclude patterns");
			setting.setDesc(excludeDesc(this.settings.excludePatterns));
			setting.addTextArea((text) =>
				text
					.setPlaceholder("drafts/**\n*.tmp\nprivate/**")
					.setValue(this.settings.excludePatterns)
					.onChange(async (value) => {
						const validation = validateExcludePatterns(value);
						setting.setDesc(validation.desc);
						if (setting.descEl) {
							setting.descEl.style.color = validation.hasErrors ? "var(--text-error)" : "";
						}
						this.settings.excludePatterns = validation.cleanValue;
						await this.callbacks.onSave(this.settings);
					}),
			);
		});

		// ── Publishing ──────────────────────────────────────────────────
		let ssgSetting: Setting | null = null;
		let workflowSetting: Setting | null = null;

		const publishingGroup = new SettingGroup(containerEl);
		publishingGroup.setHeading("Publishing");

		publishingGroup.addSetting((setting) => {
			setting.setName("Publish to GitHub Pages");
			setting.descEl.createSpan({
				text: "Build a website from your vault using a static site generator.",
			});
			setting.descEl.createEl("br");
			setting.descEl.createEl("a", {
				text: "Setup guide",
				href: `${GUIDE_BASE}/publishing.md`,
			});
			setting.descEl.createSpan({ text: "  \u00b7  " });
			setting.descEl.createEl("a", {
				text: "Enable Pages in repo settings",
				href: `https://github.com/${this.settings.owner}/${this.settings.repo}/settings/pages`,
			});
			setting.addToggle((toggle) =>
				toggle.setValue(this.settings.pagesEnabled).onChange(async (value) => {
					this.settings.pagesEnabled = value;
					ssgSetting?.settingEl.toggle(value);
					workflowSetting?.settingEl.toggle(value);
					if (value && !this.settings.dispatchOnPush) {
						this.settings.dispatchOnPush = true;
						if (!this.settings.dispatchEventType) {
							this.settings.dispatchEventType = "vault-synced";
						}
					}
					await this.callbacks.onSave(this.settings);
				}),
			);
		});

		publishingGroup.addSetting((setting) => {
			ssgSetting = setting;
			setting.setName("Static site generator");
			setting.setDesc("Choose which SSG builds your site");
			setting.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						quartz: "Quartz",
						mkdocs: "MkDocs Material",
						starlight: "Astro Starlight",
					})
					.setValue(this.settings.pagesGenerator)
					.onChange(async (value) => {
						if (VALID_PAGES_GENERATORS.includes(value as PagesGenerator)) {
							this.settings.pagesGenerator = value as PagesGenerator;
							await this.callbacks.onSave(this.settings);
							this.display();
						}
					}),
			);
			setting.settingEl.toggle(this.settings.pagesEnabled);
		});

		publishingGroup.addSetting((setting) => {
			workflowSetting = setting;
			setting.setName("Deploy");
			setting.descEl.createSpan({
				text: "First deploy takes 1\u20132 min.",
			});
			if (this.settings.pagesUrl) {
				setting.descEl.createEl("br");
				setting.descEl.createEl("a", {
					text: this.settings.pagesUrl,
					href: this.settings.pagesUrl,
				});
			}
			setting.addButton((button) => {
				button.setButtonText("Deploy").setCta();
				button.onClick(async () => {
					button.setButtonText("Deploying...");
					button.setDisabled(true);
					try {
						await this.callbacks.onGenerateWorkflow();
						button.setButtonText("Done \u2713");
						setTimeout(() => this.display(), 2000);
					} catch (err: unknown) {
						const msg = err instanceof Error ? err.message : String(err);
						new Notice(`GHVault: Deploy failed \u2014 ${msg}`, 10000);
						button.setButtonText("Deploy");
						button.setDisabled(false);
					}
				});
			});
			setting.settingEl.toggle(this.settings.pagesEnabled);
		});

		publishingGroup.addSetting((setting) => {
			setting.setName("Publish interval");
			setting.setDesc("Minutes between deploys (default: 10 min)");
			setting.addText((text) => {
				text
					.setPlaceholder("10")
					.setValue(String(this.settings.publishDebounce / 60))
					.onChange(async (value) => {
						const mins = Number.parseFloat(value);
						if (!Number.isNaN(mins) && mins >= 0 && mins <= 60) {
							this.settings.publishDebounce = Math.round(mins * 60);
							await this.callbacks.onSave(this.settings);
						}
					});
			});
			setting.settingEl.toggle(this.settings.pagesEnabled);
		});

		// ── Integrations ────────────────────────────────────────────────
		let dispatchEventSetting: Setting | null = null;

		const integrationsGroup = new SettingGroup(containerEl);
		integrationsGroup.setHeading("Integrations");

		integrationsGroup.addSetting((setting) => {
			setting.setName("Trigger workflow on push");
			setting.descEl.createSpan({
				text: "Run a GitHub Actions workflow after each push.",
			});
			setting.descEl.createEl("br");
			setting.descEl.createEl("a", {
				text: "Setup guide \u2192",
				href: `${GUIDE_BASE}/workflow-dispatch.md`,
			});
			setting.addToggle((toggle) =>
				toggle.setValue(this.settings.dispatchOnPush).onChange(async (value) => {
					this.settings.dispatchOnPush = value;
					dispatchEventSetting?.settingEl.toggle(value);
					await this.callbacks.onSave(this.settings);
				}),
			);
		});

		integrationsGroup.addSetting((setting) => {
			dispatchEventSetting = setting;
			setting.setName("Event type");
			setting.descEl.createSpan({
				text: "Must match the type in your workflow file.",
			});
			setting.descEl.createEl("br");
			setting.descEl.createSpan({ text: "Example: " });
			setting.descEl.createEl("code", { text: "types: [vault-synced]" });
			setting.addText((text) =>
				text
					.setPlaceholder("vault-synced")
					.setValue(this.settings.dispatchEventType)
					.onChange(async (value) => {
						const sanitized = value.trim().replace(/[^a-zA-Z0-9._-]/g, "");
						this.settings.dispatchEventType = sanitized.slice(0, 100) || "vault-synced";
						await this.callbacks.onSave(this.settings);
					}),
			);
			setting.settingEl.toggle(this.settings.dispatchOnPush);
		});

		// ── Advanced ────────────────────────────────────────────────────
		const advancedGroup = new SettingGroup(containerEl);
		advancedGroup.setHeading("Advanced");

		advancedGroup.addSetting((setting) => {
			setting.setName("Log level");
			setting.setDesc("Minimum level for log messages");
			setting.addDropdown((dropdown) =>
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
		});

		// ── Footer ──────────────────────────────────────────────────────
		const footer = containerEl.createEl("p");
		footer.style.textAlign = "center";
		footer.style.marginTop = "24px";
		footer.style.color = "var(--text-muted)";
		footer.style.fontSize = "var(--font-ui-smaller)";
		footer.createEl("a", {
			text: "Documentation & setup guide",
			href: GUIDE_BASE,
		});
		footer.createSpan({ text: "  \u00b7  " });
		footer.createEl("a", {
			text: "Report an issue",
			href: "https://github.com/nyxene/obsidian-ghvault/issues",
		});
	}
}
