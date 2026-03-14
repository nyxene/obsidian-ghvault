import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./types";

// ---------------------------------------------------------------------------
// Track Notice instances created during tests
// ---------------------------------------------------------------------------

interface NoticeRecord {
	message: string;
}

const noticeLog: NoticeRecord[] = [];

vi.mock("obsidian", async (importOriginal) => {
	const orig = (await importOriginal()) as Record<string, unknown>;
	return {
		...orig,
		Notice: class Notice {
			message: string;
			constructor(message: string, _duration?: number) {
				this.message = message;
				noticeLog.push({ message });
			}
		},
	};
});

// ---------------------------------------------------------------------------
// Mock all heavy dependencies before importing the module under test
// ---------------------------------------------------------------------------

const mockGetRepoInfo = vi.fn();

vi.mock("./github/client", () => ({
	GitHubClient: class MockGitHubClient {
		getRepoInfo = mockGetRepoInfo;
	},
}));

vi.mock("./github/graphql", () => ({
	GitHubGraphQL: class MockGitHubGraphQL {},
}));

vi.mock("./github/rate-limit", () => ({
	RateLimiter: class MockRateLimiter {},
}));

const mockSync = vi.fn().mockResolvedValue({
	pull: { created: [], modified: [], deleted: [], errors: [] },
	push: null,
});

let mockIsSyncing = false;

vi.mock("./sync/engine", () => ({
	SyncEngine: class MockSyncEngine {
		get isSyncing(): boolean {
			return mockIsSyncing;
		}
		sync = mockSync;
	},
}));

vi.mock("./sync/pull", () => ({
	PullEngine: class MockPullEngine {},
}));

vi.mock("./sync/push", () => ({
	PushEngine: class MockPushEngine {},
}));

const mockStateClear = vi.fn();
const mockStateSave = vi.fn().mockResolvedValue(undefined);

vi.mock("./sync/state", () => ({
	SyncStateManager: class MockSyncStateManager {
		clear = mockStateClear;
		save = mockStateSave;
	},
}));

vi.mock("./sync/vault-adapter", () => ({
	ObsidianVaultAdapter: class MockObsidianVaultAdapter {},
}));

let capturedChangeQueueOnReady: (() => void) | null = null;
const mockChangeQueuePause = vi.fn();
const mockChangeQueueResume = vi.fn();
const mockChangeQueueDestroy = vi.fn();

vi.mock("./sync/change-queue", () => ({
	ChangeQueue: class MockChangeQueue {
		constructor(options: { debounceMs: number; onReady: () => void }) {
			capturedChangeQueueOnReady = options.onReady;
		}
		pause = mockChangeQueuePause;
		resume = mockChangeQueueResume;
		destroy = mockChangeQueueDestroy;
		push = vi.fn();
	},
}));

vi.mock("./utils/logger", () => ({
	Logger: class MockLogger {
		init = vi.fn().mockResolvedValue(undefined);
		debug = vi.fn();
		info = vi.fn();
		warn = vi.fn();
		error = vi.fn();
		setLevel = vi.fn();
	},
}));

interface SettingTabCallbacks {
	onSave?: (settings: Record<string, unknown>) => Promise<void>;
	onTestConnection?: () => Promise<void>;
}

let capturedSettingCallbacks: SettingTabCallbacks = {};

vi.mock("./settings", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		GHVaultSettingTab: class MockSettingTab {
			constructor(
				_app: unknown,
				_plugin: unknown,
				_settings: unknown,
				callbacks?: SettingTabCallbacks,
			) {
				if (callbacks) {
					capturedSettingCallbacks = callbacks;
				}
			}
		},
	};
});

// biome-ignore lint/suspicious/noExplicitAny: test helper for accessing private members
type AnyPlugin = any;

const CONFIGURED_SETTINGS = {
	settings: {
		githubToken: "ghp_token1234567890123456",
		owner: "me",
		repo: "vault",
		branch: "main",
	},
};

function createMockElement(): Record<string, unknown> {
	return { setText: vi.fn(), textContent: "" };
}

function lastNotice(): NoticeRecord {
	return noticeLog[noticeLog.length - 1];
}

