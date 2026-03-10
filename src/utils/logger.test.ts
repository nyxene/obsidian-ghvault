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

	describe("init", () => {
		it("reads log file and sets writeCount", async () => {
			const read = app.vault.adapter.read as ReturnType<typeof vi.fn>;
			read.mockResolvedValue("line1\nline2\nline3");

			await logger.init();

			expect(read).toHaveBeenCalledWith("ghvault.log");
			// After init, writeCount should be 3 (3 lines).
			// Writing one more should make writeCount = 4, not trigger rotation.
			logger.info("after init");
			const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;
			expect(append).toHaveBeenCalledOnce();
		});

		it("handles missing log file gracefully", async () => {
			const read = app.vault.adapter.read as ReturnType<typeof vi.fn>;
			read.mockRejectedValue(new Error("File not found"));

			// Should not throw
			await logger.init();

			// Logger should still work
			logger.info("still works");
			const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;
			expect(append).toHaveBeenCalledOnce();
		});

		it("triggers rotation when file exceeds MAX_LOG_LINES", async () => {
			const read = app.vault.adapter.read as ReturnType<typeof vi.fn>;
			const lines = Array.from({ length: 5001 }, (_, i) => `line-${i}`).join("\n");
			read.mockResolvedValue(lines);

			const write = app.vault.adapter.write as ReturnType<typeof vi.fn>;
			write.mockResolvedValue(undefined);

			await logger.init();

			// Rotation should have been triggered — read is called once by init,
			// then once more by rotateLog
			// Allow the rotation promise to settle
			await vi.waitFor(() => {
				expect(read).toHaveBeenCalledTimes(2);
			});

			expect(write).toHaveBeenCalled();
			// The written content should be trimmed to last 3000 lines
			const writtenContent = write.mock.calls[0][1] as string;
			const writtenLines = writtenContent.trim().split("\n");
			expect(writtenLines.length).toBe(3000);
			expect(writtenLines[writtenLines.length - 1]).toBe("line-5000");
		});
	});

	describe("rotateLog", () => {
		it("trims log to last TRIM_TO_LINES (3000) lines", async () => {
			const read = app.vault.adapter.read as ReturnType<typeof vi.fn>;
			const write = app.vault.adapter.write as ReturnType<typeof vi.fn>;

			// Trigger rotation by writing MAX_LOG_LINES entries
			const lines = Array.from({ length: 5001 }, (_, i) => `line-${i}`).join("\n");

			// Use init to set writeCount near the limit
			read.mockResolvedValueOnce(Array.from({ length: 4999 }, () => "x").join("\n"));
			await logger.init();

			// At this point writeCount = 4999. Writing one more should trigger rotation.
			read.mockResolvedValueOnce(lines);
			write.mockResolvedValue(undefined);

			logger.info("trigger rotation");

			await vi.waitFor(() => {
				expect(write).toHaveBeenCalled();
			});

			const writtenContent = write.mock.calls[0][1] as string;
			const writtenLines = writtenContent.trim().split("\n");
			expect(writtenLines.length).toBe(3000);
		});

		it("handles read error during rotation gracefully", async () => {
			const read = app.vault.adapter.read as ReturnType<typeof vi.fn>;
			const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;

			// Set writeCount to just below the limit
			read.mockResolvedValueOnce(Array.from({ length: 4999 }, () => "x").join("\n"));
			await logger.init();

			// Rotation read fails
			read.mockRejectedValueOnce(new Error("Disk error"));

			logger.info("trigger rotation");

			// Wait for rotation to finish (it catches the error)
			await vi.waitFor(() => {
				// After rotation finishes (even on error), rotating flag is cleared
				// and writeCount is reset. New writes should go through.
				logger.info("after rotation error");
				expect(append.mock.calls.length).toBeGreaterThanOrEqual(2);
			});
		});
	});

	describe("writeQueue buffering during rotation", () => {
		it("buffers writes during rotation and flushes after", async () => {
			const read = app.vault.adapter.read as ReturnType<typeof vi.fn>;
			const write = app.vault.adapter.write as ReturnType<typeof vi.fn>;
			const append = app.vault.adapter.append as ReturnType<typeof vi.fn>;

			// Set up: init with count near limit
			read.mockResolvedValueOnce(Array.from({ length: 4999 }, () => "x").join("\n"));
			await logger.init();

			// Make rotation slow so we can queue writes
			const bigLog = Array.from({ length: 5001 }, (_, i) => `line-${i}`).join("\n");
			let resolveRead: ((value: string) => void) | undefined;
			read.mockImplementationOnce(
				() =>
					new Promise<string>((resolve) => {
						resolveRead = resolve;
					}),
			);
			write.mockResolvedValue(undefined);

			// Trigger rotation
			logger.info("trigger");

			// While rotating, these writes should be queued
			logger.info("queued-1");
			logger.info("queued-2");

			// Only the trigger write should have gone through before rotation
			// (the trigger write itself goes to append, then rotation starts)
			const appendCallsBefore = append.mock.calls.length;
			expect(appendCallsBefore).toBe(1); // "trigger" was appended

			// Resolve the rotation read
			resolveRead?.(bigLog);

			await vi.waitFor(() => {
				// After rotation completes, queued writes should be flushed
				expect(append.mock.calls.length).toBeGreaterThan(appendCallsBefore);
			});

			// The queued writes should appear in a single append call
			const lastAppendCall = append.mock.calls[append.mock.calls.length - 1][1] as string;
			expect(lastAppendCall).toContain("queued-1");
			expect(lastAppendCall).toContain("queued-2");
		});
	});
});
