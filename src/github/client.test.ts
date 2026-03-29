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

	describe("compareCommits", () => {
		it("returns compare result with files", async () => {
			mockResponse({
				status: "ahead",
				ahead_by: 2,
				files: [
					{ filename: "notes/a.md", status: "modified", sha: "sha1" },
					{ filename: "notes/b.md", status: "added", sha: "sha2" },
					{ filename: "old.md", status: "removed", sha: "sha3" },
				],
				commits: [{ sha: "commit1" }, { sha: "commit2" }],
			});
			const result = await createClient().compareCommits("base-sha", "head-sha");
			expect(result.status).toBe("ahead");
			expect(result.aheadBy).toBe(2);
			expect(result.files).toHaveLength(3);
			expect(result.files[0]).toEqual({ filename: "notes/a.md", status: "modified", sha: "sha1" });
			expect(result.headSha).toBe("commit2");
		});

		it("maps renamed files with previousFilename", async () => {
			mockResponse({
				status: "ahead",
				ahead_by: 1,
				files: [
					{
						filename: "new-name.md",
						status: "renamed",
						sha: "sha1",
						previous_filename: "old-name.md",
					},
				],
				commits: [{ sha: "c1" }],
			});
			const result = await createClient().compareCommits("base", "head");
			expect(result.files[0].previousFilename).toBe("old-name.md");
		});

		it("returns empty files for identical status", async () => {
			mockResponse({
				status: "identical",
				ahead_by: 0,
				files: [],
				commits: [],
			});
			const result = await createClient().compareCommits("same", "same");
			expect(result.status).toBe("identical");
			expect(result.files).toHaveLength(0);
		});

		it("returns diverged status", async () => {
			mockResponse({
				status: "diverged",
				ahead_by: 5,
				files: [{ filename: "x.md", status: "modified", sha: "s" }],
				commits: [{ sha: "c" }],
			});
			const result = await createClient().compareCommits("a", "b");
			expect(result.status).toBe("diverged");
		});

		it("filters out unknown file statuses", async () => {
			mockResponse({
				status: "ahead",
				ahead_by: 1,
				files: [
					{ filename: "a.md", status: "modified", sha: "s1" },
					{ filename: "b.md", status: "unchanged", sha: "s2" },
				],
				commits: [{ sha: "c" }],
			});
			const result = await createClient().compareCommits("a", "b");
			expect(result.files).toHaveLength(1);
		});

		it("throws on invalid compare status", async () => {
			mockResponse({
				status: "unknown-status",
				ahead_by: 0,
				files: [],
				commits: [],
			});
			await expect(createClient().compareCommits("a", "b")).rejects.toThrow(
				"Invalid compare status",
			);
		});

		it("falls back headSha to head param when commits array is empty", async () => {
			mockResponse({
				status: "ahead",
				ahead_by: 1,
				files: [{ filename: "a.md", status: "added", sha: "sha1" }],
				commits: [],
			});
			const result = await createClient().compareCommits("base-sha", "head-sha");
			expect(result.headSha).toBe("head-sha");
		});

		it("returns empty files array when files field is undefined", async () => {
			mockResponse({
				status: "behind",
				ahead_by: 0,
				commits: [{ sha: "c1" }],
			});
			const result = await createClient().compareCommits("base", "head");
			expect(result.files).toEqual([]);
			expect(result.headSha).toBe("c1");
		});
	});

	describe("createGist", () => {
		it("returns id and htmlUrl", async () => {
			mockResponse({ id: "gist123", html_url: "https://gist.github.com/gist123" });
			const result = await createClient().createGist({
				filename: "note.md",
				content: "# Hello",
				description: "My note",
				isPublic: false,
			});
			expect(result).toEqual({ id: "gist123", htmlUrl: "https://gist.github.com/gist123" });
		});

		it("sends correct request body", async () => {
			mockResponse({ id: "g1", html_url: "https://gist.github.com/g1" });
			await createClient().createGist({
				filename: "test.md",
				content: "content here",
				description: "desc",
				isPublic: true,
			});

			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0] as { url: string; method: string; body: string };
			expect(arg.url).toBe("https://api.github.com/gists");
			expect(arg.method).toBe("POST");
			const body = JSON.parse(arg.body) as Record<string, unknown>;
			expect(body.description).toBe("desc");
			expect(body.public).toBe(true);
			expect(body.files).toEqual({ "test.md": { content: "content here" } });
		});

		it("throws on invalid response shape", async () => {
			mockResponse({ error: "bad" });
			await expect(
				createClient().createGist({
					filename: "f.md",
					content: "c",
					description: "",
					isPublic: false,
				}),
			).rejects.toThrow("Invalid gist response from GitHub API");
		});

		it("throws GitHubAuthError on 401", async () => {
			mockError(401);
			await expect(
				createClient().createGist({
					filename: "f.md",
					content: "c",
					description: "",
					isPublic: false,
				}),
			).rejects.toThrow(GitHubAuthError);
		});

		it("throws GitHubRateLimitError when rate limited", async () => {
			const rateLimiter = new RateLimiter();
			const futureReset = Math.floor(Date.now() / 1000) + 3600;
			rateLimiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": String(futureReset),
			});
			await expect(
				createClient(rateLimiter).createGist({
					filename: "f.md",
					content: "c",
					description: "",
					isPublic: false,
				}),
			).rejects.toThrow(GitHubRateLimitError);
		});
	});

	describe("updateGist", () => {
		it("returns updated id and htmlUrl", async () => {
			mockResponse({ id: "gist456", html_url: "https://gist.github.com/gist456" });
			const result = await createClient().updateGist("gist456", {
				filename: "note.md",
				content: "# Updated",
				description: "Updated desc",
			});
			expect(result).toEqual({ id: "gist456", htmlUrl: "https://gist.github.com/gist456" });
		});

		it("sends PATCH request with correct body", async () => {
			mockResponse({ id: "g1", html_url: "https://gist.github.com/g1" });
			await createClient().updateGist("g1", {
				filename: "file.md",
				content: "new content",
				description: "new desc",
			});

			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0] as { url: string; method: string; body: string };
			expect(arg.url).toBe("https://api.github.com/gists/g1");
			expect(arg.method).toBe("PATCH");
			const body = JSON.parse(arg.body) as Record<string, unknown>;
			expect(body.description).toBe("new desc");
			expect(body.files).toEqual({ "file.md": { content: "new content" } });
		});

		it("omits description when undefined", async () => {
			mockResponse({ id: "g1", html_url: "https://gist.github.com/g1" });
			await createClient().updateGist("g1", {
				filename: "file.md",
				content: "content",
			});

			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0] as { body: string };
			const body = JSON.parse(arg.body) as Record<string, unknown>;
			expect(body).not.toHaveProperty("description");
		});

		it("throws on invalid response shape", async () => {
			mockResponse({ bad: "shape" });
			await expect(
				createClient().updateGist("g1", { filename: "f.md", content: "c" }),
			).rejects.toThrow("Invalid gist response from GitHub API");
		});
	});

	describe("deleteGist", () => {
		it("succeeds on successful delete", async () => {
			mockRequest.mockResolvedValue({
				json: null,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
				status: 204,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			await expect(createClient().deleteGist("gist789")).resolves.toBeUndefined();
		});

		it("silently handles 404 (already deleted)", async () => {
			mockRequest.mockRejectedValue({ status: 404 });
			await expect(createClient().deleteGist("gone-gist")).resolves.toBeUndefined();
		});

		it("throws GitHubAuthError on 401", async () => {
			mockRequest.mockRejectedValue({ status: 401 });
			await expect(createClient().deleteGist("g1")).rejects.toThrow(GitHubAuthError);
		});

		it("throws when rate limited before request", async () => {
			const rateLimiter = new RateLimiter();
			const futureReset = Math.floor(Date.now() / 1000) + 3600;
			rateLimiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": String(futureReset),
			});
			await expect(createClient(rateLimiter).deleteGist("g1")).rejects.toThrow(
				GitHubRateLimitError,
			);
		});

		it("updates rate limiter headers on success", async () => {
			mockRequest.mockResolvedValue({
				json: null,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4900",
					"x-ratelimit-reset": "1700000000",
				},
				status: 204,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			const rateLimiter = new RateLimiter();
			const client = createClient(rateLimiter);
			await client.deleteGist("gist-to-delete");

			expect(rateLimiter.getState("rest")?.remaining).toBe(4900);
		});
	});

	describe("request() with throw: false", () => {
		it("handles 401 status returned (not thrown) as GitHubAuthError", async () => {
			// With throw: false, Obsidian returns the response instead of throwing.
			// The request() method must check response.status and convert to typed errors.
			mockRequest.mockResolvedValueOnce({
				status: 401,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
				json: { message: "Bad credentials" },
				text: '{"message":"Bad credentials"}',
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			await expect(createClient().getRepoInfo()).rejects.toThrow(GitHubAuthError);
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

			// 304 response (with throw: false, returned as resolved response)
			mockRequest.mockResolvedValueOnce({
				status: 304,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
				json: null,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			const second = await client.getRef("main");
			expect(second).toEqual(first);
		});

		it("updates rate limiter from 304 headers", async () => {
			const refData = { ref: "refs/heads/main", object: { sha: "abc123" } };
			mockResponseOnce(refData, { etag: '"etag-1"' });

			const rateLimiter = new RateLimiter();
			const client = createClient(rateLimiter);
			await client.getRef("main");

			// 304 with updated rate limit (with throw: false, returned as resolved)
			mockRequest.mockResolvedValueOnce({
				status: 304,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4500",
					"x-ratelimit-reset": "1700000000",
				},
				json: null,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

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

		it("throws error when 304 received but no cache exists", async () => {
			const client = createClient();

			mockRequest.mockResolvedValueOnce({
				status: 304,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
				json: null,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			await expect(client.getRef("main")).rejects.toThrow("Invalid API response");
		});
	});

	describe("createRelease", () => {
		it("returns id, htmlUrl, and uploadUrl", async () => {
			mockResponse({
				id: 42,
				html_url: "https://github.com/owner/repo/releases/tag/backup-2026",
				upload_url: "https://uploads.github.com/repos/owner/repo/releases/42/assets{?name,label}",
			});
			const result = await createClient().createRelease({
				tagName: "backup-2026-01-01-120000",
				name: "Vault Backup",
				body: "Test backup",
			});
			expect(result).toEqual({
				id: 42,
				htmlUrl: "https://github.com/owner/repo/releases/tag/backup-2026",
				uploadUrl: "https://uploads.github.com/repos/owner/repo/releases/42/assets{?name,label}",
			});
		});

		it("sends correct POST body", async () => {
			mockResponse({
				id: 1,
				html_url: "https://github.com/owner/repo/releases/tag/t",
				upload_url: "https://uploads.github.com/repos/owner/repo/releases/1/assets{?name,label}",
			});
			await createClient().createRelease({
				tagName: "backup-tag",
				name: "My Release",
				body: "Description here",
			});

			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0] as { url: string; method: string; body: string };
			expect(arg.url).toBe("https://api.github.com/repos/testowner/testrepo/releases");
			expect(arg.method).toBe("POST");
			const body = JSON.parse(arg.body) as Record<string, unknown>;
			expect(body.tag_name).toBe("backup-tag");
			expect(body.name).toBe("My Release");
			expect(body.body).toBe("Description here");
		});

		it("throws on invalid response shape", async () => {
			mockResponse({ bad: "shape" });
			await expect(
				createClient().createRelease({ tagName: "t", name: "n", body: "b" }),
			).rejects.toThrow("Invalid release response from GitHub API");
		});
	});

	describe("uploadReleaseAsset", () => {
		it("strips template from uploadUrl and sends correct content-type", async () => {
			const client = createClient();
			mockRequest.mockResolvedValue({
				json: {
					browser_download_url:
						"https://github.com/owner/repo/releases/download/tag/vault-backup.zip",
					size: 1024,
				},
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
				status: 201,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			const data = new ArrayBuffer(16);
			const result = await client.uploadReleaseAsset(
				"https://uploads.github.com/repos/owner/repo/releases/42/assets{?name,label}",
				"vault-backup.zip",
				data,
			);

			expect(result).toEqual({
				downloadUrl: "https://github.com/owner/repo/releases/download/tag/vault-backup.zip",
				size: 1024,
			});

			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0] as { url: string; method: string; headers: Record<string, string> };
			expect(arg.url).toBe(
				"https://uploads.github.com/repos/owner/repo/releases/42/assets?name=vault-backup.zip",
			);
			expect(arg.method).toBe("POST");
			expect(arg.headers["Content-Type"]).toBe("application/zip");
		});

		it("rejects untrusted upload URL domain", async () => {
			const client = createClient();
			await expect(
				client.uploadReleaseAsset("https://evil.com/steal", "file.zip", new ArrayBuffer(8)),
			).rejects.toThrow("Untrusted upload URL domain");
		});
	});

	describe("listReleases", () => {
		it("filters by backup- prefix and maps to BackupRecord", async () => {
			mockResponse([
				{
					id: 1,
					tag_name: "backup-2026-01-01-120000",
					name: "Vault Backup",
					created_at: "2026-01-01T12:00:00Z",
					html_url: "https://github.com/owner/repo/releases/tag/backup-2026",
					assets: [
						{
							name: "vault-backup.zip",
							size: 2048,
							browser_download_url:
								"https://github.com/owner/repo/releases/download/backup-2026/vault-backup.zip",
						},
					],
				},
				{
					id: 2,
					tag_name: "v1.0.0",
					name: "Release 1.0",
					created_at: "2026-01-02T12:00:00Z",
					html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
					assets: [],
				},
			]);

			const result = await createClient().listReleases();

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({
				id: 1,
				tagName: "backup-2026-01-01-120000",
				name: "Vault Backup",
				createdAt: "2026-01-01T12:00:00Z",
				htmlUrl: "https://github.com/owner/repo/releases/tag/backup-2026",
				assetName: "vault-backup.zip",
				assetSize: 2048,
				assetDownloadUrl:
					"https://github.com/owner/repo/releases/download/backup-2026/vault-backup.zip",
			});
		});

		it("returns empty array when no backup releases exist", async () => {
			mockResponse([
				{
					id: 1,
					tag_name: "v1.0.0",
					name: "Release",
					created_at: "2026-01-01T00:00:00Z",
					html_url: "https://github.com/owner/repo/releases/tag/v1.0.0",
					assets: [],
				},
			]);
			const result = await createClient().listReleases();
			expect(result).toEqual([]);
		});

		it("handles releases with no assets", async () => {
			mockResponse([
				{
					id: 1,
					tag_name: "backup-empty",
					name: "Empty backup",
					created_at: "2026-01-01T00:00:00Z",
					html_url: "https://github.com/owner/repo/releases/tag/backup-empty",
					assets: [],
				},
			]);
			const result = await createClient().listReleases();
			expect(result).toHaveLength(1);
			expect(result[0].assetName).toBe("");
			expect(result[0].assetSize).toBe(0);
			expect(result[0].assetDownloadUrl).toBe("");
		});

		it("throws on invalid response shape", async () => {
			mockResponse({ error: "not an array" });
			await expect(createClient().listReleases()).rejects.toThrow("Invalid releases response");
		});
	});

	describe("deleteRelease", () => {
		it("succeeds on successful delete", async () => {
			mockRequest.mockResolvedValue({
				json: null,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
				status: 204,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			await expect(createClient().deleteRelease(42)).resolves.toBeUndefined();
		});

		it("silently handles 404 (already deleted)", async () => {
			mockRequest.mockRejectedValue({ status: 404 });
			await expect(createClient().deleteRelease(999)).resolves.toBeUndefined();
		});

		it("throws GitHubAuthError on 401", async () => {
			mockRequest.mockRejectedValue({ status: 401 });
			await expect(createClient().deleteRelease(42)).rejects.toThrow(GitHubAuthError);
		});
	});

	describe("downloadReleaseAsset", () => {
		it("returns ArrayBuffer", async () => {
			const client = createClient();
			const fakeData = new ArrayBuffer(32);
			mockRequest.mockResolvedValue({
				json: null,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4998",
					"x-ratelimit-reset": "1700000000",
				},
				status: 200,
				text: "",
				arrayBuffer: fakeData,
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			const result = await client.downloadReleaseAsset(
				"https://github.com/owner/repo/releases/download/tag/vault-backup.zip",
			);

			expect(result).toBe(fakeData);
			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0] as { url: string; headers: Record<string, string> };
			expect(arg.url).toContain("vault-backup.zip");
			expect(arg.headers.Accept).toBe("application/octet-stream");
		});

		it("rejects untrusted download URL domain", async () => {
			const client = createClient();
			await expect(client.downloadReleaseAsset("https://evil.com/steal-token")).rejects.toThrow(
				"Untrusted download URL domain",
			);
		});
	});

	describe("triggerDispatch", () => {
		it("sends POST to dispatches endpoint with event_type", async () => {
			mockResponse(null);
			const client = createClient();
			await client.triggerDispatch("vault-synced");

			expect(mockRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					url: "https://api.github.com/repos/testowner/testrepo/dispatches",
					method: "POST",
				}),
			);
			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const body = JSON.parse((lastCall[0] as { body: string }).body);
			expect(body).toEqual({ event_type: "vault-synced" });
		});

		it("includes client_payload when provided", async () => {
			mockResponse(null);
			const client = createClient();
			await client.triggerDispatch("vault-synced", {
				branch: "main",
				pushed: ["file.md"],
			});

			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const body = JSON.parse((lastCall[0] as { body: string }).body);
			expect(body).toEqual({
				event_type: "vault-synced",
				client_payload: { branch: "main", pushed: ["file.md"] },
			});
		});

		it("throws GitHubAuthError on 401", async () => {
			mockError(401);
			await expect(createClient().triggerDispatch("test")).rejects.toThrow(GitHubAuthError);
		});

		it("asserts rate limit before request", async () => {
			const rateLimiter = new RateLimiter();
			const spy = vi.spyOn(rateLimiter, "assertCanMakeRequest");
			mockResponse(null);
			await createClient(rateLimiter).triggerDispatch("test");
			expect(spy).toHaveBeenCalledWith("rest");
		});
	});

	describe("getPagesConfig", () => {
		it("returns config when Pages is enabled", async () => {
			mockResponse({
				html_url: "https://user.github.io/repo",
				source: { branch: "main", path: "/" },
				build_type: "workflow",
				https_enforced: true,
			});
			const result = await createClient().getPagesConfig();
			expect(result).toEqual({
				htmlUrl: "https://user.github.io/repo",
				source: { branch: "main", path: "/" },
				buildType: "workflow",
				httpsEnforced: true,
			});
		});

		it("falls back to 'workflow' for unknown build_type", async () => {
			mockResponse({
				html_url: "https://user.github.io/repo",
				source: { branch: "main", path: "/" },
				build_type: "actions_v2",
				https_enforced: true,
			});
			const result = await createClient().getPagesConfig();
			expect(result?.buildType).toBe("workflow");
		});

		it("returns null when Pages is not enabled (404)", async () => {
			mockError(404);
			const result = await createClient().getPagesConfig();
			expect(result).toBeNull();
		});

		it("throws GitHubAuthError on 401", async () => {
			mockError(401);
			await expect(createClient().getPagesConfig()).rejects.toThrow(GitHubAuthError);
		});
	});

	describe("createOrUpdateFile", () => {
		it("creates file when it does not exist (404 on GET)", async () => {
			// First call: GET returns 404, second call: PUT succeeds
			mockRequest.mockRejectedValueOnce({ status: 404, headers: {} }).mockResolvedValueOnce({
				json: { content: { sha: "abc" }, commit: { sha: "def" } },
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
				status: 201,
				text: "{}",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			await createClient().createOrUpdateFile(
				".github/workflows/deploy.yml",
				"content",
				"add workflow",
				"main",
			);
			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const putCall = lastCall[0] as { method: string; url: string };
			expect(putCall.method).toBe("PUT");
			expect(putCall.url).toContain(".github/workflows/deploy.yml");
		});

		it("updates file when it exists (GET returns sha)", async () => {
			// First call: GET returns existing file, second call: PUT with sha
			mockRequest
				.mockResolvedValueOnce({
					json: { sha: "existing-sha" },
					headers: {
						"x-ratelimit-limit": "5000",
						"x-ratelimit-remaining": "4999",
						"x-ratelimit-reset": "1700000000",
					},
					status: 200,
					text: "{}",
					arrayBuffer: new ArrayBuffer(0),
				} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never)
				.mockResolvedValueOnce({
					json: { content: { sha: "new" }, commit: { sha: "new-commit" } },
					headers: {
						"x-ratelimit-limit": "5000",
						"x-ratelimit-remaining": "4998",
						"x-ratelimit-reset": "1700000000",
					},
					status: 200,
					text: "{}",
					arrayBuffer: new ArrayBuffer(0),
				} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			await createClient().createOrUpdateFile(
				".github/workflows/deploy.yml",
				"updated content",
				"update workflow",
				"main",
			);
			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const putBody = JSON.parse((lastCall[0] as { body: string }).body);
			expect(putBody.sha).toBe("existing-sha");
		});

		it("throws on PUT failure (e.g. 401)", async () => {
			// First call: GET returns 404 (file doesn't exist), second call: PUT fails with 401
			mockRequest
				.mockRejectedValueOnce({ status: 404, headers: {} })
				.mockRejectedValueOnce({ status: 401, headers: {} });

			await expect(
				createClient().createOrUpdateFile(
					".github/workflows/deploy.yml",
					"content",
					"add workflow",
					"main",
				),
			).rejects.toThrow(GitHubAuthError);
		});

		it("throws on non-404 GET error (e.g. 500)", async () => {
			// First call: GET returns 500 — should propagate, not treat as "file not found"
			mockRequest.mockRejectedValueOnce({ status: 500, headers: {} });

			await expect(
				createClient().createOrUpdateFile(
					".github/workflows/deploy.yml",
					"content",
					"add workflow",
					"main",
				),
			).rejects.toThrow();
		});
	});

	describe("deleteFile", () => {
		it("deletes file when GET returns sha", async () => {
			// First call: GET returns existing file sha, second call: DELETE succeeds
			mockRequest
				.mockResolvedValueOnce({
					json: { sha: "file-sha-to-delete" },
					headers: {
						"x-ratelimit-limit": "5000",
						"x-ratelimit-remaining": "4999",
						"x-ratelimit-reset": "1700000000",
					},
					status: 200,
					text: "{}",
					arrayBuffer: new ArrayBuffer(0),
				} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never)
				.mockResolvedValueOnce({
					json: {},
					headers: {
						"x-ratelimit-limit": "5000",
						"x-ratelimit-remaining": "4998",
						"x-ratelimit-reset": "1700000000",
					},
					status: 200,
					text: "{}",
					arrayBuffer: new ArrayBuffer(0),
				} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			await createClient().deleteFile("notes/old.md", "remove file", "main");

			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const deleteCall = lastCall[0] as { method: string; body: string };
			expect(deleteCall.method).toBe("DELETE");
			const body = JSON.parse(deleteCall.body) as Record<string, unknown>;
			expect(body.sha).toBe("file-sha-to-delete");
			expect(body.message).toBe("remove file");
			expect(body.branch).toBe("main");
		});

		it("silently returns when file is already deleted (404 on GET)", async () => {
			// GET returns 404 via status code on response (throw: false path)
			mockRequest.mockResolvedValueOnce({
				json: {},
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
				status: 404,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			const callsBefore = mockRequest.mock.calls.length;
			await createClient().deleteFile("notes/gone.md", "remove file", "main");

			// Only one request should be made (the GET), no DELETE
			const newCalls = mockRequest.mock.calls.slice(callsBefore);
			expect(newCalls).toHaveLength(1);
			const getCall = newCalls[0][0] as { method?: string };
			expect(getCall.method).toBe("GET");
		});

		it("throws on non-404 GET error", async () => {
			// GET returns 500 — should propagate, not treat as "already deleted"
			mockRequest.mockResolvedValueOnce({
				json: {},
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4999",
					"x-ratelimit-reset": "1700000000",
				},
				status: 500,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			await expect(createClient().deleteFile("notes/file.md", "remove", "main")).rejects.toThrow();
		});

		it("throws when rate limited before DELETE", async () => {
			const rateLimiter = new RateLimiter();

			// GET succeeds (request() checks rate limit internally, but we set it AFTER the GET)
			mockRequest.mockResolvedValueOnce({
				json: { sha: "file-sha" },
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "0",
					"x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
				},
				status: 200,
				text: "{}",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);

			const client = createClient(rateLimiter);
			// After GET, rate limiter is updated with remaining=0 from response headers.
			// The deleteFile method then calls rateLimiter.assertCanMakeRequest("rest") before DELETE.
			await expect(client.deleteFile("notes/file.md", "remove", "main")).rejects.toThrow(
				GitHubRateLimitError,
			);
		});
	});

	describe("getPagesConfig — legacy build type", () => {
		it("returns buildType 'legacy' when API responds with legacy", async () => {
			mockResponse({
				html_url: "https://user.github.io/repo",
				source: { branch: "main", path: "/" },
				build_type: "legacy",
				https_enforced: false,
			});
			const result = await createClient().getPagesConfig();
			expect(result?.buildType).toBe("legacy");
		});
	});

	describe("createBlob", () => {
		it("sends correct URL and body, returns SHA", async () => {
			mockResponse({ sha: "blob-sha-123" });
			const client = createClient();

			const result = await client.createBlob("aGVsbG8gd29ybGQ=");

			expect(result).toBe("blob-sha-123");
			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0] as { url: string; method: string; body: string };
			expect(arg.url).toBe("https://api.github.com/repos/testowner/testrepo/git/blobs");
			expect(arg.method).toBe("POST");
			const body = JSON.parse(arg.body) as Record<string, unknown>;
			expect(body.content).toBe("aGVsbG8gd29ybGQ=");
			expect(body.encoding).toBe("base64");
		});

		it("throws on invalid response shape", async () => {
			mockResponse({ bad: "shape" });
			await expect(createClient().createBlob("abc")).rejects.toThrow(
				"Invalid blob response from GitHub API",
			);
		});
	});

	describe("createTreeFromEntries", () => {
		it("sends correct URL, body format with base_tree and entries, returns SHA", async () => {
			mockResponse({ sha: "tree-sha-456" });
			const client = createClient();

			const result = await client.createTreeFromEntries("base-tree-sha", [
				{ path: "notes/a.md", sha: "blob-sha-1" },
				{ path: "notes/b.md", sha: "blob-sha-2", mode: "100755" },
			]);

			expect(result).toBe("tree-sha-456");
			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0] as { url: string; method: string; body: string };
			expect(arg.url).toBe("https://api.github.com/repos/testowner/testrepo/git/trees");
			expect(arg.method).toBe("POST");
			const body = JSON.parse(arg.body) as Record<string, unknown>;
			expect(body.base_tree).toBe("base-tree-sha");
			const tree = body.tree as Array<Record<string, unknown>>;
			expect(tree).toHaveLength(2);
			expect(tree[0]).toEqual({
				path: "notes/a.md",
				mode: "100644",
				type: "blob",
				sha: "blob-sha-1",
			});
			expect(tree[1]).toEqual({
				path: "notes/b.md",
				mode: "100755",
				type: "blob",
				sha: "blob-sha-2",
			});
		});

		it("throws on invalid response shape", async () => {
			mockResponse({ bad: "shape" });
			await expect(
				createClient().createTreeFromEntries("base", [{ path: "f.md", sha: "s" }]),
			).rejects.toThrow("Invalid tree response from GitHub API");
		});
	});

	describe("createCommitRest", () => {
		it("sends correct URL, body with parents/tree/message, returns SHA", async () => {
			mockResponse({ sha: "commit-sha-789" });
			const client = createClient();

			const result = await client.createCommitRest("tree-sha", "parent-sha", "sync vault");

			expect(result).toBe("commit-sha-789");
			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0] as { url: string; method: string; body: string };
			expect(arg.url).toBe("https://api.github.com/repos/testowner/testrepo/git/commits");
			expect(arg.method).toBe("POST");
			const body = JSON.parse(arg.body) as Record<string, unknown>;
			expect(body.message).toBe("sync vault");
			expect(body.tree).toBe("tree-sha");
			expect(body.parents).toEqual(["parent-sha"]);
		});

		it("throws on invalid response shape", async () => {
			mockResponse({ bad: "shape" });
			await expect(createClient().createCommitRest("t", "p", "m")).rejects.toThrow(
				"Invalid commit response from GitHub API",
			);
		});
	});

	describe("updateRef", () => {
		it("sends PATCH to correct URL with sha in body", async () => {
			mockResponse({ ref: "refs/heads/main" });
			const client = createClient();

			await client.updateRef("main", "new-commit-sha");

			const lastCall = mockRequest.mock.calls[mockRequest.mock.calls.length - 1];
			const arg = lastCall[0] as { url: string; method: string; body: string };
			expect(arg.url).toBe("https://api.github.com/repos/testowner/testrepo/git/refs/heads/main");
			expect(arg.method).toBe("PATCH");
			const body = JSON.parse(arg.body) as Record<string, unknown>;
			expect(body.sha).toBe("new-commit-sha");
		});
	});

	describe("handleRequestError — 409 with /git/ref/ path", () => {
		it("throws GitHubEmptyRepoError when path contains /git/ref/", async () => {
			// When getRef is called on an empty repo, GitHub returns 409.
			// The path will contain /git/ref/ so handleRequestError should return GitHubEmptyRepoError.
			mockRequest.mockRejectedValue({ status: 409 });
			await expect(createClient().getRef("main")).rejects.toThrow(GitHubEmptyRepoError);
		});

		it("throws GitHubConflictError for 409 on non-ref path without empty message", async () => {
			mockRequest.mockRejectedValue({ status: 409 });
			await expect(createClient().createFile("test.md", "content", "msg", "main")).rejects.toThrow(
				GitHubConflictError,
			);
		});
	});

	describe("ETag cache update on 200 after 304", () => {
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

		it("updates cached ETag after 304 followed by 200 with new ETag", async () => {
			const data1 = { ref: "refs/heads/main", object: { sha: "abc123" } };
			const data2 = { ref: "refs/heads/main", object: { sha: "def456" } };

			// First request: 200 with etag-1
			mockResponseOnce(data1, { etag: '"etag-1"' });
			// Second request: 304 (cache hit)
			mockRequest.mockResolvedValueOnce({
				status: 304,
				headers: {
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4998",
					"x-ratelimit-reset": "1700000000",
				},
				json: null,
				text: "",
				arrayBuffer: new ArrayBuffer(0),
			} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);
			// Third request: 200 with new etag-2 and new data
			mockResponseOnce(data2, { etag: '"etag-2"' });

			const client = createClient();

			// First call caches etag-1
			const first = await client.getRef("main");
			expect(first.sha).toBe("abc123");

			// Second call returns cached data (304)
			const second = await client.getRef("main");
			expect(second.sha).toBe("abc123");

			// Third call gets 200 with new data and etag-2
			const third = await client.getRef("main");
			expect(third.sha).toBe("def456");

			// biome-ignore lint/suspicious/noExplicitAny: access private field for testing
			const cache = (client as any).etagCache as Map<string, { etag: string; data: unknown }>;
			const entry = [...cache.values()][0];
			expect(entry.etag).toBe('"etag-2"');
		});
	});
});
