import type { RequestUrlResponse } from "obsidian";
import type { FileCommitInfo, GitHubRef, GitHubRepoInfo, GitHubTreeEntry } from "../types";
import {
	GitHubAuthError,
	GitHubConflictError,
	GitHubEmptyRepoError,
	GitHubNotFoundError,
	GitHubRateLimitError,
} from "../types";
import { toBase64 } from "../utils/base64";
import type { Logger } from "../utils/logger";
import type { RateLimiter } from "./rate-limit";
import { requestWithTimeout } from "./request-timeout";

const BASE_URL = "https://api.github.com";
const API_VERSION = "2022-11-28";

export interface GitHubClientOptions {
	token: string;
	owner: string;
	repo: string;
	logger: Logger;
	rateLimiter: RateLimiter;
}

export interface TreeResponse {
	entries: GitHubTreeEntry[];
	truncated: boolean;
}

export interface FileContentResponse {
	content: string;
	sha: string;
	size: number;
}

export class GitHubClient {
	private readonly token: string;
	private readonly owner: string;
	private readonly repo: string;
	private readonly logger: Logger;
	private readonly rateLimiter: RateLimiter;

	constructor(options: GitHubClientOptions) {
		this.token = options.token;
		this.owner = options.owner;
		this.repo = options.repo;
		this.logger = options.logger;
		this.rateLimiter = options.rateLimiter;
	}

	async getRef(branch: string): Promise<GitHubRef> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const data = await this.request<{ ref: string; object: { sha: string } }>(
			`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
		);
		return { ref: data.ref, sha: data.object.sha };
	}

	async getCommit(sha: string): Promise<{ sha: string; treeSha: string }> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const data = await this.request<{ sha: string; tree: { sha: string } }>(
			`/repos/${owner}/${repo}/git/commits/${encodeURIComponent(sha)}`,
		);
		return { sha: data.sha, treeSha: data.tree.sha };
	}

	async getTree(sha: string, recursive = false): Promise<TreeResponse> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const query = recursive ? "?recursive=1" : "";
		const data = await this.request<{ tree: GitHubTreeEntry[]; truncated: boolean }>(
			`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(sha)}${query}`,
		);
		return { entries: data.tree, truncated: data.truncated };
	}

	async getFileContent(path: string, ref?: string): Promise<FileContentResponse> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
		const data = await this.request<{ content: string; sha: string; size: number }>(
			`/repos/${owner}/${repo}/contents/${encodePath(path)}${query}`,
		);
		if (
			typeof data.content !== "string" ||
			typeof data.sha !== "string" ||
			typeof data.size !== "number"
		) {
			throw new Error(`Invalid file content response for ${path}`);
		}
		return { content: data.content, sha: data.sha, size: data.size };
	}

	async getRepoInfo(): Promise<GitHubRepoInfo> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const data = await this.request<{
			name: string;
			full_name: string;
			default_branch: string;
			private: boolean;
		}>(`/repos/${owner}/${repo}`);
		return {
			name: data.name,
			fullName: data.full_name,
			defaultBranch: data.default_branch,
			private: data.private,
		};
	}

	async listBranches(): Promise<string[]> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const data = await this.request<Array<{ name: string }>>(
			`/repos/${owner}/${repo}/branches?per_page=100`,
		);
		return data.map((b) => b.name);
	}

	async listFileCommits(
		path: string,
		branch: string,
		perPage = 20,
		page = 1,
	): Promise<FileCommitInfo[]> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const query = `?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(branch)}&per_page=${perPage}&page=${page}`;
		const data = await this.request<
			Array<{
				sha: string;
				commit: { message: string; author: { name: string; date: string } };
				html_url: string;
			}>
		>(`/repos/${owner}/${repo}/commits${query}`);
		return data.map((c) => ({
			sha: c.sha,
			message: c.commit.message,
			authorName: c.commit.author.name,
			date: c.commit.author.date,
			htmlUrl: c.html_url,
		}));
	}

	async createFile(
		path: string,
		content: string,
		message: string,
		branch?: string,
	): Promise<{ sha: string; commitSha: string }> {
		this.rateLimiter.assertCanMakeRequest("rest");

		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const url = `${BASE_URL}/repos/${owner}/${repo}/contents/${encodePath(path)}`;
		this.logger.debug("GitHub REST createFile", { path, branch });

		const body: Record<string, string> = {
			message,
			content: toBase64(content),
		};
		if (branch) {
			body.branch = branch;
		}

		let response: RequestUrlResponse;
		try {
			response = await requestWithTimeout({
				url,
				method: "PUT",
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": API_VERSION,
					"Cache-Control": "no-cache",
				},
				body: JSON.stringify(body),
			});
		} catch (error: unknown) {
			throw this.handleRequestError(error, path);
		}

		this.rateLimiter.updateFromHeaders(response.headers);
		const data = response.json as {
			content: { sha: string };
			commit: { sha: string };
		};
		return { sha: data.content.sha, commitSha: data.commit.sha };
	}

	private async request<T>(path: string): Promise<T> {
		this.rateLimiter.assertCanMakeRequest("rest");

		const url = `${BASE_URL}${path}`;
		this.logger.debug("GitHub REST request", { method: "GET", url });

		let response: RequestUrlResponse;
		try {
			response = await requestWithTimeout({
				url,
				method: "GET",
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": API_VERSION,
					"Cache-Control": "no-cache",
				},
			});
		} catch (error: unknown) {
			throw this.handleRequestError(error, path);
		}

		this.rateLimiter.updateFromHeaders(response.headers);
		const json = response.json;
		if (json === null || json === undefined) {
			throw new Error(`Invalid API response: expected JSON for ${path}`);
		}
		return json as T;
	}

	private handleRequestError(error: unknown, path: string): Error {
		const status = (error as { status?: number }).status;
		this.logger.debug("handleRequestError", { status, path });

		if (status === 401) {
			return new GitHubAuthError();
		}

		if (status === 403) {
			const resetHeader = (error as { headers?: Record<string, string> }).headers?.[
				"x-ratelimit-remaining"
			];
			if (resetHeader === "0") {
				const resetAt = (error as { headers?: Record<string, string> }).headers?.[
					"x-ratelimit-reset"
				];
				return new GitHubRateLimitError(new Date(Number.parseInt(resetAt ?? "0", 10) * 1000));
			}
			return new GitHubAuthError("Access denied. Check token permissions.");
		}

		if (status === 404) {
			return new GitHubNotFoundError(path);
		}

		if (status === 409) {
			const err = error as Record<string, unknown>;
			const message = String(err.message ?? err.text ?? err.body ?? "");
			if (message.toLowerCase().includes("empty") || path.includes("/git/ref/")) {
				return new GitHubEmptyRepoError();
			}
			return new GitHubConflictError();
		}

		this.logger.error("GitHub API error", { status, path, error: String(error) });
		return error instanceof Error ? error : new Error(String(error));
	}
}

function encodePath(path: string): string {
	return path.split("/").map(encodeURIComponent).join("/");
}
