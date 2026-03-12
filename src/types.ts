// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface GHVaultSettings {
	githubToken: string;
	owner: string;
	repo: string;
	branch: string;
	syncFolder: string;
	logLevel: LogLevel;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export const VALID_LOG_LEVELS: ReadonlyArray<LogLevel> = ["debug", "info", "warn", "error"];

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

export interface SyncState {
	lastRemoteHeadSha: string;
	lastSyncedAt: number;
	cache: Record<string, SHACacheEntry>;
}

export interface SHACacheEntry {
	remoteSha: string;
	localContentHash: string;
	lastSyncedAt: number;
	size: number;
	isBinary: boolean;
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

export type ChangeType = "create" | "modify" | "delete";

export interface FileChange {
	path: string;
	type: ChangeType;
	content?: string;
}

export interface ConflictInfo {
	path: string;
	localChange: ChangeType;
	remoteChange: ChangeType;
}

// ---------------------------------------------------------------------------
// GitHub API types
// ---------------------------------------------------------------------------

export interface GitHubTreeEntry {
	path: string;
	mode: string;
	type: "blob" | "tree";
	sha: string;
	size?: number;
}

export interface GitHubCommitResult {
	oid: string;
	url: string;
}

export interface GitHubRef {
	ref: string;
	sha: string;
}

export interface GitHubRepoInfo {
	name: string;
	fullName: string;
	defaultBranch: string;
	private: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class GitHubAuthError extends Error {
	constructor(message = "Authentication failed. Check your GitHub token.") {
		super(message);
		this.name = "GitHubAuthError";
	}
}

export class GitHubRateLimitError extends Error {
	readonly resetAt: Date;

	constructor(resetAt: Date) {
		super(`GitHub rate limit exceeded. Resets at ${resetAt.toISOString()}`);
		this.name = "GitHubRateLimitError";
		this.resetAt = resetAt;
	}
}

export class GitHubNotFoundError extends Error {
	constructor(resource: string) {
		super(`GitHub resource not found: ${resource}`);
		this.name = "GitHubNotFoundError";
	}
}

export class GitHubConflictError extends Error {
	constructor(message = "Conflict: remote has changed since last sync.") {
		super(message);
		this.name = "GitHubConflictError";
	}
}

export class GitHubEmptyRepoError extends Error {
	constructor() {
		super("Repository is empty. No commits yet.");
		this.name = "GitHubEmptyRepoError";
	}
}

export class GitHubTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Request timed out after ${timeoutMs / 1000}s`);
		this.name = "GitHubTimeoutError";
	}
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const EXCLUDED_PATTERNS: ReadonlyArray<string> = [
	".obsidian/**",
	".trash/**",
	"ghvault.log",
	".ghvault",
];

export const LOG_FILE = "ghvault.log";

export const DEFAULT_SETTINGS: GHVaultSettings = {
	githubToken: "",
	owner: "",
	repo: "",
	branch: "main",
	syncFolder: "",
	logLevel: "info",
};
