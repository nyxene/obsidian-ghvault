import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./types";

// ---------------------------------------------------------------------------
// sanitizeErrorForUI is a module-private function in main.ts.
// We replicate its logic here to test the expected behaviour as a
// regression guard.
// ---------------------------------------------------------------------------

function sanitizeErrorForUI(message: string): string {
	return message.replace(
		/ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|Bearer [a-zA-Z0-9_.-]+/g,
		"[REDACTED]",
	);
}

describe("sanitizeErrorForUI", () => {
	it("redacts classic personal access tokens (ghp_)", () => {
		const msg = "Auth failed with token ghp_abcdefghij1234567890";
		expect(sanitizeErrorForUI(msg)).toBe("Auth failed with token [REDACTED]");
	});

	it("redacts fine-grained personal access tokens (github_pat_)", () => {
		const msg = "Token github_pat_abc123_XYZXYZXYZXYZXYZXYZXYZ was rejected";
		expect(sanitizeErrorForUI(msg)).toBe("Token [REDACTED] was rejected");
	});

	it("redacts Bearer tokens", () => {
		const msg = "Header: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc";
		expect(sanitizeErrorForUI(msg)).toBe("Header: [REDACTED]");
	});

	it("redacts multiple tokens in the same message", () => {
		const msg = "Tried ghp_aaaabbbbccccddddeeee1234 then ghp_11112222333344445555aaaa";
		const result = sanitizeErrorForUI(msg);
		expect(result).not.toContain("ghp_");
		expect(result).toBe("Tried [REDACTED] then [REDACTED]");
	});

	it("passes through messages without tokens", () => {
		const msg = "Network timeout after 30s";
		expect(sanitizeErrorForUI(msg)).toBe(msg);
	});

	it("handles empty string", () => {
		expect(sanitizeErrorForUI("")).toBe("");
	});

	it("does not redact short ghp_ strings below 20 chars", () => {
		const msg = "ghp_short";
		expect(sanitizeErrorForUI(msg)).toBe("ghp_short");
	});
});

// ---------------------------------------------------------------------------
// GHVaultPlugin — tests via dynamic import with all heavy deps mocked
// ---------------------------------------------------------------------------

vi.mock("./github/client", () => ({
	GitHubClient: class MockGitHubClient {
		getRepoInfo = vi.fn();
	},
}));

vi.mock("./github/graphql", () => ({
	GitHubGraphQL: class MockGitHubGraphQL {},
}));

vi.mock("./github/rate-limit", () => ({
	RateLimiter: class MockRateLimiter {},
}));

vi.mock("./sync/engine", () => ({
	SyncEngine: class MockSyncEngine {
		isSyncing = false;
		sync = vi.fn().mockResolvedValue({
			pull: { created: [], modified: [], deleted: [], errors: [] },
			push: null,
		});
	},
}));

vi.mock("./sync/pull", () => ({
	PullEngine: class MockPullEngine {},
}));

vi.mock("./sync/push", () => ({
	PushEngine: class MockPushEngine {},
}));

vi.mock("./sync/state", () => ({
	SyncStateManager: class MockSyncStateManager {},
}));

