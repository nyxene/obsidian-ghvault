import type { RequestUrlResponse } from "obsidian";
import type {
	BackupRecord,
	FileCommitInfo,
	GitHubRef,
	GitHubRepoInfo,
	GitHubTreeEntry,
	PagesConfig,
} from "../types";
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

const VALID_COMPARE_STATUSES = new Set(["ahead", "behind", "diverged", "identical"]);

const TRUSTED_GITHUB_DOMAINS = [
	"github.com",
	"uploads.github.com",
	"objects.githubusercontent.com",
];

function isTrustedGitHubUrl(url: string): boolean {
	try {
		const hostname = new URL(url).hostname;
		return TRUSTED_GITHUB_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
	} catch {
		return false;
	}
}
const VALID_FILE_STATUSES = new Set(["added", "modified", "removed", "renamed"]);
const VALID_BUILD_TYPES = new Set<string>(["workflow", "legacy"]);

function parseBuildType(value: string): "workflow" | "legacy" {
	return VALID_BUILD_TYPES.has(value) ? (value as "workflow" | "legacy") : "workflow";
}

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

export type CompareStatus = "ahead" | "behind" | "diverged" | "identical";
export type CompareFileStatus = "added" | "modified" | "removed" | "renamed";

export interface CompareFile {
	filename: string;
	status: CompareFileStatus;
	sha: string;
	previousFilename?: string;
}

export interface CompareResult {
	status: CompareStatus;
	aheadBy: number;
	files: CompareFile[];
	headSha: string;
}

interface ETagCacheEntry {
	etag: string;
	data: unknown;
}

