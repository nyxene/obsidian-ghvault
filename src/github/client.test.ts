import { requestUrl } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GitHubAuthError,
	GitHubConflictError,
	GitHubEmptyRepoError,
	GitHubNotFoundError,
	GitHubRateLimitError,
} from "../types";
import type { Logger } from "../utils/logger";
import { GitHubClient } from "./client";
import { RateLimiter } from "./rate-limit";

const mockRequest = vi.mocked(requestUrl);

function mockResponse(json: unknown, headers: Record<string, string> = {}): void {
	mockRequest.mockResolvedValue({
		json,
		headers: {
			"x-ratelimit-limit": "5000",
			"x-ratelimit-remaining": "4999",
			"x-ratelimit-reset": "1700000000",
			...headers,
		},
		status: 200,
		text: JSON.stringify(json),
		arrayBuffer: new ArrayBuffer(0),
	} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);
}

function mockError(status: number, headers: Record<string, string> = {}): void {
	mockRequest.mockRejectedValue({ status, headers });
}

function createMockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		setLevel: vi.fn(),
	} as unknown as Logger;
}

function createClient(rateLimiter?: RateLimiter): GitHubClient {
	return new GitHubClient({
		token: "test-token",
		owner: "testowner",
		repo: "testrepo",
		logger: createMockLogger(),
		rateLimiter: rateLimiter ?? new RateLimiter(),
	});
}

describe("GitHubClient", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("getRef", () => {
		it("returns ref and sha", async () => {
			mockResponse({ ref: "refs/heads/main", object: { sha: "abc123" } });
			const result = await createClient().getRef("main");
			expect(result).toEqual({ ref: "refs/heads/main", sha: "abc123" });
		});
	});

	describe("getCommit", () => {
		it("returns sha and treeSha", async () => {
			mockResponse({ sha: "abc123", tree: { sha: "tree456" } });
			const result = await createClient().getCommit("abc123");
			expect(result).toEqual({ sha: "abc123", treeSha: "tree456" });
		});
	});

	describe("getTree", () => {
		it("returns entries and truncated flag", async () => {
			mockResponse({
				tree: [{ path: "file.md", mode: "100644", type: "blob", sha: "abc", size: 100 }],
				truncated: false,
			});
			const result = await createClient().getTree("tree456", true);
			expect(result.entries).toHaveLength(1);
			expect(result.entries[0].path).toBe("file.md");
			expect(result.truncated).toBe(false);
		});
	});

	describe("getFileContent", () => {
		it("returns content, sha, and size", async () => {
			mockResponse({ content: "aGVsbG8=", sha: "file-sha", size: 5 });
			const result = await createClient().getFileContent("notes/test.md", "main");
			expect(result).toEqual({ content: "aGVsbG8=", sha: "file-sha", size: 5 });
		});
	});

	describe("getRepoInfo", () => {
		it("maps snake_case to camelCase", async () => {
			mockResponse({
				name: "testrepo",
				full_name: "testowner/testrepo",
				default_branch: "main",
				private: true,
			});
			const result = await createClient().getRepoInfo();
			expect(result).toEqual({
				name: "testrepo",
				fullName: "testowner/testrepo",
				defaultBranch: "main",
				private: true,
			});
		});
	});

	describe("listBranches", () => {
		it("returns branch names", async () => {
			mockResponse([{ name: "main" }, { name: "dev" }]);
			const result = await createClient().listBranches();
			expect(result).toEqual(["main", "dev"]);
		});
	});

	describe("error handling", () => {
		it("throws GitHubAuthError on 401", async () => {
			mockError(401);
			await expect(createClient().getRepoInfo()).rejects.toThrow(GitHubAuthError);
		});

		it("throws GitHubRateLimitError on 403 with remaining=0", async () => {
			mockError(403, {
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": "1700000000",
			});
			await expect(createClient().getRepoInfo()).rejects.toThrow(GitHubRateLimitError);
		});

		it("throws GitHubAuthError on 403 without rate limit", async () => {
			mockError(403, {});
			await expect(createClient().getRepoInfo()).rejects.toThrow(GitHubAuthError);
		});

		it("throws GitHubNotFoundError on 404", async () => {
			mockError(404);
			await expect(createClient().getRepoInfo()).rejects.toThrow(GitHubNotFoundError);
		});

		it("throws GitHubConflictError on 409", async () => {
			mockError(409);
			await expect(createClient().getRepoInfo()).rejects.toThrow(GitHubConflictError);
		});

		it("throws GitHubEmptyRepoError on 409 with empty message", async () => {
			mockRequest.mockRejectedValue({ status: 409, message: "Git Repository is empty." });
			await expect(createClient().getRef("main")).rejects.toThrow(GitHubEmptyRepoError);
		});
	});

	describe("rate limiter integration", () => {
		it("updates rate limiter from response headers", async () => {
			mockResponse(
				{ name: "r", full_name: "o/r", default_branch: "main", private: false },
				{
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4998",
					"x-ratelimit-reset": "1700000000",
				},
			);
			const rateLimiter = new RateLimiter();
			const client = new GitHubClient({
				token: "t",
				owner: "o",
				repo: "r",
				logger: createMockLogger(),
				rateLimiter,
			});
			await client.getRepoInfo();
			expect(rateLimiter.getState("rest")?.remaining).toBe(4998);
		});

		it("throws before request when rate limited", async () => {
			const rateLimiter = new RateLimiter();
			const futureReset = Math.floor(Date.now() / 1000) + 3600;
			rateLimiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": String(futureReset),
			});
			const client = new GitHubClient({
				token: "t",
				owner: "o",
				repo: "r",
				logger: createMockLogger(),
				rateLimiter,
			});
			await expect(client.getRepoInfo()).rejects.toThrow(GitHubRateLimitError);
		});
	});
});
