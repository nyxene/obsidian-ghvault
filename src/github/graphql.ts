import { requestUrl } from "obsidian";
import type { GitHubCommitResult } from "../types";
import { GitHubAuthError, GitHubConflictError, GitHubRateLimitError } from "../types";
import type { Logger } from "../utils/logger";
import type { RateLimiter } from "./rate-limit";

const GRAPHQL_URL = "https://api.github.com/graphql";
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024; // 2MB base64 limit

const CREATE_COMMIT_MUTATION = `
mutation($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit {
      oid
      url
    }
  }
}`;

export interface FileAddition {
	path: string;
	base64Content: string;
}

export interface FileDeletion {
	path: string;
}

export interface CreateCommitOptions {
	branch: string;
	expectedHeadOid: string;
	owner: string;
	repo: string;
	additions: FileAddition[];
	deletions: FileDeletion[];
	message: string;
}

export interface GitHubGraphQLOptions {
	token: string;
	logger: Logger;
	rateLimiter: RateLimiter;
}

export class GitHubGraphQL {
	private readonly token: string;
	private readonly logger: Logger;
	private readonly rateLimiter: RateLimiter;

	constructor(options: GitHubGraphQLOptions) {
		this.token = options.token;
		this.logger = options.logger;
		this.rateLimiter = options.rateLimiter;
	}

	async createCommit(options: CreateCommitOptions): Promise<GitHubCommitResult> {
		const chunks = chunkAdditions(options.additions);
		let headOid = options.expectedHeadOid;
		let result: GitHubCommitResult = { oid: "", url: "" };

		for (let i = 0; i < chunks.length; i++) {
			const isFirst = i === 0;
			const isMultiChunk = chunks.length > 1;
			const message = isMultiChunk
				? `${options.message} (${i + 1}/${chunks.length})`
				: options.message;

			result = await this.executeMutation({
				branch: options.branch,
				owner: options.owner,
				repo: options.repo,
				expectedHeadOid: headOid,
				additions: chunks[i],
				deletions: isFirst ? options.deletions : [],
				message,
			});

			headOid = result.oid;
		}

		// Handle deletions-only (no additions)
		if (chunks.length === 0 && options.deletions.length > 0) {
			result = await this.executeMutation({
				branch: options.branch,
				owner: options.owner,
				repo: options.repo,
				expectedHeadOid: headOid,
				additions: [],
				deletions: options.deletions,
				message: options.message,
			});
		}

		return result;
	}

	private async executeMutation(options: {
		branch: string;
		owner: string;
		repo: string;
		expectedHeadOid: string;
		additions: FileAddition[];
		deletions: FileDeletion[];
		message: string;
	}): Promise<GitHubCommitResult> {
		this.rateLimiter.assertCanMakeRequest("graphql");

		const input = {
			branch: {
				repositoryNameWithOwner: `${options.owner}/${options.repo}`,
				branchName: options.branch,
			},
			expectedHeadOid: options.expectedHeadOid,
			message: { headline: options.message },
			fileChanges: {
				additions: options.additions.map((a) => ({
					path: a.path,
					contents: a.base64Content,
				})),
				deletions: options.deletions.map((d) => ({ path: d.path })),
			},
		};

		this.logger.debug("GraphQL createCommitOnBranch", {
			additions: options.additions.length,
			deletions: options.deletions.length,
		});

		const response = await requestUrl({
			url: GRAPHQL_URL,
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.token}`,
				"Content-Type": "application/json",
				"Cache-Control": "no-cache",
			},
			body: JSON.stringify({
				query: CREATE_COMMIT_MUTATION,
				variables: { input },
			}),
		});

		this.rateLimiter.updateFromHeaders(response.headers, "graphql");

		const body = response.json as {
			data?: { createCommitOnBranch?: { commit: { oid: string; url: string } } };
			errors?: Array<{ type?: string; message: string }>;
		};

		if (body.errors?.length) {
			throw this.handleGraphQLErrors(body.errors);
		}

		const commit = body.data?.createCommitOnBranch?.commit;
		if (!commit) {
			throw new Error("Unexpected GraphQL response: missing commit data");
		}

		this.logger.debug("GraphQL commit created", { oid: commit.oid });
		return { oid: commit.oid, url: commit.url };
	}

	private handleGraphQLErrors(errors: Array<{ type?: string; message: string }>): Error {
		const first = errors[0];

		if (first.type === "FORBIDDEN" || first.message.includes("401")) {
			return new GitHubAuthError();
		}

		if (first.type === "RATE_LIMITED") {
			return new GitHubRateLimitError(new Date(Date.now() + 60_000));
		}

		if (first.message.includes("expected OID") || first.message.includes("stale data")) {
			return new GitHubConflictError("HEAD has changed since last fetch. Pull and retry.");
		}

		this.logger.error("GraphQL errors", { errors });
		return new Error(`GraphQL error: ${first.message}`);
	}
}

// TODO: Files >1.5MB (~2MB base64) cannot fit in a single chunk.
// These need fallback to REST Git Data API (blobs → trees → commits → refs).
// For now, they will be included in a chunk and may cause a GitHub API error.
export function chunkAdditions(additions: FileAddition[]): FileAddition[][] {
	if (additions.length === 0) return [];

	const chunks: FileAddition[][] = [];
	let current: FileAddition[] = [];
	let currentSize = 0;

	for (const addition of additions) {
		const size = addition.base64Content.length;

		if (currentSize + size > MAX_PAYLOAD_BYTES && current.length > 0) {
			chunks.push(current);
			current = [];
			currentSize = 0;
		}

		current.push(addition);
		currentSize += size;
	}

	if (current.length > 0) {
		chunks.push(current);
	}

	return chunks;
}
