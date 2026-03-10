import { requestUrl } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubTimeoutError } from "../types";
import { REQUEST_TIMEOUT_MS, requestWithTimeout } from "./request-timeout";

vi.mock("obsidian");

const mockRequest = vi.mocked(requestUrl);

function mockResponse(): ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never {
	return {
		json: { ok: true },
		headers: {},
		status: 200,
		text: '{"ok":true}',
		arrayBuffer: new ArrayBuffer(0),
	} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never;
}

describe("requestWithTimeout", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("exports REQUEST_TIMEOUT_MS as 30 seconds", () => {
		expect(REQUEST_TIMEOUT_MS).toBe(30_000);
	});

	it("resolves when request completes before timeout", async () => {
		mockRequest.mockResolvedValue(mockResponse());

		const result = await requestWithTimeout({ url: "https://api.github.com/test" });
		expect(result.json).toEqual({ ok: true });
	});

	it("rejects with GitHubTimeoutError when request exceeds timeout", async () => {
		vi.useFakeTimers();

		// Request that never resolves
		mockRequest.mockReturnValue(new Promise(() => {}) as ReturnType<typeof requestUrl>);

		const promise = requestWithTimeout({ url: "https://api.github.com/test" }, 5_000);

		vi.advanceTimersByTime(5_000);

		await expect(promise).rejects.toThrow(GitHubTimeoutError);
		await expect(promise).rejects.toThrow("Request timed out after 5s");

		vi.useRealTimers();
	});

	it("uses default timeout when not specified", async () => {
		vi.useFakeTimers();

		mockRequest.mockReturnValue(new Promise(() => {}) as ReturnType<typeof requestUrl>);

		const promise = requestWithTimeout({ url: "https://api.github.com/test" });

		// Advance just under 30s — should not reject yet
		vi.advanceTimersByTime(29_999);
		// Verify it's still pending by racing with a resolved value
		const pending = await Promise.race([
			promise.then(() => "resolved").catch(() => "rejected"),
			Promise.resolve("still-pending"),
		]);
		expect(pending).toBe("still-pending");

		// Advance past 30s — should reject now
		vi.advanceTimersByTime(1);
		await expect(promise).rejects.toThrow(GitHubTimeoutError);
		await expect(promise).rejects.toThrow("Request timed out after 30s");

		vi.useRealTimers();
	});

	it("propagates request errors as-is (not as timeout)", async () => {
		const originalError = { status: 401 };
		mockRequest.mockRejectedValue(originalError);

		await expect(requestWithTimeout({ url: "https://api.github.com/test" })).rejects.toEqual(
			originalError,
		);
	});

	it("passes request params through to requestUrl", async () => {
		mockRequest.mockResolvedValue(mockResponse());

		const params = {
			url: "https://api.github.com/test",
			method: "POST" as const,
			headers: { Authorization: "Bearer token" },
			body: '{"key":"value"}',
		};

		await requestWithTimeout(params);

		expect(mockRequest).toHaveBeenCalledWith(params);
	});
});