async function loadPlugin(loadDataResult: unknown = null): Promise<{
	plugin: AnyPlugin;
	statusBarEl: Record<string, unknown>;
	ribbonCallback: () => void;
	commandCallback: () => void;
	onTestConnection: () => Promise<void>;
	onSave: (settings: Record<string, unknown>) => Promise<void>;
	// biome-ignore lint/suspicious/noExplicitAny: mock Vault with test helpers
	vault: any;
}> {
	const { Vault } = await import("obsidian");
	const mod = await import("./main");
	const PluginClass = mod.default as AnyPlugin;
	const plugin = new PluginClass();

	const vault = new Vault();
	plugin.loadData = vi.fn().mockResolvedValue(loadDataResult);
	plugin.saveData = vi.fn().mockResolvedValue(undefined);
	plugin.app = { vault } as AnyPlugin;

	const statusBarEl = createMockElement();
	let ribbonCallback: () => void = () => {};
	let commandCallback: () => void = () => {};

	plugin.addRibbonIcon = vi
		.fn()
		.mockImplementation((_icon: string, _title: string, cb: () => void) => {
			ribbonCallback = cb;
			return createMockElement();
		});

	plugin.addCommand = vi.fn().mockImplementation((cmd: { callback: () => void }) => {
		commandCallback = cmd.callback;
		return cmd;
	});

	plugin.addStatusBarItem = vi.fn().mockReturnValue(statusBarEl);
	plugin.addSettingTab = vi.fn();

	await plugin.onload();

	const onTestConnection = (): Promise<void> => plugin.testConnection();
	const onSave = capturedSettingCallbacks.onSave as (
		settings: Record<string, unknown>,
	) => Promise<void>;

	return { plugin, statusBarEl, ribbonCallback, commandCallback, onTestConnection, onSave, vault };
}

describe("sanitizeErrorForUI (exported)", () => {
	it("redacts classic personal access tokens (ghp_)", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		const msg = "Auth failed with token ghp_abcdefghij1234567890";
		expect(sanitizeErrorForUI(msg)).toBe("Auth failed with token [REDACTED]");
	});

	it("redacts fine-grained personal access tokens (github_pat_)", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		const msg = "Token github_pat_abc123_XYZXYZXYZXYZXYZXYZXYZ was rejected";
		expect(sanitizeErrorForUI(msg)).toBe("Token [REDACTED] was rejected");
	});

	it("redacts Bearer tokens", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		const msg = "Header: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc";
		expect(sanitizeErrorForUI(msg)).toBe("Header: [REDACTED]");
	});

	it("redacts multiple tokens in the same message", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		const msg = "Tried ghp_aaaabbbbccccddddeeee1234 then ghp_11112222333344445555aaaa";
		const result = sanitizeErrorForUI(msg);
		expect(result).not.toContain("ghp_");
		expect(result).toBe("Tried [REDACTED] then [REDACTED]");
	});

	it("passes through messages without tokens", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		const msg = "Network timeout after 30s";
		expect(sanitizeErrorForUI(msg)).toBe(msg);
	});

	it("handles empty string", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		expect(sanitizeErrorForUI("")).toBe("");
	});

	it("redacts OAuth app tokens (gho_)", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		const msg = "Token gho_abcdefghij1234567890 leaked";
		expect(sanitizeErrorForUI(msg)).toBe("Token [REDACTED] leaked");
	});

	it("redacts user-to-server tokens (ghu_)", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		const msg = "Token ghu_abcdefghij1234567890 leaked";
		expect(sanitizeErrorForUI(msg)).toBe("Token [REDACTED] leaked");
	});

	it("redacts server-to-server tokens (ghs_)", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		const msg = "Token ghs_abcdefghij1234567890 leaked";
		expect(sanitizeErrorForUI(msg)).toBe("Token [REDACTED] leaked");
	});

	it("redacts GitHub App tokens (ghx_)", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		const msg = "Token ghx_abcdefghij1234567890 leaked";
		expect(sanitizeErrorForUI(msg)).toBe("Token [REDACTED] leaked");
	});

	it("does not redact short ghp_ strings below 20 chars", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		const msg = "ghp_short";
		expect(sanitizeErrorForUI(msg)).toBe("ghp_short");
	});
});

// ---------------------------------------------------------------------------
// GHVaultPlugin — tests via dynamic import with all heavy deps mocked
// ---------------------------------------------------------------------------

