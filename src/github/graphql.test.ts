import type { RequestUrlParam } from "obsidian";
import { requestUrl } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	GitHubAuthError,
	GitHubConflictError,
	GitHubRateLimitError,
	GitHubTimeoutError,
} from "../types";
import type { Logger } from "../utils/logger";
import type { FileAddition } from "./graphql";
import { chunkAdditions, GitHubGraphQL } from "./graphql";
import { RateLimiter } from "./rate-limit";

const mockRequest = vi.mocked(requestUrl);

function mockGraphQLResponse(oid: string, url = "https://github.com/commit"): void {
	mockRequest.mockResolvedValue({
		json: {
			data: {
				createCommitOnBranch: {
					commit: { oid, url },
				},
			},
		},
		headers: {},
		status: 200,
		text: "",
		arrayBuffer: new ArrayBuffer(0),
	} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);
}

function mockGraphQLError(errors: Array<{ type?: string; message: string }>): void {
	mockRequest.mockResolvedValue({
		json: { errors },
		headers: {},
		status: 200,
		text: "",
		arrayBuffer: new ArrayBuffer(0),
	} as ReturnType<typeof requestUrl> extends Promise<infer R> ? R : never);
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

function createGraphQL(): GitHubGraphQL {
	return new GitHubGraphQL({
		token: "test-token",
		logger: createMockLogger(),
		rateLimiter: new RateLimiter(),
	});
}

const baseOptions = {
	branch: "main",
	owner: "testowner",
	repo: "testrepo",
	expectedHeadOid: "abc123",
	message: "test commit",
};

describe("GitHubGraphQL", () => {
	afterEach(() => {
		mockRequest.mockReset();
	});

	describe("createCommit", () => {
		it("creates a single commit for small payload", async () => {
			mockGraphQLResponse("new-oid-1");
			const gql = createGraphQL();

			const result = await gql.createCommit({
				...baseOptions,
				additions: [{ path: "file.md", base64Content: "aGVsbG8=" }],
				deletions: [],
			});

			expect(result.oid).toBe("new-oid-1");
			expect(mockRequest).toHaveBeenCalledOnce();
		});

		it("includes deletions in the mutation", async () => {
			mockGraphQLResponse("new-oid-2");
			const gql = createGraphQL();

			await gql.createCommit({
				...baseOptions,
				additions: [{ path: "new.md", base64Content: "Y29udGVudA==" }],
				deletions: [{ path: "old.md" }],
			});

			const body = JSON.parse((mockRequest.mock.calls[0][0] as RequestUrlParam).body as string);
			expect(body.variables.input.fileChanges.deletions).toEqual([{ path: "old.md" }]);
		});

		it("handles deletions-only commit", async () => {
			mockGraphQLResponse("del-oid");
			const gql = createGraphQL();

			const result = await gql.createCommit({
				...baseOptions,
				additions: [],
				deletions: [{ path: "removed.md" }],
			});

			expect(result.oid).toBe("del-oid");
			expect(mockRequest).toHaveBeenCalledOnce();
		});

		it("chunks large payloads into multiple commits", async () => {
			let callCount = 0;
			mockRequest.mockImplementation((() => {
				callCount++;
				return Promise.resolve({
					json: {
						data: {
							createCommitOnBranch: {
								commit: { oid: `oid-${callCount}`, url: "https://url" },
							},
						},
					},
					headers: {},
					status: 200,
					text: "",
					arrayBuffer: new ArrayBuffer(0),
				});
			}) as unknown as typeof requestUrl);

			const gql = createGraphQL();

			// Create additions that exceed 2MB
			const largeContent = "a".repeat(1.5 * 1024 * 1024); // ~1.5MB each
			const result = await gql.createCommit({
				...baseOptions,
				additions: [
					{ path: "file1.md", base64Content: largeContent },
					{ path: "file2.md", base64Content: largeContent },
				],
				deletions: [{ path: "old.md" }],
			});

			expect(mockRequest).toHaveBeenCalledTimes(2);
			expect(result.oid).toBe("oid-2");

			// Deletions only in first chunk
			const firstBody = JSON.parse(
				(mockRequest.mock.calls[0][0] as RequestUrlParam).body as string,
			);
			const secondBody = JSON.parse(
				(mockRequest.mock.calls[1][0] as RequestUrlParam).body as string,
			);
			expect(firstBody.variables.input.fileChanges.deletions).toHaveLength(1);
			expect(secondBody.variables.input.fileChanges.deletions).toHaveLength(0);

			// Second call uses OID from first
			expect(secondBody.variables.input.expectedHeadOid).toBe("oid-1");
		});
	});

	describe("timeout", () => {
		it("throws GitHubTimeoutError when GraphQL request hangs", async () => {
			vi.useFakeTimers();
			mockRequest.mockReturnValue(new Promise(() => {}) as ReturnType<typeof requestUrl>);

			const promise = createGraphQL().createCommit({
				...baseOptions,
				additions: [{ path: "f.md", base64Content: "x" }],
				deletions: [],
			});

			vi.advanceTimersByTime(30_000);

			await expect(promise).rejects.toThrow(GitHubTimeoutError);
			await expect(promise).rejects.toThrow("Request timed out after 30s");
			vi.useRealTimers();
		});
	});

	describe("error handling", () => {
		it("throws GitHubAuthError on FORBIDDEN", async () => {
			mockGraphQLError([{ type: "FORBIDDEN", message: "forbidden" }]);
			await expect(
				createGraphQL().createCommit({
					...baseOptions,
					additions: [{ path: "f.md", base64Content: "x" }],
					deletions: [],
				}),
			).rejects.toThrow(GitHubAuthError);
		});

		it("throws GitHubRateLimitError on RATE_LIMITED", async () => {
			mockGraphQLError([{ type: "RATE_LIMITED", message: "rate limited" }]);
			await expect(
				createGraphQL().createCommit({
					...baseOptions,
					additions: [{ path: "f.md", base64Content: "x" }],
					deletions: [],
				}),
			).rejects.toThrow(GitHubRateLimitError);
		});

		it("throws GitHubConflictError on stale OID", async () => {
			mockGraphQLError([{ message: "expected OID does not match" }]);
			await expect(
				createGraphQL().createCommit({
					...baseOptions,
					additions: [{ path: "f.md", base64Content: "x" }],
					deletions: [],
				}),
			).rejects.toThrow(GitHubConflictError);
		});

		it("throws generic error for unknown GraphQL errors", async () => {
			mockGraphQLError([{ message: "something unexpected" }]);
			await expect(
				createGraphQL().createCommit({
					...baseOptions,
					additions: [{ path: "f.md", base64Content: "x" }],
					deletions: [],
				}),
			).rejects.toThrow("GraphQL error: something unexpected");
		});
	});
});

describe("chunkAdditions", () => {
	it("returns empty array for no additions", () => {
		expect(chunkAdditions([])).toEqual([]);
	});

	it("returns single chunk for small payload", () => {
		const additions: FileAddition[] = [
			{ path: "a.md", base64Content: "abc" },
			{ path: "b.md", base64Content: "def" },
		];
		const chunks = chunkAdditions(additions);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toHaveLength(2);
	});

	it("splits into multiple chunks when exceeding 2MB", () => {
		const content = "x".repeat(1.2 * 1024 * 1024); // ~1.2MB each
		const additions: FileAddition[] = [
			{ path: "a.md", base64Content: content },
			{ path: "b.md", base64Content: content },
			{ path: "c.md", base64Content: content },
		];
		const chunks = chunkAdditions(additions);
		expect(chunks.length).toBeGreaterThan(1);
	});

	it("keeps single large file in its own chunk", () => {
		const small = "x".repeat(100);
		const large = "x".repeat(2 * 1024 * 1024);
		const additions: FileAddition[] = [
			{ path: "large.md", base64Content: large },
			{ path: "small.md", base64Content: small },
			{ path: "small2.md", base64Content: small },
		];
		const chunks = chunkAdditions(additions);
		expect(chunks.length).toBe(2);
		expect(chunks[0]).toHaveLength(1);
		expect(chunks[1]).toHaveLength(2);
	});
});