export class GitHubClient {
	private readonly token: string;
	private readonly owner: string;
	private readonly repo: string;
	private readonly logger: Logger;
	private readonly rateLimiter: RateLimiter;
	private readonly etagCache = new Map<string, ETagCacheEntry>();

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
		if (typeof data.ref !== "string" || typeof data.object?.sha !== "string") {
			throw new Error("Invalid ref response from GitHub API");
		}
		return { ref: data.ref, sha: data.object.sha };
	}

	async getCommit(sha: string): Promise<{ sha: string; treeSha: string }> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const data = await this.request<{ sha: string; tree: { sha: string } }>(
			`/repos/${owner}/${repo}/git/commits/${encodeURIComponent(sha)}`,
		);
		if (typeof data.sha !== "string" || typeof data.tree?.sha !== "string") {
			throw new Error("Invalid commit response from GitHub API");
		}
		return { sha: data.sha, treeSha: data.tree.sha };
	}

	async getTree(sha: string, recursive = false): Promise<TreeResponse> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const query = recursive ? "?recursive=1" : "";
		const data = await this.request<{ tree: GitHubTreeEntry[]; truncated: boolean }>(
			`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(sha)}${query}`,
		);
		if (!Array.isArray(data.tree)) {
			throw new Error("Invalid tree response from GitHub API");
		}
		return { entries: data.tree, truncated: !!data.truncated };
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
		if (!Array.isArray(data)) {
			throw new Error("Invalid commits response from GitHub API");
		}
		return data.map((c) => ({
			sha: c.sha,
			message: c.commit?.message ?? "",
			authorName: c.commit?.author?.name ?? "Unknown",
			date: c.commit?.author?.date ?? "",
			htmlUrl: c.html_url ?? "",
		}));
	}

	async compareCommits(base: string, head: string): Promise<CompareResult> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const data = await this.request<{
			status: string;
			ahead_by: number;
			files?: Array<{
				filename: string;
				status: string;
				sha: string;
				previous_filename?: string;
			}>;
			commits: Array<{ sha: string }>;
		}>(`/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`);

		if (!VALID_COMPARE_STATUSES.has(data.status)) {
			throw new Error(`Invalid compare status: ${data.status}`);
		}

		const files: CompareFile[] = (data.files ?? [])
			.filter((f) => VALID_FILE_STATUSES.has(f.status))
			.map((f) => ({
				filename: f.filename,
				status: f.status as CompareFileStatus,
				sha: f.sha,
				...(f.previous_filename ? { previousFilename: f.previous_filename } : {}),
			}));

		return {
			status: data.status as CompareStatus,
			aheadBy: data.ahead_by,
			files,
			headSha: data.commits.length > 0 ? data.commits[data.commits.length - 1].sha : head,
		};
	}

	async downloadZipball(ref: string): Promise<ArrayBuffer> {
		this.rateLimiter.assertCanMakeRequest("rest");
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const url = `${BASE_URL}/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`;
		const response = await requestWithTimeout({
			url,
			method: "GET",
			headers: {
				Authorization: `Bearer ${this.token}`,
				"X-GitHub-Api-Version": API_VERSION,
			},
		});
		this.rateLimiter.updateFromHeaders(response.headers);
		return response.arrayBuffer;
	}

	async createGist(options: {
		filename: string;
		content: string;
		description: string;
		isPublic: boolean;
	}): Promise<{ id: string; htmlUrl: string }> {
		const data = await this.post<{ id: string; html_url: string }>("/gists", {
			description: options.description,
			public: options.isPublic,
			files: { [options.filename]: { content: options.content } },
		});
		if (typeof data.id !== "string" || typeof data.html_url !== "string") {
			throw new Error("Invalid gist response from GitHub API");
		}
		return { id: data.id, htmlUrl: data.html_url };
	}

	async updateGist(
		gistId: string,
		options: { filename: string; content: string; description?: string },
	): Promise<{ id: string; htmlUrl: string }> {
		const body: Record<string, unknown> = {
			files: { [options.filename]: { content: options.content } },
		};
		if (options.description !== undefined) {
			body.description = options.description;
		}
		const data = await this.post<{ id: string; html_url: string }>(
			`/gists/${encodeURIComponent(gistId)}`,
			body,
			"PATCH",
		);
		if (typeof data.id !== "string" || typeof data.html_url !== "string") {
			throw new Error("Invalid gist response from GitHub API");
		}
		return { id: data.id, htmlUrl: data.html_url };
	}

	async deleteGist(gistId: string): Promise<void> {
		this.rateLimiter.assertCanMakeRequest("rest");
		const url = `${BASE_URL}/gists/${encodeURIComponent(gistId)}`;
		this.logger.debug("GitHub REST deleteGist", { gistId });
		try {
			const response = await requestWithTimeout({
				url,
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": API_VERSION,
				},
			});
			this.rateLimiter.updateFromHeaders(response.headers);
		} catch (error: unknown) {
			const status = (error as { status?: number }).status;
			if (status === 404) return; // Already deleted
			throw this.handleRequestError(error, `/gists/${gistId}`);
		}
	}

	async createRelease(options: {
		tagName: string;
		name: string;
		body: string;
	}): Promise<{ id: number; htmlUrl: string; uploadUrl: string }> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const data = await this.post<{ id: number; html_url: string; upload_url: string }>(
			`/repos/${owner}/${repo}/releases`,
			{
				tag_name: options.tagName,
				name: options.name,
				body: options.body,
			},
		);
		if (
			typeof data.id !== "number" ||
			typeof data.html_url !== "string" ||
			typeof data.upload_url !== "string"
		) {
			throw new Error("Invalid release response from GitHub API");
		}
		return { id: data.id, htmlUrl: data.html_url, uploadUrl: data.upload_url };
	}

	async uploadReleaseAsset(
		uploadUrl: string,
		filename: string,
		data: ArrayBuffer,
	): Promise<{ downloadUrl: string; size: number }> {
		if (!isTrustedGitHubUrl(uploadUrl)) {
			throw new Error(`Untrusted upload URL domain: ${uploadUrl}`);
		}
		this.rateLimiter.assertCanMakeRequest("rest");
		// Strip {?name,label} template from upload URL and append filename
		const cleanUrl = uploadUrl.replace(/\{[^}]*\}/, "");
		const url = `${cleanUrl}?name=${encodeURIComponent(filename)}`;
		this.logger.debug("GitHub REST uploadReleaseAsset", { url, size: data.byteLength });

		const response = await requestWithTimeout(
			{
				url,
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/vnd.github+json",
					"Content-Type": "application/zip",
					"X-GitHub-Api-Version": API_VERSION,
				},
				body: data,
			},
			120_000,
		);
		this.rateLimiter.updateFromHeaders(response.headers);
		const json = response.json as { browser_download_url: string; size: number };
		return { downloadUrl: json.browser_download_url, size: json.size };
	}

	async listReleases(perPage = 30): Promise<BackupRecord[]> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const data = await this.request<
			Array<{
				id: number;
				tag_name: string;
				name: string;
				created_at: string;
				html_url: string;
				assets: Array<{
					name: string;
					size: number;
					browser_download_url: string;
				}>;
			}>
		>(`/repos/${owner}/${repo}/releases?per_page=${perPage}`);

		if (!Array.isArray(data)) {
			throw new Error("Invalid releases response from GitHub API");
		}

		return data
			.filter((r) => r.tag_name.startsWith("backup-"))
			.map((r) => ({
				id: r.id,
				tagName: r.tag_name,
				name: r.name ?? r.tag_name,
				createdAt: r.created_at,
				htmlUrl: r.html_url,
				assetName: r.assets[0]?.name ?? "",
				assetSize: r.assets[0]?.size ?? 0,
				assetDownloadUrl: r.assets[0]?.browser_download_url ?? "",
			}));
	}

	async deleteRelease(releaseId: number): Promise<void> {
		this.rateLimiter.assertCanMakeRequest("rest");
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const url = `${BASE_URL}/repos/${owner}/${repo}/releases/${releaseId}`;
		this.logger.debug("GitHub REST deleteRelease", { releaseId });
		try {
			const response = await requestWithTimeout({
				url,
				method: "DELETE",
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": API_VERSION,
				},
			});
			this.rateLimiter.updateFromHeaders(response.headers);
		} catch (error: unknown) {
			const status = (error as { status?: number }).status;
			if (status === 404) return; // Already deleted
			throw this.handleRequestError(error, `/releases/${releaseId}`);
		}
	}

	async downloadReleaseAsset(downloadUrl: string): Promise<ArrayBuffer> {
		if (!isTrustedGitHubUrl(downloadUrl)) {
			throw new Error(`Untrusted download URL domain: ${downloadUrl}`);
		}
		this.rateLimiter.assertCanMakeRequest("rest");
		this.logger.debug("GitHub REST downloadReleaseAsset", { url: downloadUrl });
		const response = await requestWithTimeout(
			{
				url: downloadUrl,
				method: "GET",
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/octet-stream",
					"X-GitHub-Api-Version": API_VERSION,
				},
			},
			120_000,
		);
		this.rateLimiter.updateFromHeaders(response.headers);
		return response.arrayBuffer;
	}

	async triggerDispatch(eventType: string, clientPayload?: Record<string, unknown>): Promise<void> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const url = `${BASE_URL}/repos/${owner}/${repo}/dispatches`;

		this.rateLimiter.assertCanMakeRequest("rest");
		this.logger.debug("GitHub REST triggerDispatch", { eventType });

		try {
			const response = await requestWithTimeout({
				url,
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": API_VERSION,
				},
				body: JSON.stringify({
					event_type: eventType,
					...(clientPayload ? { client_payload: clientPayload } : {}),
				}),
			});
			this.rateLimiter.updateFromHeaders(response.headers);
		} catch (error: unknown) {
			throw this.handleRequestError(error, `/repos/${owner}/${repo}/dispatches`);
		}
	}

	async getPagesConfig(): Promise<PagesConfig | null> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		try {
			const data = await this.request<{
				html_url: string;
				source: { branch: string; path: string };
				build_type: string;
				https_enforced: boolean;
			}>(`/repos/${owner}/${repo}/pages`);
			return {
				htmlUrl: data.html_url,
				source: data.source,
				buildType: parseBuildType(data.build_type),
				httpsEnforced: data.https_enforced,
			};
		} catch (error: unknown) {
			if (error instanceof GitHubNotFoundError) return null;
			throw error;
		}
	}

	async createOrUpdateFile(
		path: string,
		content: string,
		message: string,
		branch: string,
	): Promise<void> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const encodedPath = encodePath(path);

		// GET checks rate limit via this.request(); PUT checks separately below
		let existingSha: string | undefined;
		try {
			const existing = await this.request<{ sha: string }>(
				`/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
			);
			existingSha = existing.sha;
		} catch (error: unknown) {
			if (!(error instanceof GitHubNotFoundError)) throw error;
		}

		const body: Record<string, string> = {
			message,
			content: toBase64(content),
			branch,
		};
		if (existingSha) {
			body.sha = existingSha;
		}

		this.rateLimiter.assertCanMakeRequest("rest");
		const url = `${BASE_URL}/repos/${owner}/${repo}/contents/${encodedPath}`;
		this.logger.debug("GitHub REST createOrUpdateFile", { path, branch, update: !!existingSha });

		try {
			const response = await requestWithTimeout({
				url,
				method: "PUT",
				contentType: "application/json",
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": API_VERSION,
				},
				body: JSON.stringify(body),
			});
			this.rateLimiter.updateFromHeaders(response.headers);
		} catch (error: unknown) {
			throw this.handleRequestError(error, path);
		}
	}

	async deleteFile(path: string, message: string, branch: string): Promise<void> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const encodedPath = encodePath(path);

		let sha: string;
		try {
			const existing = await this.request<{ sha: string }>(
				`/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
			);
			sha = existing.sha;
		} catch (error: unknown) {
			if (error instanceof GitHubNotFoundError) return; // Already deleted
			throw error;
		}

		this.rateLimiter.assertCanMakeRequest("rest");
		const url = `${BASE_URL}/repos/${owner}/${repo}/contents/${encodedPath}`;
		this.logger.debug("GitHub REST deleteFile", { path, branch });

		try {
			const response = await requestWithTimeout({
				url,
				method: "DELETE",
				contentType: "application/json",
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": API_VERSION,
				},
				body: JSON.stringify({ message, sha, branch }),
			});
			this.rateLimiter.updateFromHeaders(response.headers);
		} catch (error: unknown) {
			throw this.handleRequestError(error, path);
		}
	}

	async createBlob(base64Content: string): Promise<string> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const data = await this.post<{ sha: string }>(`/repos/${owner}/${repo}/git/blobs`, {
			content: base64Content,
			encoding: "base64",
		});
		if (typeof data.sha !== "string") {
			throw new Error("Invalid blob response from GitHub API");
		}
		return data.sha;
	}

	async createTreeFromEntries(
		baseTreeSha: string,
		entries: Array<{ path: string; sha: string; mode?: string }>,
	): Promise<string> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const tree = entries.map((e) => ({
			path: e.path,
			mode: e.mode ?? "100644",
			type: "blob" as const,
			sha: e.sha,
		}));
		const data = await this.post<{ sha: string }>(`/repos/${owner}/${repo}/git/trees`, {
			base_tree: baseTreeSha,
			tree,
		});
		if (typeof data.sha !== "string") {
			throw new Error("Invalid tree response from GitHub API");
		}
		return data.sha;
	}

	async createCommitRest(treeSha: string, parentSha: string, message: string): Promise<string> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		const data = await this.post<{ sha: string }>(`/repos/${owner}/${repo}/git/commits`, {
			message,
			tree: treeSha,
			parents: [parentSha],
		});
		if (typeof data.sha !== "string") {
			throw new Error("Invalid commit response from GitHub API");
		}
		return data.sha;
	}

	async updateRef(branch: string, commitSha: string): Promise<void> {
		const owner = encodeURIComponent(this.owner);
		const repo = encodeURIComponent(this.repo);
		await this.post<{ ref: string }>(
			`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
			{ sha: commitSha },
			"PATCH",
		);
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

		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": API_VERSION,
			"Cache-Control": "no-cache",
		};

		const cached = this.etagCache.get(path);
		if (cached) {
			headers["If-None-Match"] = cached.etag;
		}

		let response: RequestUrlResponse;
		try {
			// Use throw: false so Obsidian returns the response object for ALL status codes
			// including 304 Not Modified. Without this, Obsidian throws an error for 304
			// with an inconsistent error object (missing .status), breaking ETag caching.
			response = await requestWithTimeout({
				url,
				method: "GET",
				headers,
				throw: false,
			});
		} catch (error: unknown) {
			throw this.handleRequestError(error, path);
		}

		this.rateLimiter.updateFromHeaders(response.headers);

		// Handle 304 Not Modified — return cached data (ETag hit, free API call)
		if (response.status === 304 && cached) {
			this.logger.debug("GitHub REST 304 Not Modified (ETag hit)", { url });
			return cached.data as T;
		}

		// Handle error status codes
		if (response.status >= 400) {
			throw this.handleRequestError({ status: response.status, headers: response.headers }, path);
		}

		const etag = response.headers.etag ?? response.headers.ETag;
		if (etag) {
			this.etagCache.set(path, { etag, data: response.json });
		}

		const json = response.json;
		if (json === null || json === undefined) {
			throw new Error(`Invalid API response: expected JSON for ${path}`);
		}
		return json as T;
	}

	private async post<T>(path: string, body: unknown, method = "POST"): Promise<T> {
		this.rateLimiter.assertCanMakeRequest("rest");

		const url = `${BASE_URL}${path}`;
		this.logger.debug("GitHub REST write", { method, url });

		let response: RequestUrlResponse;
		try {
			response = await requestWithTimeout({
				url,
				method,
				headers: {
					Authorization: `Bearer ${this.token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": API_VERSION,
				},
				body: JSON.stringify(body),
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
