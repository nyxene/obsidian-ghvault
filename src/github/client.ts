import type { RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import type { GitHubRef, GitHubRepoInfo, GitHubTreeEntry } from "../types";
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
		const data = await this.request<{ ref: string; object: { sha: string } }>(
			`/repos/${this.owner}/${this.repo}/git/ref/heads/${branch}`,
		);
		return { ref: data.ref, sha: data.object.sha };
	}

	async getCommit(sha: string): Promise<{ sha: string; treeSha: string }> {
		const data = await this.request<{ sha: string; tree: { sha: string } }>(
			`/repos/${this.owner}/${this.repo}/git/commits/${sha}`,
		);
		return { sha: data.sha, treeSha: data.tree.sha };
	}

	async getTree(sha: string, recursive = false): Promise<TreeResponse> {
		const query = recursive ? "?recursive=1" : "";
		const data = await this.request<{ tree: GitHubTreeEntry[]; truncated: boolean }>(
			`/repos/${this.owner}/${this.repo}/git/trees/${sha}${query}`,
		);
		return { entries: data.tree, truncated: data.truncated };
	}

	async getFileContent(path: string, ref?: string): Promise<FileContentResponse> {
		const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
		const data = await this.request<{ content: string; sha: string; size: number }>(
			`/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}${query}`,
		);
		return { content: data.content, sha: data.sha, size: data.size };
	}

	async getRepoInfo(): Promise<GitHubRepoInfo> {
		const data = await this.request<{
			name: string;
			full_name: string;
			default_branch: string;
			private: boolean;
		}>(`/repos/${this.owner}/${this.repo}`);
		return {
			name: data.name,
			fullName: data.full_name,
			defaultBranch: data.default_branch,
			private: data.private,
		};
	}

	async listBranches(): Promise<string[]> {
		const data = await this.request<Array<{ name: string }>>(
			`/repos/${this.owner}/${this.repo}/branches`,
		);
		return data.map((b) => b.name);
	}

	async createFile(
		path: string,
		content: string,
		message: string,
		branch?: string,
	): Promise<{ sha: string; commitSha: string }> {
		this.rateLimiter.assertCanMakeRequest("rest");

		const url = `${BASE_URL}/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}`;
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
			response = await requestUrl({
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
			response = await requestUrl({
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
		return response.json as T;
	}

	private handleRequestError(error: unknown, path: string): Error {
		const status = (error as { status?: number }).status;
		this.logger.debug("handleRequestError", {
			status,
			path,
			errorKeys: Object.keys(error as object),
		});

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
