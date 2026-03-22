import { requestUrl } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	GitHubAuthError,
	GitHubConflictError,
	GitHubEmptyRepoError,
	GitHubNotFoundError,
	GitHubRateLimitError,
	GitHubTimeoutError,
} from "../types";
import { toBase64 } from "../utils/base64";
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

		it("throws on invalid response shape", async () => {
			mockResponse({ html: "<html>login page</html>" });
			await expect(createClient().getRef("main")).rejects.toThrow("Invalid ref response");
		});
	});

	describe("getCommit", () => {
		it("returns sha and treeSha", async () => {
			mockResponse({ sha: "abc123", tree: { sha: "tree456" } });
			const result = await createClient().getCommit("abc123");
			expect(result).toEqual({ sha: "abc123", treeSha: "tree456" });
		});

		it("throws on invalid response shape", async () => {
			mockResponse({ error: "not found" });
			await expect(createClient().getCommit("bad")).rejects.toThrow("Invalid commit response");
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

		it("throws on invalid response shape", async () => {
			mockResponse({ html: "<html>proxy login</html>" });
			await expect(createClient().getTree("bad")).rejects.toThrow("Invalid tree response");
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

	describe("createFile", () => {
		it("returns sha and commitSha on success", async () => {
			mockRequest.mockResolvedValue({
				json: {
					content: { sha: "file-sha-123" },
					commit: { sha: "commit-sha-456" },
				},
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
				status: 200,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			const client = createClient();
			const result = await client.createFile("notes/test.md", "hello", "add file", "main");

			expect(result).toEqual({ sha: "file-sha-123", commitSha: "commit-sha-456" });
			expect(mockRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					url: "https://api.github.com/repos/testowner/testrepo/contents/notes/test.md",
					method: "PUT",
					body: JSON.stringify({
						message: "add file",
						content: toBase64("hello"),
						branch: "main",
					}),
				}),
			);
		});

		it("does not include branch in body when not provided", async () => {
			mockRequest.mockResolvedValue({
				json: {
					content: { sha: "file-sha" },
					commit: { sha: "commit-sha" },
				},
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
				status: 200,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			const client = createClient();
			await client.createFile("test.md", "data", "create");

			// Find the PUT calls (createFile) among all requestUrl calls
			const putCalls = mockRequest.mock.calls.filter((call) => {
				const arg = call[0] as { method?: string };
				return arg.method === "PUT";
			});
			// The last PUT call is from this test (no branch)
			const lastPut = putCalls[putCalls.length - 1];
			expect(lastPut).toBeDefined();
			const body = (lastPut[0] as { body?: string }).body ?? "";
			const parsed = JSON.parse(body) as Record<string, unknown>;
			expect(parsed).not.toHaveProperty("branch");
			expect(parsed.message).toBe("create");
			expect(parsed.content).toBe(toBase64("data"));
		});

		it("throws GitHubConflictError on 422/409 conflict", async () => {
			mockRequest.mockRejectedValue({ status: 409 });
			await expect(
				createClient().createFile("existing.md", "content", "add file", "main"),
			).rejects.toThrow(GitHubConflictError);
		});

		it("throws GitHubAuthError on 401", async () => {
			mockRequest.mockRejectedValue({ status: 401 });
			await expect(createClient().createFile("file.md", "content", "add file")).rejects.toThrow(
				GitHubAuthError,
			);
		});

		it("throws GitHubNotFoundError on 404", async () => {
			mockRequest.mockRejectedValue({ status: 404 });
			await expect(createClient().createFile("file.md", "content", "add file")).rejects.toThrow(
				GitHubNotFoundError,
			);
		});

		it("throws when rate limited before request", async () => {
			const rateLimiter = new RateLimiter();
			const futureReset = Math.floor(Date.now() / 1000) + 3600;
			rateLimiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": String(futureReset),
			});
			const client = createClient(rateLimiter);
			await expect(client.createFile("file.md", "content", "add file")).rejects.toThrow(
				GitHubRateLimitError,
			);
		});
	});

	describe("getFileContent — malformed response", () => {
		it("throws on missing content field", async () => {
			mockResponse({ sha: "abc", size: 5 });
			await expect(createClient().getFileContent("test.md")).rejects.toThrow(
				"Invalid file content response for test.md",
			);
		});

		it("throws on missing sha field", async () => {
			mockResponse({ content: "aGVsbG8=", size: 5 });
			await expect(createClient().getFileContent("test.md")).rejects.toThrow(
				"Invalid file content response for test.md",
			);
		});

		it("throws on missing size field", async () => {
			mockResponse({ content: "aGVsbG8=", sha: "abc" });
			await expect(createClient().getFileContent("test.md")).rejects.toThrow(
				"Invalid file content response for test.md",
			);
		});

		it("throws when content is not a string", async () => {
			mockResponse({ content: 123, sha: "abc", size: 5 });
			await expect(createClient().getFileContent("test.md")).rejects.toThrow(
				"Invalid file content response for test.md",
			);
		});

		it("throws when sha is not a string", async () => {
			mockResponse({ content: "aGVsbG8=", sha: null, size: 5 });
			await expect(createClient().getFileContent("test.md")).rejects.toThrow(
				"Invalid file content response for test.md",
			);
		});

		it("throws when size is not a number", async () => {
			mockResponse({ content: "aGVsbG8=", sha: "abc", size: "5" });
			await expect(createClient().getFileContent("test.md")).rejects.toThrow(
				"Invalid file content response for test.md",
			);
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

	describe("timeout", () => {
		it("throws GitHubTimeoutError when request hangs on GET", async () => {
			vi.useFakeTimers();
			mockRequest.mockReturnValue(new Promise(() => {}) as ReturnType<typeof requestUrl>);

			const promise = createClient().getRepoInfo();
			vi.advanceTimersByTime(30_000);

			await expect(promise).rejects.toThrow(GitHubTimeoutError);
			await expect(promise).rejects.toThrow("Request timed out after 30s");
			vi.useRealTimers();
		});

		it("throws GitHubTimeoutError when request hangs on PUT (createFile)", async () => {
			vi.useFakeTimers();
			mockRequest.mockReturnValue(new Promise(() => {}) as ReturnType<typeof requestUrl>);

			const promise = createClient().createFile("test.md", "content", "add file");
			vi.advanceTimersByTime(30_000);

			await expect(promise).rejects.toThrow(GitHubTimeoutError);
			vi.useRealTimers();
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

	describe("listFileCommits", () => {
		it("returns mapped commit info", async () => {
			const client = createClient();
			mockResponse([
				{
					sha: "abc123",
					commit: {
						message: "vault sync: 1 file(s)",
						author: { name: "John", date: "2026-03-15T10:00:00Z" },
					},
					html_url: "https://github.com/owner/repo/commit/abc123",
				},
				{
					sha: "def456",
					commit: {
						message: "initial commit",
						author: { name: "Jane", date: "2026-03-14T09:00:00Z" },
					},
					html_url: "https://github.com/owner/repo/commit/def456",
				},
			]);

			const commits = await client.listFileCommits("docs/note.md", "main");

			expect(commits).toHaveLength(2);
			expect(commits[0]).toEqual({
				sha: "abc123",
				message: "vault sync: 1 file(s)",
				authorName: "John",
				date: "2026-03-15T10:00:00Z",
				htmlUrl: "https://github.com/owner/repo/commit/abc123",
			});
			expect(commits[1].authorName).toBe("Jane");
		});

		it("passes path, branch, perPage, page as query params", async () => {
			const client = createClient();
			mockResponse([]);

			await client.listFileCommits("folder/file.md", "develop", 10, 3);

			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0];
			const url = typeof arg === "string" ? arg : (arg as { url: string }).url;
			expect(url).toContain("path=folder%2Ffile.md");
			expect(url).toContain("sha=develop");
			expect(url).toContain("per_page=10");
			expect(url).toContain("page=3");
		});

		it("returns empty array when no commits", async () => {
			const client = createClient();
			mockResponse([]);

			const commits = await client.listFileCommits("new.md", "main");

			expect(commits).toEqual([]);
		});

		it("throws on invalid response shape", async () => {
			const client = createClient();
			mockResponse({ error: "not a list" });
			await expect(client.listFileCommits("file.md", "main")).rejects.toThrow(
				"Invalid commits response",
			);
		});
	});

	describe("downloadZipball", () => {
		it("returns arrayBuffer from zipball endpoint", async () => {
			const client = createClient();
			const fakeZip = new ArrayBuffer(16);
			mockRequest.mockResolvedValue({
				json: null,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4998",
					"x-ratelimit-reset": "1700000000",
				},
				status: 200,
				text: "",
				arrayBuffer: fakeZip,
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			const result = await client.downloadZipball("main");

			expect(result).toBe(fakeZip);
			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0];
			const url = typeof arg === "string" ? arg : (arg as { url: string }).url;
			expect(url).toContain("/zipball/main");
		});
	});

	describe("ETag conditional requests", () => {
		beforeEach(() => {
			mockRequest.mockReset();
		});

		function mockResponseOnce(json: unknown, headers: Record<string, string> = {}): void {
			mockRequest.mockResolvedValueOnce({
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

		it("caches ETag from response", async () => {
			const refData = { ref: "refs/heads/main", object: { sha: "abc123" } };
			mockResponseOnce(refData, { etag: '"etag-value-1"' });

			const client = createClient();
			await client.getRef("main");

			// biome-ignore lint/suspicious/noExplicitAny: access private field for testing
			const cache = (client as any).etagCache as Map<string, { etag: string; data: unknown }>;
			expect(cache.size).toBe(1);
			const entry = [...cache.values()][0];
			expect(entry.etag).toBe('"etag-value-1"');
		});

		it("sends If-None-Match on subsequent request when ETag cached", async () => {
			const refData = { ref: "refs/heads/main", object: { sha: "abc123" } };
			mockResponseOnce(refData, { etag: '"etag-value-1"' });
			mockResponseOnce(refData, { etag: '"etag-value-1"' });

			const client = createClient();
			await client.getRef("main");
			await client.getRef("main");

			const secondCall = mockRequest.mock.calls[1][0] as { headers: Record<string, string> };
			expect(secondCall.headers["If-None-Match"]).toBe('"etag-value-1"');
		});

		it("returns cached data on 304 Not Modified", async () => {
			const refData = { ref: "refs/heads/main", object: { sha: "abc123" } };
			mockResponseOnce(refData, { etag: '"etag-value-1"' });

			const client = createClient();
			const first = await client.getRef("main");

			// 304 response (thrown as error by requestUrl)
			mockRequest.mockRejectedValueOnce({
				status: 304,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
			});

			const second = await client.getRef("main");
			expect(second).toEqual(first);
		});

		it("updates rate limiter from 304 headers", async () => {
			const refData = { ref: "refs/heads/main", object: { sha: "abc123" } };
			mockResponseOnce(refData, { etag: '"etag-1"' });

			const rateLimiter = new RateLimiter();
			const client = createClient(rateLimiter);
			await client.getRef("main");

			// 304 with updated rate limit
			mockRequest.mockRejectedValueOnce({
				status: 304,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4500",
					"x-ratelimit-reset": "1700000000",
				},
			});

			await client.getRef("main");
			const state = rateLimiter.getState("rest");
			expect(state?.remaining).toBe(4500);
		});

		it("updates cache when server returns 200 with new ETag", async () => {
			const data1 = { ref: "refs/heads/main", object: { sha: "abc123" } };
			const data2 = { ref: "refs/heads/main", object: { sha: "def456" } };

			mockResponseOnce(data1, { etag: '"etag-1"' });
			mockResponseOnce(data2, { etag: '"etag-2"' });
			mockResponseOnce(data2, { etag: '"etag-2"' });

			const client = createClient();
			await client.getRef("main");

			const result = await client.getRef("main");
			expect(result.sha).toBe("def456");

			// Third request should use new ETag
			await client.getRef("main");
			const thirdCall = mockRequest.mock.calls[2][0] as { headers: Record<string, string> };
			expect(thirdCall.headers["If-None-Match"]).toBe('"etag-2"');
		});

		it("does not send If-None-Match on first request", async () => {
			mockResponseOnce({ ref: "refs/heads/main", object: { sha: "abc123" } });

			const client = createClient();
			await client.getRef("main");

			const firstCall = mockRequest.mock.calls[0][0] as { headers: Record<string, string> };
			expect(firstCall.headers["If-None-Match"]).toBeUndefined();
		});

		it("does not cache when response has no ETag header", async () => {
			mockResponseOnce({ ref: "refs/heads/main", object: { sha: "abc123" } });
			mockResponseOnce({ ref: "refs/heads/main", object: { sha: "abc123" } });

			const client = createClient();
			await client.getRef("main");
			await client.getRef("main");

			const secondCall = mockRequest.mock.calls[1][0] as { headers: Record<string, string> };
			expect(secondCall.headers["If-None-Match"]).toBeUndefined();
		});

		it("throws non-304 errors normally even when cache exists", async () => {
			const refData = { ref: "refs/heads/main", object: { sha: "abc123" } };
			mockResponseOnce(refData, { etag: '"etag-1"' });

			const client = createClient();
			await client.getRef("main");

			mockError(401);
			await expect(client.getRef("main")).rejects.toThrow();
		});

		it("throws 304 as error when no cache exists", async () => {
			const client = createClient();

			mockRequest.mockRejectedValueOnce({
				status: 304,
				headers: {},
			});

			await expect(client.getRef("main")).rejects.toBeDefined();
		});
	});
});
