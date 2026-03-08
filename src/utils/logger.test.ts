import type { App } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "./logger";
import { Logger } from "./logger";

function createMockApp(): App {
	return {
		vault: {
			adapter: {
				append: vi.fn().mockResolvedValue(undefined),
				read: vi.fn().mockResolvedValue(""),
				write: vi.fn().mockResolvedValue(undefined),
			},
		},
	} as unknown as App;
}

describe("Logger", () => {
	let app: App;
	let logger: Logger;

	beforeEach(() => {
		app = createMockApp();
		logger = new Logger({ app, minLevel: "debug" });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("writes JSON line to ghvault.log", () => {
		logger.info("test message");

		const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;
		expect(append).toHaveBeenCalledOnce();
		expect(append.mock.calls[0][0]).toBe("ghvault.log");

		const entry: LogEntry = JSON.parse(append.mock.calls[0][1].trim());
		expect(entry.level).toBe("info");
		expect(entry.message).toBe("test message");
		expect(entry.timestamp).toBeDefined();
	});

	it("includes data when provided", () => {
		logger.error("failed", { code: 401 });

		const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;
		const entry: LogEntry = JSON.parse(append.mock.calls[0][1].trim());
		expect(entry.data).toEqual({ code: 401 });
	});

	it("omits data field when not provided", () => {
		logger.warn("no data");

		const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;
		const entry: LogEntry = JSON.parse(append.mock.calls[0][1].trim());
		expect(entry.data).toBeUndefined();
	});

	it("respects minimum log level", () => {
		logger.setLevel("warn");
		logger.debug("ignored");
		logger.info("ignored");
		logger.warn("included");
		logger.error("included");

		const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;
		expect(append).toHaveBeenCalledTimes(2);
	});

	it("writes all levels when set to debug", () => {
		logger.debug("d");
		logger.info("i");
		logger.warn("w");
		logger.error("e");

		const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;
		expect(append).toHaveBeenCalledTimes(4);
	});

	it("allows changing log level", () => {
		logger.setLevel("error");
		logger.info("ignored");

		const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;
		expect(append).not.toHaveBeenCalled();

		logger.setLevel("info");
		logger.info("now included");
		expect(append).toHaveBeenCalledOnce();
	});

	it("redacts GitHub tokens from log output", () => {
		logger.info("token is ghp_abcdefghijklmnopqrstuvwx");

		const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;
		const line = append.mock.calls[0][1] as string;
		expect(line).not.toContain("ghp_");
		expect(line).toContain("[REDACTED]");
	});

	it("redacts Bearer tokens from log output", () => {
		logger.error("auth failed", { header: "Bearer ghp_abc123def456ghi789jkl012" });

		const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;
		const line = append.mock.calls[0][1] as string;
		expect(line).not.toContain("Bearer ghp_");
		expect(line).toContain("[REDACTED]");
	});
});