describe("GHVaultPlugin", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		noticeLog.length = 0;
		mockSync.mockReset().mockResolvedValue({
			pull: { created: [], modified: [], deleted: [], errors: [] },
			push: null,
		});
		mockIsSyncing = false;
		mockGetRepoInfo.mockReset();
		mockStateClear.mockClear();
		mockStateSave.mockClear();
		capturedSettingCallbacks = {};
		capturedChangeQueueOnReady = null;
		mockChangeQueuePause.mockClear();
		mockChangeQueueResume.mockClear();
		mockChangeQueueDestroy.mockClear();
	});

	describe("loadSettings", () => {
		it("uses defaults when loadData returns null", async () => {
			const { plugin } = await loadPlugin(null);
			expect(plugin.settings).toEqual(expect.objectContaining(DEFAULT_SETTINGS));
		});

		it("uses defaults when loadData returns empty object", async () => {
			const { plugin } = await loadPlugin({});
			expect(plugin.settings).toEqual(expect.objectContaining(DEFAULT_SETTINGS));
		});

		it("merges stored settings with defaults", async () => {
			const { plugin } = await loadPlugin({
				settings: { githubToken: "ghp_stored", owner: "me" },
			});
			expect(plugin.settings.githubToken).toBe("ghp_stored");
			expect(plugin.settings.owner).toBe("me");
			expect(plugin.settings.branch).toBe("main"); // from defaults
		});

		it("defaults non-string values to empty string", async () => {
			const { plugin } = await loadPlugin({
				settings: {
					githubToken: 12345,
					owner: true,
					repo: ["array"],
					branch: null,
					syncFolder: { nested: "object" },
				},
			});
			expect(plugin.settings.githubToken).toBe("");
			expect(plugin.settings.owner).toBe("");
			expect(plugin.settings.repo).toBe("");
			expect(plugin.settings.branch).toBe("main"); // falls back to default
			expect(plugin.settings.syncFolder).toBe("");
		});

		it("resets invalid logLevel to default", async () => {
			const { plugin } = await loadPlugin({
				settings: { logLevel: "INVALID_LEVEL" },
			});
			expect(plugin.settings.logLevel).toBe(DEFAULT_SETTINGS.logLevel);
		});

		it("keeps valid logLevel", async () => {
			const { plugin } = await loadPlugin({
				settings: { logLevel: "debug" },
			});
			expect(plugin.settings.logLevel).toBe("debug");
		});
	});

	describe("rebuildSyncEngine", () => {
		it("sets syncEngine to null when token is missing", async () => {
			const { plugin } = await loadPlugin({
				settings: { owner: "me", repo: "vault", githubToken: "" },
			});
			expect(plugin.syncEngine).toBeNull();
		});

		it("sets syncEngine to null when owner is missing", async () => {
			const { plugin } = await loadPlugin({
				settings: { owner: "", repo: "vault", githubToken: "ghp_token1234567890123456" },
			});
			expect(plugin.syncEngine).toBeNull();
		});

		it("sets syncEngine to null when repo is missing", async () => {
			const { plugin } = await loadPlugin({
				settings: { owner: "me", repo: "", githubToken: "ghp_token1234567890123456" },
			});
			expect(plugin.syncEngine).toBeNull();
		});

		it("creates syncEngine when all settings are provided", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			expect(plugin.syncEngine).not.toBeNull();
		});
	});

	describe("command callback", () => {
		it("triggers runSync when command is executed", async () => {
			const { commandCallback } = await loadPlugin(CONFIGURED_SETTINGS);

			commandCallback();
			await vi.waitFor(() => {
				expect(mockSync).toHaveBeenCalledTimes(1);
			});
		});

		it("command is registered with correct id and name", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			const addCommandCall = vi.mocked(plugin.addCommand).mock.calls[0][0];
			expect(addCommandCall.id).toBe("ghvault-sync");
			expect(addCommandCall.name).toBe("Sync now");
		});
	});

	describe("ribbon icon", () => {
		it("triggers runSync when ribbon icon is clicked", async () => {
			const { ribbonCallback } = await loadPlugin(CONFIGURED_SETTINGS);

			ribbonCallback();
			await vi.waitFor(() => {
				expect(mockSync).toHaveBeenCalledTimes(1);
			});
		});

		it("ribbon icon is registered with correct icon and title", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			const call = vi.mocked(plugin.addRibbonIcon).mock.calls[0];
			expect(call[0]).toBe("refresh-cw");
			expect(call[1]).toBe("GHVault: Sync now");
		});
	});

	describe("testConnection", () => {
		it("shows success notice with repo info on success", async () => {
			mockGetRepoInfo.mockResolvedValue({
				fullName: "me/vault",
				private: false,
				defaultBranch: "main",
			});

			const { onTestConnection } = await loadPlugin(CONFIGURED_SETTINGS);
			await onTestConnection();

			expect(lastNotice().message).toBe("GHVault: Connected — me/vault (public)");
		});

		it("shows success notice with private visibility", async () => {
			mockGetRepoInfo.mockResolvedValue({
				fullName: "me/vault",
				private: true,
				defaultBranch: "main",
			});

			const { onTestConnection } = await loadPlugin(CONFIGURED_SETTINGS);
			await onTestConnection();

			expect(lastNotice().message).toBe("GHVault: Connected — me/vault (private)");
		});

		it("shows failure notice and rethrows on error", async () => {
			mockGetRepoInfo.mockRejectedValue(new Error("401 Unauthorized"));

			const { onTestConnection } = await loadPlugin(CONFIGURED_SETTINGS);
			await expect(onTestConnection()).rejects.toThrow("401 Unauthorized");

			expect(lastNotice().message).toBe("GHVault: Connection failed — 401 Unauthorized");
		});

		it("handles non-Error throw with String() fallback", async () => {
			mockGetRepoInfo.mockRejectedValue("string error without Error wrapper");

			const { onTestConnection } = await loadPlugin(CONFIGURED_SETTINGS);
			await expect(onTestConnection()).rejects.toBe("string error without Error wrapper");

			expect(lastNotice().message).toBe(
				"GHVault: Connection failed — string error without Error wrapper",
			);
		});

		it("redacts tokens in failure notice", async () => {
			mockGetRepoInfo.mockRejectedValue(new Error("Auth failed with ghp_abcdefghij1234567890"));

			const { onTestConnection } = await loadPlugin(CONFIGURED_SETTINGS);
			await expect(onTestConnection()).rejects.toThrow();

			expect(lastNotice().message).toBe("GHVault: Connection failed — Auth failed with [REDACTED]");
		});
	});

	describe("status bar transitions", () => {
		it("sets status to idle on load", async () => {
			const { statusBarEl } = await loadPlugin(CONFIGURED_SETTINGS);
			expect(statusBarEl.setText).toHaveBeenCalledWith("GHVault: idle");
		});

		it("transitions idle -> syncing -> idle on successful sync", async () => {
			const { statusBarEl, plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();

			await plugin.runSync();

			const calls = vi
				.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>)
				.mock.calls.map((c: unknown[]) => c[0]);
			expect(calls).toEqual(["GHVault: syncing...", "GHVault: idle"]);
		});

		it("transitions idle -> syncing -> error on failed sync", async () => {
			mockSync.mockRejectedValueOnce(new Error("Network error"));

			const { statusBarEl, plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();

			await plugin.runSync();

			const calls = vi
				.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>)
				.mock.calls.map((c: unknown[]) => c[0]);
			expect(calls).toEqual(["GHVault: syncing...", "GHVault: error"]);
		});

		it("shows 'Already up to date' notice when nothing changed", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			noticeLog.length = 0;
			await plugin.runSync();

			expect(lastNotice().message).toBe("GHVault: Already up to date");
		});

		it("shows counts notice when files were synced", async () => {
			mockSync.mockResolvedValueOnce({
				pull: { created: ["a.md"], modified: ["b.md"], deleted: [], errors: [] },
				push: { pushed: ["c.md"], deleted: [] },
			});

			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			noticeLog.length = 0;
			await plugin.runSync();

			expect(lastNotice().message).toBe("GHVault: Synced — 2 pulled, 1 pushed");
		});
	});

	describe("runSync guards", () => {
		it("returns early when no engine configured", async () => {
			const { plugin } = await loadPlugin(null);
			await plugin.runSync();
			expect(plugin.syncEngine).toBeNull();
		});

		it("returns early when sync is already in progress", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			mockIsSyncing = true;

			await plugin.runSync();
			expect(mockSync).not.toHaveBeenCalled();
		});

		it("blocks when cooldown has not elapsed", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);

			await plugin.runSync();
			expect(mockSync).toHaveBeenCalledTimes(1);

			// Second sync immediately — should be blocked by cooldown
			await plugin.runSync();
			expect(mockSync).toHaveBeenCalledTimes(1);
		});

		it("shows notice when sync failed with error details", async () => {
			mockSync.mockRejectedValueOnce(new Error("API rate limit exceeded"));

			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			noticeLog.length = 0;
			await plugin.runSync();

			expect(lastNotice().message).toBe("GHVault: Sync failed — API rate limit exceeded");
		});
	});

	describe("syncFolder change", () => {
		it("clearSyncState resets state and persists", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			mockStateClear.mockClear();
			mockStateSave.mockClear();

			await plugin.clearSyncState();

			expect(mockStateClear).toHaveBeenCalled();
			expect(mockStateSave).toHaveBeenCalled();
		});

		it("onSave with changed syncFolder triggers clearSyncState", async () => {
			const { onSave } = await loadPlugin(CONFIGURED_SETTINGS);
			mockStateClear.mockClear();
			mockStateSave.mockClear();

			await onSave({
				githubToken: "ghp_token1234567890123456",
				owner: "me",
				repo: "vault",
				branch: "main",
				syncFolder: "docs/notes",
				logLevel: "info",
			});

			expect(mockStateClear).toHaveBeenCalled();
			expect(mockStateSave).toHaveBeenCalled();
		});

		it("onSave with same syncFolder does NOT trigger clearSyncState", async () => {
			const { onSave } = await loadPlugin({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
					syncFolder: "docs",
				},
			});
			mockStateClear.mockClear();
			mockStateSave.mockClear();

			await onSave({
				githubToken: "ghp_token1234567890123456",
				owner: "me",
				repo: "vault",
				branch: "main",
				syncFolder: "docs",
				logLevel: "info",
			});

			expect(mockStateClear).not.toHaveBeenCalled();
		});

		it("onSave rebuilds SyncEngine with new settings", async () => {
			const { plugin, onSave } = await loadPlugin(CONFIGURED_SETTINGS);
			const engineBefore = plugin.syncEngine;
			expect(engineBefore).not.toBeNull();

			await onSave({
				githubToken: "ghp_newtoken12345678901234",
				owner: "newowner",
				repo: "newrepo",
				branch: "main",
				syncFolder: "",
				logLevel: "info",
			});

			// Engine should have been rebuilt (new instance)
			expect(plugin.syncEngine).not.toBeNull();
			expect(plugin.syncEngine).not.toBe(engineBefore);
		});
	});

	describe("auto-sync", () => {
		const AUTO_SYNC_SETTINGS = {
			settings: {
				githubToken: "ghp_token1234567890123456",
				owner: "me",
				repo: "vault",
				branch: "main",
				autoSync: true,
				autoSyncDebounce: 10,
			},
		};

		it("sets up ChangeQueue when autoSync is enabled", async () => {
			await loadPlugin(AUTO_SYNC_SETTINGS);
			expect(capturedChangeQueueOnReady).not.toBeNull();
		});

		it("does not set up ChangeQueue when autoSync is disabled", async () => {
			await loadPlugin(CONFIGURED_SETTINGS);
			expect(capturedChangeQueueOnReady).toBeNull();
		});

		it("registers vault event listeners when autoSync is enabled", async () => {
			const { vault } = await loadPlugin(AUTO_SYNC_SETTINGS);
			// create, modify, delete, rename = 4 listeners
			expect(vault.getListenerCount()).toBe(4);
		});

		it("does not register vault event listeners when autoSync is disabled", async () => {
			const { vault } = await loadPlugin(CONFIGURED_SETTINGS);
			expect(vault.getListenerCount()).toBe(0);
		});

		it("onReady triggers silent sync (no 'up to date' notice)", async () => {
			await loadPlugin(AUTO_SYNC_SETTINGS);
			noticeLog.length = 0;

			capturedChangeQueueOnReady?.();
			await vi.waitFor(() => {
				expect(mockSync).toHaveBeenCalledTimes(1);
			});

			// Silent sync should not show "Already up to date" notice
			const upToDateNotices = noticeLog.filter((n) => n.message.includes("up to date"));
			expect(upToDateNotices).toHaveLength(0);
		});

		it("pauses changeQueue during sync and resumes after", async () => {
			let resolveSyncPromise: (value: unknown) => void = () => {};
			mockSync.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveSyncPromise = resolve;
					}),
			);

			await loadPlugin(AUTO_SYNC_SETTINGS);

			// Trigger sync via onReady
			capturedChangeQueueOnReady?.();
			await vi.waitFor(() => {
				expect(mockChangeQueuePause).toHaveBeenCalledTimes(1);
			});
			expect(mockChangeQueueResume).not.toHaveBeenCalled();

			// Resolve sync
			resolveSyncPromise({
				pull: { created: [], modified: [], deleted: [], errors: [] },
				push: null,
			});

			await vi.waitFor(() => {
				expect(mockChangeQueueResume).toHaveBeenCalledTimes(1);
			});
		});

		it("teardownAutoSync removes event listeners on onunload", async () => {
			const { plugin, vault } = await loadPlugin(AUTO_SYNC_SETTINGS);
			expect(vault.getListenerCount()).toBe(4);

			await plugin.onunload();
			expect(vault.getListenerCount()).toBe(0);
			expect(mockChangeQueueDestroy).toHaveBeenCalled();
		});

		it("onSave with autoSync toggled on sets up auto-sync", async () => {
			const { onSave } = await loadPlugin(CONFIGURED_SETTINGS);
			expect(capturedChangeQueueOnReady).toBeNull();

			await onSave({
				githubToken: "ghp_token1234567890123456",
				owner: "me",
				repo: "vault",
				branch: "main",
				syncFolder: "",
				logLevel: "info",
				autoSync: true,
				autoSyncDebounce: 10,
			});

			expect(capturedChangeQueueOnReady).not.toBeNull();
		});

		it("loadSettings parses autoSync boolean", async () => {
			const { plugin } = await loadPlugin({
				settings: { autoSync: true },
			});
			expect(plugin.settings.autoSync).toBe(true);
		});

		it("loadSettings defaults autoSync to false for non-boolean", async () => {
			const { plugin } = await loadPlugin({
				settings: { autoSync: "yes" },
			});
			expect(plugin.settings.autoSync).toBe(false);
		});

		it("loadSettings parses autoSyncDebounce within range", async () => {
			const { plugin } = await loadPlugin({
				settings: { autoSyncDebounce: 30 },
			});
			expect(plugin.settings.autoSyncDebounce).toBe(30);
		});

		it("loadSettings defaults autoSyncDebounce for out-of-range values", async () => {
			const { plugin } = await loadPlugin({
				settings: { autoSyncDebounce: 500 },
			});
			expect(plugin.settings.autoSyncDebounce).toBe(DEFAULT_SETTINGS.autoSyncDebounce);
		});

		it("loadSettings defaults autoSyncDebounce for non-number", async () => {
			const { plugin } = await loadPlugin({
				settings: { autoSyncDebounce: "fast" },
			});
			expect(plugin.settings.autoSyncDebounce).toBe(DEFAULT_SETTINGS.autoSyncDebounce);
		});
	});

	describe("onunload", () => {
		it("clears all references", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			expect(plugin.syncEngine).not.toBeNull();

			await plugin.onunload();
			expect(plugin.syncEngine).toBeNull();
			expect(plugin.statusBarEl).toBeNull();
			expect(plugin.logger).toBeNull();
		});

		it("does not crash when sync completes after onunload", async () => {
			let resolveSyncPromise: (value: unknown) => void = () => {};
			mockSync.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveSyncPromise = resolve;
					}),
			);

			const { plugin, statusBarEl } = await loadPlugin(CONFIGURED_SETTINGS);

			// Start sync (will hang on the promise)
			const syncPromise = plugin.runSync();

			// Unload plugin while sync is in progress
			await plugin.onunload();
			expect(plugin.syncEngine).toBeNull();
			expect(plugin.statusBarEl).toBeNull();

			// Now resolve the sync — should not crash
			resolveSyncPromise({
				pull: { created: ["a.md"], modified: [], deleted: [], errors: [] },
				push: null,
				conflicts: [],
			});

			// Wait for runSync to complete — no throw expected
			await syncPromise;

			// statusBarEl.setText was called with "syncing..." before unload,
			// but "idle" after resolve should be skipped (statusBarEl is null)
			const calls = vi
				.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>)
				.mock.calls.map((c: unknown[]) => c[0]);
			// Should have "idle" from onload and "syncing..." from runSync,
			// but NOT "idle" after sync completes (statusBarEl is null)
			expect(calls).toContain("GHVault: idle");
			expect(calls).toContain("GHVault: syncing...");
			// The last call should be "syncing..." not "idle" (since statusBarEl was null)
			expect(calls[calls.length - 1]).toBe("GHVault: syncing...");
		});
	});
});