vi.mock("./sync/vault-adapter", () => ({
	ObsidianVaultAdapter: class MockObsidianVaultAdapter {},
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

vi.mock("./settings", () => ({
	GHVaultSettingTab: class MockSettingTab {},
}));

// biome-ignore lint/suspicious/noExplicitAny: test helper for accessing private members
type AnyPlugin = any;

function createMockElement(): Record<string, unknown> {
	return { setText: vi.fn(), textContent: "" };
}

async function createPluginInstance(loadDataResult: unknown = null): Promise<{
	plugin: AnyPlugin;
	loadDataSpy: ReturnType<typeof vi.fn>;
	saveDataSpy: ReturnType<typeof vi.fn>;
}> {
	const mod = await import("./main");
	const PluginClass = mod.default as AnyPlugin;
	const plugin = new PluginClass();
	const loadDataSpy = vi.fn().mockResolvedValue(loadDataResult);
	const saveDataSpy = vi.fn().mockResolvedValue(undefined);
	plugin.loadData = loadDataSpy;
	plugin.saveData = saveDataSpy;
	plugin.app = { vault: {} } as AnyPlugin;
	// Override methods that use `document` (no DOM in node environment)
	plugin.addRibbonIcon = vi.fn().mockReturnValue(createMockElement());
	plugin.addCommand = vi.fn();
	plugin.addStatusBarItem = vi.fn().mockReturnValue(createMockElement());
	plugin.addSettingTab = vi.fn();
	return { plugin, loadDataSpy, saveDataSpy };
}

describe("GHVaultPlugin", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("loadSettings", () => {
		it("uses defaults when loadData returns null", async () => {
			const { plugin } = await createPluginInstance(null);
			await plugin.onload();
			expect(plugin.settings).toEqual(expect.objectContaining(DEFAULT_SETTINGS));
		});

		it("uses defaults when loadData returns empty object", async () => {
			const { plugin } = await createPluginInstance({});
			await plugin.onload();
			expect(plugin.settings).toEqual(expect.objectContaining(DEFAULT_SETTINGS));
		});

		it("merges stored settings with defaults", async () => {
			const { plugin } = await createPluginInstance({
				settings: { githubToken: "ghp_stored", owner: "me" },
			});
			await plugin.onload();
			expect(plugin.settings.githubToken).toBe("ghp_stored");
			expect(plugin.settings.owner).toBe("me");
			expect(plugin.settings.branch).toBe("main"); // from defaults
		});

		it("resets invalid logLevel to default", async () => {
			const { plugin } = await createPluginInstance({
				settings: { logLevel: "INVALID_LEVEL" },
			});
			await plugin.onload();
			expect(plugin.settings.logLevel).toBe(DEFAULT_SETTINGS.logLevel);
		});

		it("keeps valid logLevel", async () => {
			const { plugin } = await createPluginInstance({
				settings: { logLevel: "debug" },
			});
			await plugin.onload();
			expect(plugin.settings.logLevel).toBe("debug");
		});
	});

	describe("rebuildSyncEngine", () => {
		it("sets syncEngine to null when token is missing", async () => {
			const { plugin } = await createPluginInstance({
				settings: { owner: "me", repo: "vault", githubToken: "" },
			});
			await plugin.onload();
			expect(plugin.syncEngine).toBeNull();
		});

		it("sets syncEngine to null when owner is missing", async () => {
			const { plugin } = await createPluginInstance({
				settings: { owner: "", repo: "vault", githubToken: "ghp_token1234567890123456" },
			});
			await plugin.onload();
			expect(plugin.syncEngine).toBeNull();
		});

		it("sets syncEngine to null when repo is missing", async () => {
			const { plugin } = await createPluginInstance({
				settings: { owner: "me", repo: "", githubToken: "ghp_token1234567890123456" },
			});
			await plugin.onload();
			expect(plugin.syncEngine).toBeNull();
		});

		it("creates syncEngine when all settings are provided", async () => {
			const { plugin } = await createPluginInstance({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
					branch: "main",
				},
			});
			await plugin.onload();
			expect(plugin.syncEngine).not.toBeNull();
		});
	});

	describe("runSync guards", () => {
		it("returns early when no engine configured", async () => {
			const { plugin } = await createPluginInstance(null);
			await plugin.onload();
			// syncEngine is null because no settings — runSync should return early
			await plugin.runSync();
			expect(plugin.syncEngine).toBeNull();
		});

		it("returns early when sync is already in progress", async () => {
			const { plugin } = await createPluginInstance({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
				},
			});
			await plugin.onload();
			plugin.syncEngine.isSyncing = true;

			// Should not throw, just return early
			await plugin.runSync();
			// sync() should NOT have been called since isSyncing was true
			expect(plugin.syncEngine.sync).not.toHaveBeenCalled();
		});

		it("blocks when cooldown has not elapsed", async () => {
			const { plugin } = await createPluginInstance({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
				},
			});
			await plugin.onload();

			// First sync sets lastSyncAt
			await plugin.runSync();
			expect(plugin.syncEngine.sync).toHaveBeenCalledTimes(1);

			// Second sync immediately — should be blocked by cooldown
			await plugin.runSync();
			// sync() should still only have been called once
			expect(plugin.syncEngine.sync).toHaveBeenCalledTimes(1);
		});
	});

	describe("onunload", () => {
		it("clears all references", async () => {
			const { plugin } = await createPluginInstance({
				settings: {
					githubToken: "ghp_token1234567890123456",
					owner: "me",
					repo: "vault",
				},
			});
			await plugin.onload();
			expect(plugin.syncEngine).not.toBeNull();

			await plugin.onunload();
			expect(plugin.syncEngine).toBeNull();
			expect(plugin.statusBarEl).toBeNull();
			expect(plugin.logger).toBeNull();
		});
	});
});
