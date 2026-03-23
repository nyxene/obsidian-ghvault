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
		Modal: class Modal {
			app: unknown;
			contentEl = {
				empty: vi.fn(),
				addClass: vi.fn(),
				createEl: vi.fn().mockReturnValue({
					createEl: vi.fn().mockReturnValue({
						createEl: vi.fn().mockReturnValue({
							createEl: vi.fn(),
							addEventListener: vi.fn(),
						}),
						addEventListener: vi.fn(),
					}),
					addEventListener: vi.fn(),
				}),
			};
			constructor(app: unknown) {
				this.app = app;
			}
			open(): void {}
			close(): void {}
		},
	};
});

// ---------------------------------------------------------------------------
// Mock all heavy dependencies before importing the module under test
// ---------------------------------------------------------------------------

const mockGetRepoInfo = vi.fn();
const mockGetRef = vi.fn();

vi.mock("./github/client", () => ({
	GitHubClient: class MockGitHubClient {
		getRepoInfo = mockGetRepoInfo;
		getRef = mockGetRef;
	},
}));

vi.mock("./github/graphql", () => ({
	GitHubGraphQL: class MockGitHubGraphQL {},
}));

vi.mock("./github/rate-limit", () => ({
	RateLimiter: class MockRateLimiter {
		canMakeRequest = vi.fn().mockReturnValue(true);
	},
}));

