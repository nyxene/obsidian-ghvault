import { type App, type Plugin, Setting } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	GHVaultSettingTab,
	type SettingTabCallbacks,
	sanitizeBranch,
	sanitizeSlug,
} from "./settings";
import type { GHVaultSettings } from "./types";
import { DEFAULT_SETTINGS } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: access mock-only static members on Setting
const MockSetting = Setting as any;

function makeSettings(overrides?: Partial<GHVaultSettings>): GHVaultSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

function makeCallbacks(overrides?: Partial<SettingTabCallbacks>): SettingTabCallbacks {
	return {
		onSave: vi.fn().mockResolvedValue(undefined),
		onTestConnection: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function createTab(
	settings?: Partial<GHVaultSettings>,
	callbackOverrides?: Partial<SettingTabCallbacks>,
): { tab: GHVaultSettingTab; callbacks: SettingTabCallbacks; settings: GHVaultSettings } {
	const s = makeSettings(settings);
	const cb = makeCallbacks(callbackOverrides);
	const app = {} as App;
	const plugin = { app, manifest: {} } as unknown as Plugin;
	const tab = new GHVaultSettingTab(app, plugin, s, cb);
	return { tab, callbacks: cb, settings: s };
}

// biome-ignore lint/suspicious/noExplicitAny: test helper to access mock internals
type AnyMockSetting = any;

function getSettings(): AnyMockSetting[] {
	return MockSetting.instances;
}

function findSettingByName(name: string): AnyMockSetting | undefined {
	return MockSetting.instances.find((s: AnyMockSetting) => s.getName() === name);
}

// ---------------------------------------------------------------------------
// sanitizeSlug — now tested from the real export
// ---------------------------------------------------------------------------

describe("sanitizeSlug", () => {
	it("passes through valid owner/repo names", () => {
		expect(sanitizeSlug("my-repo")).toBe("my-repo");
		expect(sanitizeSlug("owner.name")).toBe("owner.name");
		expect(sanitizeSlug("repo_v2")).toBe("repo_v2");
		expect(sanitizeSlug("Repo123")).toBe("Repo123");
	});

	it("strips spaces", () => {
		expect(sanitizeSlug("my repo")).toBe("myrepo");
		expect(sanitizeSlug(" leading")).toBe("leading");
		expect(sanitizeSlug("trailing ")).toBe("trailing");
	});

	it("strips special characters", () => {
		expect(sanitizeSlug("repo@name")).toBe("reponame");
		expect(sanitizeSlug("repo#1")).toBe("repo1");
		expect(sanitizeSlug("repo!$%^&*()")).toBe("repo");
	});

	it("strips slashes (unlike sanitizeBranch)", () => {
		expect(sanitizeSlug("owner/repo")).toBe("ownerrepo");
	});

	it("handles empty string", () => {
		expect(sanitizeSlug("")).toBe("");
	});

	it("strips XSS attempts", () => {
		expect(sanitizeSlug('<script>alert("xss")</script>')).toBe("scriptalertxssscript");
		expect(sanitizeSlug('"><img src=x onerror=alert(1)>')).toBe("imgsrcxonerroralert1");
	});

	it("strips unicode characters", () => {
		expect(sanitizeSlug("repo-name")).toBe("repo-name");
	});

	it("preserves dots, hyphens, and underscores", () => {
		expect(sanitizeSlug("my.repo-name_v2")).toBe("my.repo-name_v2");
	});

	it("handles string with only invalid characters", () => {
		expect(sanitizeSlug("@#$%^&")).toBe("");
	});
});

// ---------------------------------------------------------------------------
// sanitizeBranch — now tested from the real export
// ---------------------------------------------------------------------------

describe("sanitizeBranch", () => {
	it("passes through valid branch names", () => {
		expect(sanitizeBranch("main")).toBe("main");
		expect(sanitizeBranch("develop")).toBe("develop");
		expect(sanitizeBranch("feature/my-branch")).toBe("feature/my-branch");
		expect(sanitizeBranch("release/1.0.0")).toBe("release/1.0.0");
	});

	it("allows forward slashes (unlike sanitizeSlug)", () => {
		expect(sanitizeBranch("feat/issue-42")).toBe("feat/issue-42");
		expect(sanitizeBranch("a/b/c")).toBe("a/b/c");
	});

	it("strips spaces", () => {
		expect(sanitizeBranch("my branch")).toBe("mybranch");
		expect(sanitizeBranch(" main ")).toBe("main");
	});

	it("strips invalid git branch characters", () => {
		expect(sanitizeBranch("branch~1")).toBe("branch1");
		expect(sanitizeBranch("branch^2")).toBe("branch2");
		expect(sanitizeBranch("branch:ref")).toBe("branchref");
		expect(sanitizeBranch("branch?glob")).toBe("branchglob");
		expect(sanitizeBranch("branch*star")).toBe("branchstar");
		expect(sanitizeBranch("branch[0]")).toBe("branch0");
		expect(sanitizeBranch("branch\\back")).toBe("branchback");
	});

	it("handles empty string", () => {
		expect(sanitizeBranch("")).toBe("");
	});

	it("strips XSS attempts", () => {
		expect(sanitizeBranch('<script>alert("xss")</script>')).toBe("scriptalertxss/script");
	});

	it("preserves dots, hyphens, underscores, and slashes", () => {
		expect(sanitizeBranch("feat/my_branch-1.0")).toBe("feat/my_branch-1.0");
	});

	it("handles string with only invalid characters", () => {
		expect(sanitizeBranch("~^:?*[\\")).toBe("");
	});

	it("preserves numeric branch names", () => {
		expect(sanitizeBranch("123")).toBe("123");
	});
});

// ---------------------------------------------------------------------------
// GHVaultSettingTab
// ---------------------------------------------------------------------------

describe("GHVaultSettingTab", () => {
	beforeEach(() => {
		MockSetting.clearInstances();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("creates an instance extending PluginSettingTab", () => {
			const { tab } = createTab();
			expect(tab).toBeInstanceOf(GHVaultSettingTab);
		});
	});

	describe("display()", () => {
		it("empties the container before rendering", () => {
			const { tab } = createTab();
			const emptySpy = vi.spyOn(tab.containerEl, "empty");
			tab.display();
			expect(emptySpy).toHaveBeenCalled();
		});

		it("creates six Setting instances", () => {
			const { tab } = createTab();
			tab.display();
			// token, owner, repo, branch, test connection, log level
			expect(getSettings()).toHaveLength(6);
		});

		it("creates settings with expected names", () => {
			const { tab } = createTab();
			tab.display();
			const names = getSettings().map((s: AnyMockSetting) => s.getName());
			expect(names).toContain("GitHub token");
			expect(names).toContain("Repository owner");
			expect(names).toContain("Repository name");
			expect(names).toContain("Branch");
			expect(names).toContain("Test connection");
			expect(names).toContain("Log level");
		});

		it("creates a token warning element", () => {
			const { tab } = createTab();
			tab.display();
			const warning = tab.containerEl.querySelector(".ghvault-token-warning");
			expect(warning).not.toBeNull();
			expect(warning?.textContent).toContain("Token is stored unencrypted");
		});

		it("sets initial values from settings", () => {
			const { tab } = createTab({
				githubToken: "ghp_test123",
				owner: "my-owner",
				repo: "my-repo",
				branch: "develop",
				logLevel: "debug",
			});
			tab.display();

			const tokenSetting = findSettingByName("GitHub token");
			expect(tokenSetting.textComponents[0].getValue()).toBe("ghp_test123");

			const ownerSetting = findSettingByName("Repository owner");
			expect(ownerSetting.textComponents[0].getValue()).toBe("my-owner");

			const repoSetting = findSettingByName("Repository name");
			expect(repoSetting.textComponents[0].getValue()).toBe("my-repo");

			const branchSetting = findSettingByName("Branch");
			expect(branchSetting.textComponents[0].getValue()).toBe("develop");

			const logSetting = findSettingByName("Log level");
			expect(logSetting.dropdownComponents[0].getValue()).toBe("debug");
		});

		it("sets password type on token input", () => {
			const { tab } = createTab();
			tab.display();
			const tokenSetting = findSettingByName("GitHub token");
			expect(tokenSetting.textComponents[0].inputEl.type).toBe("password");
		});
	});

	describe("onChange handlers", () => {
		it("saves token directly (no sanitization)", async () => {
			const { tab, callbacks, settings } = createTab({ githubToken: "" });
			tab.display();
			const tokenSetting = findSettingByName("GitHub token");
			await tokenSetting.textComponents[0].simulateChange("ghp_newtoken");
			expect(settings.githubToken).toBe("ghp_newtoken");
			expect(callbacks.onSave).toHaveBeenCalled();
		});

		it("sanitizes owner via sanitizeSlug on change", async () => {
			const { tab, callbacks, settings } = createTab({ owner: "" });
			tab.display();
			const ownerSetting = findSettingByName("Repository owner");
			await ownerSetting.textComponents[0].simulateChange("my owner@name");
			expect(settings.owner).toBe("myownername");
			expect(callbacks.onSave).toHaveBeenCalled();
		});

		it("sanitizes repo via sanitizeSlug on change", async () => {
			const { tab, callbacks, settings } = createTab({ repo: "" });
			tab.display();
			const repoSetting = findSettingByName("Repository name");
			await repoSetting.textComponents[0].simulateChange("my repo#1");
			expect(settings.repo).toBe("myrepo1");
			expect(callbacks.onSave).toHaveBeenCalled();
		});

		it("sanitizes branch via sanitizeBranch on change", async () => {
			const { tab, callbacks, settings } = createTab({ branch: "" });
			tab.display();
			const branchSetting = findSettingByName("Branch");
			await branchSetting.textComponents[0].simulateChange("feat/my branch~1");
			expect(settings.branch).toBe("feat/mybranch1");
			expect(callbacks.onSave).toHaveBeenCalled();
		});

		it("saves valid logLevel on change", async () => {
			const { tab, callbacks, settings } = createTab({ logLevel: "info" });
			tab.display();
			const logSetting = findSettingByName("Log level");
			await logSetting.dropdownComponents[0].simulateChange("debug");
			expect(settings.logLevel).toBe("debug");
			expect(callbacks.onSave).toHaveBeenCalled();
		});

		it("ignores invalid logLevel values", async () => {
			const { tab, callbacks, settings } = createTab({ logLevel: "info" });
			tab.display();
			const logSetting = findSettingByName("Log level");
			await logSetting.dropdownComponents[0].simulateChange("INVALID");
			expect(settings.logLevel).toBe("info");
			expect(callbacks.onSave).not.toHaveBeenCalled();
		});
	});

	describe("test connection button", () => {
		it("shows error when settings are incomplete", async () => {
			vi.useFakeTimers();
			const { tab } = createTab({ githubToken: "", owner: "", repo: "" });
			tab.display();
			const testSetting = findSettingByName("Test connection");
			const button = testSetting.buttonComponents[0];
			await button.simulateClick();
			expect(button.getButtonText()).toBe("Fill settings first");
			vi.advanceTimersByTime(2000);
			expect(button.getButtonText()).toBe("Test");
			vi.useRealTimers();
		});

		it("calls onTestConnection on success", async () => {
			vi.useFakeTimers();
			const { tab, callbacks } = createTab({
				githubToken: "ghp_token",
				owner: "me",
				repo: "vault",
			});
			tab.display();
			const testSetting = findSettingByName("Test connection");
			const button = testSetting.buttonComponents[0];
			await button.simulateClick();
			expect(callbacks.onTestConnection).toHaveBeenCalled();
			expect(button.getButtonText()).toBe("Connected ✓");
			vi.advanceTimersByTime(3000);
			expect(button.getButtonText()).toBe("Test");
			vi.useRealTimers();
		});

		it("shows failure message when onTestConnection rejects", async () => {
			vi.useFakeTimers();
			const { tab } = createTab(
				{
					githubToken: "ghp_token",
					owner: "me",
					repo: "vault",
				},
				{
					onTestConnection: vi.fn().mockRejectedValue(new Error("Network error")),
				},
			);
			tab.display();
			const testSetting = findSettingByName("Test connection");
			const button = testSetting.buttonComponents[0];
			await button.simulateClick();
			expect(button.getButtonText()).toBe("Failed ✗");
			vi.advanceTimersByTime(3000);
			expect(button.getButtonText()).toBe("Test");
			vi.useRealTimers();
		});
	});
});