const mockSync = vi.fn().mockResolvedValue({
	pull: { created: [], modified: [], deleted: [], errors: [] },
	push: null,
	conflicts: [],
	resolvedCount: 0,
	renames: [],
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
const mockGetHeadOid = vi.fn().mockReturnValue("");
const mockGetAllSHAs = vi.fn().mockReturnValue({});

vi.mock("./sync/state", () => ({
	SyncStateManager: class MockSyncStateManager {
		clear = mockStateClear;
		save = mockStateSave;
		getHeadOid = mockGetHeadOid;
		getAllSHAs = mockGetAllSHAs;
	},
}));

vi.mock("./sync/vault-adapter", () => ({
	ObsidianVaultAdapter: class MockObsidianVaultAdapter {},
}));

const mockWaitForDecisions = vi.fn().mockResolvedValue([]);
const mockModalOpen = vi.fn();

vi.mock("./ui/conflict-modal", () => ({
	ConflictModal: class MockConflictModal {
		open = mockModalOpen;
		waitForDecisions = mockWaitForDecisions;
	},
}));

let capturedChangeQueueOnReady: (() => void) | null = null;
let capturedChangeQueueOnPersist: ((pending: Record<string, string>) => void) | null = null;
const mockChangeQueuePause = vi.fn();
const mockChangeQueueResume = vi.fn();
const mockChangeQueueDestroy = vi.fn();
const mockChangeQueuePush = vi.fn();
const mockChangeQueueGetPending = vi.fn().mockReturnValue(new Map());

vi.mock("./sync/change-queue", () => ({
	ChangeQueue: class MockChangeQueue {
		constructor(options: {
			debounceMs: number;
			onReady: () => void;
			onPersist?: (pending: Record<string, string>) => void;
		}) {
			capturedChangeQueueOnReady = options.onReady;
			capturedChangeQueueOnPersist = options.onPersist ?? null;
		}
		pause = mockChangeQueuePause;
		resume = mockChangeQueueResume;
		destroy = mockChangeQueueDestroy;
		push = mockChangeQueuePush;
		getPending = mockChangeQueueGetPending;
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
	(vault as AnyPlugin).getFiles = vi.fn().mockReturnValue([]);
	(vault as AnyPlugin).getFileByPath = vi.fn().mockReturnValue(null);
	plugin.loadData = vi
		.fn()
		.mockImplementation(() =>
			Promise.resolve(loadDataResult ? JSON.parse(JSON.stringify(loadDataResult)) : null),
		);
	plugin.saveData = vi.fn().mockResolvedValue(undefined);
	const metadataCache = { getCache: vi.fn().mockReturnValue(null) };
	const workspace = {
		getLeavesOfType: vi.fn().mockReturnValue([]),
		getRightLeaf: vi.fn().mockReturnValue(null),
		revealLeaf: vi.fn(),
		openLinkText: vi.fn(),
	};
	plugin.app = { vault, metadataCache, workspace } as AnyPlugin;

	const statusBarEl = createMockElement();
	let ribbonCallback: () => void = () => {};
	let commandCallback: () => void = () => {};

	plugin.addRibbonIcon = vi
		.fn()
		.mockImplementation((_icon: string, _title: string, cb: () => void) => {
			ribbonCallback = cb;
			return createMockElement();
		});

	plugin.addCommand = vi.fn().mockImplementation((cmd: { callback?: () => void; id?: string }) => {
		if (cmd.callback && cmd.id === "ghvault-sync") {
			commandCallback = cmd.callback;
		}
		return cmd;
	});

	plugin.addStatusBarItem = vi.fn().mockReturnValue(statusBarEl);
	plugin.addSettingTab = vi.fn();
	plugin.registerView = vi.fn();

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

	it("redacts GitHub Actions tokens (gha_)", async () => {
		const { sanitizeErrorForUI } = await import("./main");
		const msg = "Auth failed with gha_abcdefghij1234567890 token";
		expect(sanitizeErrorForUI(msg)).toBe("Auth failed with [REDACTED] token");
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
		vi.useRealTimers();
		vi.restoreAllMocks();
		noticeLog.length = 0;
		mockSync.mockReset().mockResolvedValue({
			pull: { created: [], modified: [], deleted: [], errors: [] },
			push: null,
			conflicts: [],
			resolvedCount: 0,
			renames: [],
		});
		mockIsSyncing = false;
		mockGetRepoInfo.mockReset();
		mockGetRef.mockReset();
		mockStateClear.mockClear();
		mockStateSave.mockClear();
		mockGetHeadOid.mockReset().mockReturnValue("");
		mockGetAllSHAs.mockReset().mockReturnValue({});
		capturedSettingCallbacks = {};
		capturedChangeQueueOnReady = null;
		capturedChangeQueueOnPersist = null;
		mockChangeQueuePause.mockClear();
		mockChangeQueueResume.mockClear();
		mockChangeQueuePush.mockClear();
		mockChangeQueueDestroy.mockClear();
		mockChangeQueueGetPending.mockReset().mockReturnValue(new Map());
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

		it("file history command is registered", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			const calls = vi.mocked(plugin.addCommand).mock.calls;
			const historyCmd = calls.find(
				(c: [{ id: string; name: string; checkCallback?: unknown }]) =>
					c[0].id === "ghvault-file-history",
			);
			expect(historyCmd).toBeDefined();
			expect(historyCmd?.[0].name).toBe("Show file history");
			expect(historyCmd?.[0].checkCallback).toBeDefined();
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

		it("transitions idle -> syncing -> synced just now on successful sync (manual mode)", async () => {
			const { statusBarEl, plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();

			await plugin.runSync();

			const calls = vi
				.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>)
				.mock.calls.map((c: unknown[]) => c[0]);
			expect(calls).toEqual(["GHVault: syncing...", "GHVault: synced just now"]);
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
				conflicts: [],
				resolvedCount: 0,
				renames: [],
			});

			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			noticeLog.length = 0;
			await plugin.runSync();

			expect(lastNotice().message).toBe("GHVault: Synced — 2 pulled, 1 pushed");
		});

		it("shows conflict count in notice when conflicts exist", async () => {
			mockSync.mockResolvedValueOnce({
				pull: { created: ["a.md"], modified: [], deleted: [], errors: [] },
				push: { pushed: ["b.md"], deleted: [] },
				conflicts: [
					{ path: "c.md", localChange: "modify", remoteChange: "modify" },
					{ path: "d.md", localChange: "modify", remoteChange: "delete" },
				],
				resolvedCount: 0,
				renames: [],
			});

			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			noticeLog.length = 0;
			await plugin.runSync();

			expect(lastNotice().message).toBe("GHVault: Synced — 1 pulled, 1 pushed, 2 conflicts");
		});

		it("shows 'Synced' with conflicts even when no files pulled or pushed", async () => {
			mockSync.mockResolvedValueOnce({
				pull: { created: [], modified: [], deleted: [], errors: [] },
				push: null,
				conflicts: [{ path: "x.md", localChange: "modify", remoteChange: "modify" }],
				resolvedCount: 0,
				renames: [],
			});

			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			noticeLog.length = 0;
			await plugin.runSync();

			expect(lastNotice().message).toBe("GHVault: Synced — 0 pulled, 0 pushed, 1 conflict");
		});

		it("shows 'resolved (local wins)' for local-wins strategy", async () => {
			mockSync.mockResolvedValueOnce({
				pull: { created: [], modified: [], deleted: [], errors: [] },
				push: { pushed: ["conflict.md"], deleted: [] },
				conflicts: [{ path: "conflict.md", localChange: "modify", remoteChange: "modify" }],
				resolvedCount: 1,
				renames: [],
			});

			const { plugin } = await loadPlugin({
				settings: {
					...CONFIGURED_SETTINGS.settings,
					conflictStrategy: "local-wins",
				},
			});
			noticeLog.length = 0;
			await plugin.runSync();

			expect(lastNotice().message).toBe(
				"GHVault: Synced — 0 pulled, 1 pushed, 1 resolved (local wins)",
			);
		});

		it("shows 'resolved (remote wins)' for remote-wins strategy", async () => {
			mockSync.mockResolvedValueOnce({
				pull: { created: [], modified: ["conflict.md"], deleted: [], errors: [] },
				push: null,
				conflicts: [
					{ path: "a.md", localChange: "modify", remoteChange: "modify" },
					{ path: "b.md", localChange: "modify", remoteChange: "delete" },
				],
				resolvedCount: 2,
				renames: [],
			});

			const { plugin } = await loadPlugin({
				settings: {
					...CONFIGURED_SETTINGS.settings,
					conflictStrategy: "remote-wins",
				},
			});
			noticeLog.length = 0;
			await plugin.runSync();

			expect(lastNotice().message).toBe(
				"GHVault: Synced — 1 pulled, 0 pushed, 2 resolved (remote wins)",
			);
		});

		it("shows 'resolved (per-file)' for ask strategy with resolved conflicts", async () => {
			mockSync.mockResolvedValueOnce({
				pull: { created: [], modified: ["b.md"], deleted: [], errors: [] },
				push: { pushed: ["a.md"], deleted: [] },
				conflicts: [
					{ path: "a.md", localChange: "modify", remoteChange: "modify" },
					{ path: "b.md", localChange: "modify", remoteChange: "modify" },
				],
				resolvedCount: 2,
				renames: [],
			});

			const { plugin } = await loadPlugin({
				settings: {
					...CONFIGURED_SETTINGS.settings,
					conflictStrategy: "ask",
				},
			});
			noticeLog.length = 0;
			await plugin.runSync();

			expect(lastNotice().message).toBe(
				"GHVault: Synced — 1 pulled, 1 pushed, 2 resolved (per-file)",
			);
		});

		it("shows 'conflicts' for ask strategy when user skips all", async () => {
			mockSync.mockResolvedValueOnce({
				pull: { created: [], modified: [], deleted: [], errors: [] },
				push: null,
				conflicts: [{ path: "x.md", localChange: "modify", remoteChange: "modify" }],
				resolvedCount: 0,
				renames: [],
			});

			const { plugin } = await loadPlugin({
				settings: {
					...CONFIGURED_SETTINGS.settings,
					conflictStrategy: "ask",
				},
			});
			noticeLog.length = 0;
			await plugin.runSync();

			expect(lastNotice().message).toBe("GHVault: Synced — 0 pulled, 0 pushed, 1 conflict");
		});

		it("shows rename count in notice", async () => {
			mockSync.mockResolvedValueOnce({
				pull: { created: [], modified: [], deleted: [], errors: [] },
				push: { pushed: ["new.md"], deleted: ["old.md"] },
				conflicts: [],
				resolvedCount: 0,
				renames: [{ oldPath: "old.md", newPath: "new.md" }],
			});

			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			noticeLog.length = 0;
			await plugin.runSync();

			expect(lastNotice().message).toBe("GHVault: Synced — 0 pulled, 2 pushed, 1 renamed");
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

		it("loadSettings parses autoSyncPullInterval within range", async () => {
			const { plugin } = await loadPlugin({
				settings: { autoSyncPullInterval: 120 },
			});
			expect(plugin.settings.autoSyncPullInterval).toBe(120);
		});

		it("loadSettings defaults autoSyncPullInterval for out-of-range values", async () => {
			const { plugin } = await loadPlugin({
				settings: { autoSyncPullInterval: 5 },
			});
			expect(plugin.settings.autoSyncPullInterval).toBe(DEFAULT_SETTINGS.autoSyncPullInterval);
		});

		it("loadSettings defaults autoSyncPullInterval for value above max", async () => {
			const { plugin } = await loadPlugin({
				settings: { autoSyncPullInterval: 9999 },
			});
			expect(plugin.settings.autoSyncPullInterval).toBe(DEFAULT_SETTINGS.autoSyncPullInterval);
		});

		it("loadSettings defaults autoSyncPullInterval for non-number", async () => {
			const { plugin } = await loadPlugin({
				settings: { autoSyncPullInterval: "slow" },
			});
			expect(plugin.settings.autoSyncPullInterval).toBe(DEFAULT_SETTINGS.autoSyncPullInterval);
		});

		it("loadSettings parses valid conflictStrategy", async () => {
			const { plugin } = await loadPlugin({
				settings: { conflictStrategy: "local-wins" },
			});
			expect(plugin.settings.conflictStrategy).toBe("local-wins");
		});

		it("loadSettings parses ask conflictStrategy", async () => {
			const { plugin } = await loadPlugin({
				settings: { conflictStrategy: "ask" },
			});
			expect(plugin.settings.conflictStrategy).toBe("ask");
		});

		it("loadSettings defaults conflictStrategy for invalid value", async () => {
			const { plugin } = await loadPlugin({
				settings: { conflictStrategy: "invalid-strategy" },
			});
			expect(plugin.settings.conflictStrategy).toBe("skip");
		});

		it("loadSettings defaults conflictStrategy when missing", async () => {
			const { plugin } = await loadPlugin({
				settings: { githubToken: "ghp_token1234567890123456" },
			});
			expect(plugin.settings.conflictStrategy).toBe("skip");
		});
	});

	describe("crash recovery", () => {
		const AUTO_SYNC_WITH_PENDING = {
			settings: {
				githubToken: "ghp_token1234567890123456",
				owner: "me",
				repo: "vault",
				branch: "main",
				autoSync: true,
				autoSyncDebounce: 10,
			},
			pendingChanges: {
				"notes/todo.md": "modify",
				"new-file.md": "create",
			},
		};

		it("restores pending changes on load when autoSync is enabled", async () => {
			await loadPlugin(AUTO_SYNC_WITH_PENDING);

			expect(mockChangeQueuePush).toHaveBeenCalledTimes(2);
			expect(mockChangeQueuePush).toHaveBeenCalledWith("notes/todo.md", "modify");
			expect(mockChangeQueuePush).toHaveBeenCalledWith("new-file.md", "create");
		});

		it("does not restore pending changes when autoSync is disabled", async () => {
			await loadPlugin({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
					autoSync: false,
				},
				pendingChanges: {
					"notes/todo.md": "modify",
				},
			});

			expect(mockChangeQueuePush).not.toHaveBeenCalled();
		});

		it("does not restore when pendingChanges is empty", async () => {
			await loadPlugin({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
					autoSync: true,
					autoSyncDebounce: 10,
				},
				pendingChanges: {},
			});

			expect(mockChangeQueuePush).not.toHaveBeenCalled();
		});

		it("does not restore when pendingChanges is missing", async () => {
			await loadPlugin({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
					autoSync: true,
					autoSyncDebounce: 10,
				},
			});

			expect(mockChangeQueuePush).not.toHaveBeenCalled();
		});

		it("skips entries with invalid change types", async () => {
			await loadPlugin({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
					autoSync: true,
					autoSyncDebounce: 10,
				},
				pendingChanges: {
					"valid.md": "modify",
					"invalid.md": "unknown_type",
					"also-invalid.md": 12345,
					"": "create",
				},
			});

			expect(mockChangeQueuePush).toHaveBeenCalledTimes(1);
			expect(mockChangeQueuePush).toHaveBeenCalledWith("valid.md", "modify");
		});

		it("skips entries with unsafe paths", async () => {
			await loadPlugin({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
					autoSync: true,
					autoSyncDebounce: 10,
				},
				pendingChanges: {
					"safe.md": "create",
					"../../etc/passwd": "create",
					"/absolute/path.md": "modify",
					"normal/note.md": "modify",
				},
			});

			expect(mockChangeQueuePush).toHaveBeenCalledTimes(2);
			expect(mockChangeQueuePush).toHaveBeenCalledWith("safe.md", "create");
			expect(mockChangeQueuePush).toHaveBeenCalledWith("normal/note.md", "modify");
			expect(mockChangeQueuePush).not.toHaveBeenCalledWith("../../etc/passwd", expect.anything());
		});

		it("skips restore when pendingChanges is not an object", async () => {
			await loadPlugin({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
					autoSync: true,
					autoSyncDebounce: 10,
				},
				pendingChanges: "not-an-object",
			});

			expect(mockChangeQueuePush).not.toHaveBeenCalled();
		});

		it("skips restore when pendingChanges is an array", async () => {
			await loadPlugin({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
					autoSync: true,
					autoSyncDebounce: 10,
				},
				pendingChanges: ["note.md"],
			});

			expect(mockChangeQueuePush).not.toHaveBeenCalled();
		});

		it("passes onPersist callback to ChangeQueue", async () => {
			await loadPlugin({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
					autoSync: true,
					autoSyncDebounce: 10,
				},
			});

			expect(capturedChangeQueueOnPersist).not.toBeNull();
		});

		it("onPersist saves pending changes to storage", async () => {
			const { plugin } = await loadPlugin({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
					autoSync: true,
					autoSyncDebounce: 10,
				},
			});

			capturedChangeQueueOnPersist?.({ "test.md": "modify" });

			await vi.waitFor(() => {
				expect(plugin.saveData).toHaveBeenCalled();
			});

			const savedData = vi.mocked(plugin.saveData).mock.calls[0][0];
			expect(savedData.pendingChanges).toEqual({ "test.md": "modify" });
		});

		it("does not crash when persistPendingChanges fails", async () => {
			const { plugin } = await loadPlugin({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
					autoSync: true,
					autoSyncDebounce: 10,
				},
			});

			// Make loadData reject
			vi.mocked(plugin.loadData).mockRejectedValueOnce(new Error("disk full"));

			// Should not throw
			capturedChangeQueueOnPersist?.({ "test.md": "create" });
			await vi.waitFor(() => {
				expect(plugin.loadData).toHaveBeenCalled();
			});
		});
	});

	describe("periodic pull check", () => {
		const PULL_CHECK_SETTINGS = {
			settings: {
				githubToken: "ghp_token1234567890123456",
				owner: "me",
				repo: "vault",
				branch: "main",
				autoSync: true,
				autoSyncDebounce: 10,
				autoSyncPullInterval: 60,
			},
		};

		const REMOTE_SHA = "a".repeat(40);
		const LOCAL_SHA = "b".repeat(40);

		it("schedules pull check timer when autoSync is enabled", async () => {
			const { plugin } = await loadPlugin(PULL_CHECK_SETTINGS);
			expect(plugin.pullCheckTimeout).not.toBeNull();
			expect(plugin.pullCheckCurrentInterval).toBe(60_000);
		});

		it("tears down pull check when autoSync is turned off", async () => {
			const { plugin, onSave } = await loadPlugin(PULL_CHECK_SETTINGS);
			expect(plugin.pullCheckCurrentInterval).toBeGreaterThan(0);

			await onSave({
				...PULL_CHECK_SETTINGS.settings,
				autoSync: false,
			});
			expect(plugin.pullCheckCurrentInterval).toBe(0);
			expect(plugin.pullCheckTimeout).toBeNull();
		});

		it("triggers sync when remote SHA differs from local", async () => {
			mockGetRef.mockResolvedValue({ ref: "refs/heads/main", sha: REMOTE_SHA });
			mockGetHeadOid.mockReturnValue(LOCAL_SHA);

			const { plugin } = await loadPlugin(PULL_CHECK_SETTINGS);
			await plugin.pullCheckTick();

			expect(mockGetRef).toHaveBeenCalledWith("main");
			expect(mockSync).toHaveBeenCalled();
		});

		it("does not trigger sync when remote SHA matches local", async () => {
			mockGetRef.mockResolvedValue({ ref: "refs/heads/main", sha: REMOTE_SHA });
			mockGetHeadOid.mockReturnValue(REMOTE_SHA);

			const { plugin } = await loadPlugin(PULL_CHECK_SETTINGS);
			await plugin.pullCheckTick();

			expect(mockGetRef).toHaveBeenCalled();
			expect(mockSync).not.toHaveBeenCalled();
		});

		it("skips pull check when headOid is empty (no initial sync)", async () => {
			mockGetRef.mockResolvedValue({ ref: "refs/heads/main", sha: REMOTE_SHA });
			mockGetHeadOid.mockReturnValue("");

			const { plugin } = await loadPlugin(PULL_CHECK_SETTINGS);
			await plugin.pullCheckTick();

			expect(mockGetRef).toHaveBeenCalled();
			expect(mockSync).not.toHaveBeenCalled();
		});

		it("skips pull check when sync is in progress", async () => {
			mockIsSyncing = true;

			const { plugin } = await loadPlugin(PULL_CHECK_SETTINGS);
			await plugin.pullCheckTick();

			expect(mockGetRef).not.toHaveBeenCalled();
		});

		it("skips pull check when rate limit is low", async () => {
			const { plugin } = await loadPlugin(PULL_CHECK_SETTINGS);
			// Override canMakeRequest to return false
			(
				plugin.rateLimiter as { canMakeRequest: ReturnType<typeof vi.fn> }
			).canMakeRequest.mockReturnValue(false);

			await plugin.pullCheckTick();

			expect(mockGetRef).not.toHaveBeenCalled();
		});

		it("backs off interval when no remote changes", async () => {
			mockGetRef.mockResolvedValue({ ref: "refs/heads/main", sha: REMOTE_SHA });
			mockGetHeadOid.mockReturnValue(REMOTE_SHA);

			const { plugin } = await loadPlugin(PULL_CHECK_SETTINGS);

			await plugin.pullCheckTick();
			expect(mockGetRef).toHaveBeenCalledTimes(1);
			expect(plugin.pullCheckCurrentInterval).toBe(120_000);

			await plugin.pullCheckTick();
			expect(mockGetRef).toHaveBeenCalledTimes(2);
			expect(plugin.pullCheckCurrentInterval).toBe(240_000);
		});

		it("caps backoff at 8x base interval", async () => {
			mockGetRef.mockResolvedValue({ ref: "refs/heads/main", sha: REMOTE_SHA });
			mockGetHeadOid.mockReturnValue(REMOTE_SHA);

			const { plugin } = await loadPlugin(PULL_CHECK_SETTINGS);
			const maxMs = 60_000 * 8;

			// Tick 4 times: 60k -> 120k -> 240k -> 480k (capped at 480k)
			await plugin.pullCheckTick();
			await plugin.pullCheckTick();
			await plugin.pullCheckTick();
			expect(plugin.pullCheckCurrentInterval).toBe(maxMs);

			await plugin.pullCheckTick();
			expect(plugin.pullCheckCurrentInterval).toBe(maxMs);
		});

		it("resets interval to base when remote changes detected", async () => {
			mockGetRef.mockResolvedValueOnce({ ref: "refs/heads/main", sha: REMOTE_SHA });
			mockGetHeadOid.mockReturnValue(REMOTE_SHA);

			const { plugin } = await loadPlugin(PULL_CHECK_SETTINGS);

			await plugin.pullCheckTick();
			expect(plugin.pullCheckCurrentInterval).toBe(120_000);

			// Now remote SHA differs from local — should reset to base
			mockGetRef.mockResolvedValueOnce({ ref: "refs/heads/main", sha: LOCAL_SHA });

			await plugin.pullCheckTick();
			expect(plugin.pullCheckCurrentInterval).toBe(60_000);
		});

		it("backs off on network error without showing notice", async () => {
			mockGetRef.mockRejectedValue(new Error("Network error"));

			const { plugin } = await loadPlugin(PULL_CHECK_SETTINGS);
			noticeLog.length = 0;

			await plugin.pullCheckTick();

			expect(plugin.pullCheckCurrentInterval).toBe(120_000);
			const errorNotices = noticeLog.filter((n) => n.message.includes("Network error"));
			expect(errorNotices).toHaveLength(0);
		});

		it("clears pull check timer on onunload", async () => {
			const { plugin } = await loadPlugin(PULL_CHECK_SETTINGS);
			expect(plugin.pullCheckTimeout).not.toBeNull();

			await plugin.onunload();
			expect(plugin.pullCheckTimeout).toBeNull();
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
				resolvedCount: 0,
				renames: [],
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

	describe("formatRelativeTime", () => {
		it("returns 'synced just now' for < 60 seconds", async () => {
			const { formatRelativeTime } = await import("./main");
			const now = Date.now();
			expect(formatRelativeTime(now, now)).toBe("synced just now");
			expect(formatRelativeTime(now - 59_000, now)).toBe("synced just now");
		});

		it("returns minutes for 60s–59min", async () => {
			const { formatRelativeTime } = await import("./main");
			const now = Date.now();
			expect(formatRelativeTime(now - 60_000, now)).toBe("synced 1 min ago");
			expect(formatRelativeTime(now - 120_000, now)).toBe("synced 2 min ago");
			expect(formatRelativeTime(now - 59 * 60_000, now)).toBe("synced 59 min ago");
		});

		it("returns hours for 1h–23h", async () => {
			const { formatRelativeTime } = await import("./main");
			const now = Date.now();
			expect(formatRelativeTime(now - 60 * 60_000, now)).toBe("synced 1 hr ago");
			expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe("synced 3 hr ago");
			expect(formatRelativeTime(now - 23 * 60 * 60_000, now)).toBe("synced 23 hr ago");
		});

		it("returns days for >= 24h", async () => {
			const { formatRelativeTime } = await import("./main");
			const now = Date.now();
			expect(formatRelativeTime(now - 24 * 60 * 60_000, now)).toBe("synced 1 d ago");
			expect(formatRelativeTime(now - 7 * 24 * 60 * 60_000, now)).toBe("synced 7 d ago");
		});
	});

	describe("formatAbsoluteTime", () => {
		it("returns zero-padded HH:MM", async () => {
			const { formatAbsoluteTime } = await import("./main");
			// 2026-01-15 at 09:05 local time
			const date = new Date(2026, 0, 15, 9, 5);
			expect(formatAbsoluteTime(date.getTime())).toBe("synced 09:05");
		});

		it("handles afternoon times", async () => {
			const { formatAbsoluteTime } = await import("./main");
			const date = new Date(2026, 0, 15, 14, 32);
			expect(formatAbsoluteTime(date.getTime())).toBe("synced 14:32");
		});

		it("handles midnight", async () => {
			const { formatAbsoluteTime } = await import("./main");
			const date = new Date(2026, 0, 15, 0, 0);
			expect(formatAbsoluteTime(date.getTime())).toBe("synced 00:00");
		});
	});

	describe("last synced status bar", () => {
		const AUTO_SYNC_SETTINGS = {
			settings: {
				...CONFIGURED_SETTINGS.settings,
				autoSync: true,
				autoSyncDebounce: 10,
				autoSyncPullInterval: 300,
			},
		};

		it("shows 'synced HH:MM' after successful sync with autoSync ON", async () => {
			const { statusBarEl, plugin } = await loadPlugin(AUTO_SYNC_SETTINGS);
			vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();

			await plugin.runSync();

			const calls = vi
				.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>)
				.mock.calls.map((c: unknown[]) => c[0]) as string[];

			expect(calls[0]).toBe("GHVault: syncing...");
			expect(calls[1]).toMatch(/^GHVault: synced \d{2}:\d{2}$/);
		});

		it("shows 'synced just now' after successful sync with autoSync OFF", async () => {
			const { statusBarEl, plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();

			await plugin.runSync();

			const calls = vi
				.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>)
				.mock.calls.map((c: unknown[]) => c[0]) as string[];

			expect(calls).toEqual(["GHVault: syncing...", "GHVault: synced just now"]);
		});

		it("shows 'idle' when no sync has been performed yet", async () => {
			const { statusBarEl } = await loadPlugin(CONFIGURED_SETTINGS);
			expect(statusBarEl.setText).toHaveBeenCalledWith("GHVault: idle");
		});

		it("starts refresh interval in manual mode after sync", async () => {
			vi.useFakeTimers();
			try {
				const { statusBarEl, plugin } = await loadPlugin(CONFIGURED_SETTINGS);

				await plugin.runSync();
				vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();

				// Advance 30s — interval should fire and update text
				vi.advanceTimersByTime(30_000);

				expect(statusBarEl.setText).toHaveBeenCalled();
				const setCalls = vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mock.calls;
				const lastCall = setCalls[setCalls.length - 1]?.[0] as string;
				expect(lastCall).toMatch(/^GHVault: synced (just now|1 min ago)$/);
			} finally {
				vi.useRealTimers();
			}
		});

		it("does not start refresh interval in auto-sync mode after sync", async () => {
			vi.useFakeTimers();
			try {
				const { statusBarEl, plugin } = await loadPlugin(AUTO_SYNC_SETTINGS);

				await plugin.runSync();
				vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();

				// Advance 30s — no additional calls expected
				vi.advanceTimersByTime(30_000);

				expect(statusBarEl.setText).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it("clears refresh interval on syncing state", async () => {
			vi.useFakeTimers();
			try {
				const { statusBarEl, plugin } = await loadPlugin(CONFIGURED_SETTINGS);

				// Trigger sync to set lastSuccessfulSyncAt and start interval
				await plugin.runSync();
				vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();

				// Start another sync — should clear interval
				plugin.setStatus("syncing...");
				vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();

				// Advance 30s — interval should NOT fire
				vi.advanceTimersByTime(30_000);
				expect(statusBarEl.setText).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it("clears refresh interval on unload", async () => {
			vi.useFakeTimers();
			try {
				const { statusBarEl, plugin } = await loadPlugin(CONFIGURED_SETTINGS);

				await plugin.runSync();
				vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();

				await plugin.onunload();

				// Advance 30s — interval should NOT fire
				vi.advanceTimersByTime(30_000);
				expect(statusBarEl.setText).not.toHaveBeenCalled();
			} finally {
				vi.useRealTimers();
			}
		});

		it("preserves lastSuccessfulSyncAt after error and shows it on next success", async () => {
			const { statusBarEl, plugin } = await loadPlugin(CONFIGURED_SETTINGS);

			// First successful sync
			await plugin.runSync();

			// Reset cooldown so next runSync() is not throttled
			plugin.lastSyncAt = 0;

			// Failed sync
			mockSync.mockRejectedValueOnce(new Error("Network error"));
			await plugin.runSync();
			const errorCalls = vi
				.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>)
				.mock.calls.map((c: unknown[]) => c[0]) as string[];
			expect(errorCalls).toContain("GHVault: error");

			// Reset cooldown again
			plugin.lastSyncAt = 0;

			// Next successful sync
			vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();
			mockSync.mockResolvedValueOnce({
				pull: { created: [], modified: [], deleted: [], errors: [] },
				push: null,
				conflicts: [],
				resolvedCount: 0,
				renames: [],
			});
			await plugin.runSync();

			const finalCalls = vi
				.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>)
				.mock.calls.map((c: unknown[]) => c[0]) as string[];
			expect(finalCalls).toContain("GHVault: synced just now");
		});

		it("switches display format when autoSync is toggled via settings", async () => {
			const { statusBarEl, plugin, onSave } = await loadPlugin(CONFIGURED_SETTINGS);

			// Sync in manual mode → "synced just now"
			await plugin.runSync();
			const manualCalls = vi
				.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>)
				.mock.calls.map((c: unknown[]) => c[0]) as string[];
			expect(manualCalls).toContain("GHVault: synced just now");

			vi.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>).mockClear();

			// Toggle autoSync ON → should re-render with HH:MM format
			await onSave({
				...CONFIGURED_SETTINGS.settings,
				autoSync: true,
				autoSyncDebounce: 10,
				autoSyncPullInterval: 300,
			});

			const autoCalls = vi
				.mocked(statusBarEl.setText as ReturnType<typeof vi.fn>)
				.mock.calls.map((c: unknown[]) => c[0]) as string[];
			expect(autoCalls.some((c) => /^GHVault: synced \d{2}:\d{2}$/.test(c))).toBe(true);
		});
	});

	describe("registerView and toggle command", () => {
		it("registerView is called with correct view type", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			expect(plugin.registerView).toHaveBeenCalledTimes(1);
			const [viewType] = vi.mocked(plugin.registerView).mock.calls[0];
			expect(viewType).toBe("ghvault-sync-status");
		});

		it("toggle command is registered with correct id", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			const calls = vi.mocked(plugin.addCommand).mock.calls;
			const toggleCmd = calls.find(
				(c: [{ id: string; name: string }]) => c[0].id === "ghvault-toggle-sync-status",
			);
			expect(toggleCmd).toBeDefined();
			expect(toggleCmd?.[0].name).toBe("Toggle sync status panel");
		});
	});

	describe("refreshSyncStatusPanel", () => {
		it("is called after successful sync (workspace.getLeavesOfType is called)", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			const workspace = plugin.app.workspace;
			vi.mocked(workspace.getLeavesOfType).mockClear();

			await plugin.runSync();

			// refreshSyncStatusPanel calls getLeavesOfType with the view type
			expect(workspace.getLeavesOfType).toHaveBeenCalledWith("ghvault-sync-status");
		});

		it("does not crash when no leaves exist", async () => {
			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			const workspace = plugin.app.workspace;
			vi.mocked(workspace.getLeavesOfType).mockReturnValue([]);

			// Should not throw
			await plugin.runSync();
		});

		it("calls view.refresh with data when leaf exists", async () => {
			const mockRefresh = vi.fn();
			const mockView = { refresh: mockRefresh };
			const mockLeaf = { view: mockView };

			const { plugin } = await loadPlugin(CONFIGURED_SETTINGS);
			const workspace = plugin.app.workspace;
			vi.mocked(workspace.getLeavesOfType).mockReturnValue([mockLeaf]);

			await plugin.runSync();

			expect(mockRefresh).toHaveBeenCalled();
		});
	});
});
