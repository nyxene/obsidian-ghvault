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
	autoSync: boolean;
	autoSyncDebounce: number;
	autoSyncPullInterval: number;
	conflictStrategy: ConflictStrategy;
	excludePatterns: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export const VALID_LOG_LEVELS: ReadonlyArray<LogLevel> = ["debug", "info", "warn", "error"];

export type ConflictStrategy = "skip" | "local-wins" | "remote-wins" | "ask";

export const VALID_CONFLICT_STRATEGIES: ReadonlyArray<ConflictStrategy> = [
	"skip",
	"local-wins",
	"remote-wins",
	"ask",
];

export type ConflictResolution = "local" | "remote" | "merged";

export interface ConflictDecision {
	path: string;
	resolution: ConflictResolution;
	mergedContent?: string;
}

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
	sizeHint?: number;
}

export interface RenameInfo {
	oldPath: string;
	newPath: string;
}

export interface ConflictInfo {
	path: string;
	localChange: ChangeType;
	remoteChange: ChangeType;
}

export interface ConflictContentProvider {
	getLocalContent(path: string): Promise<string>;
	getRemoteContent(path: string): Promise<string>;
}

export interface GistRecord {
	gistId: string;
	htmlUrl: string;
	isPublic: boolean;
	vaultPath: string;
	description: string;
	createdAt: number;
	updatedAt: number;
}

export interface FileCommitInfo {
	sha: string;
	message: string;
	authorName: string;
	date: string;
	htmlUrl: string;
}

export interface BackupRecord {
	id: number;
	tagName: string;
	name: string;
	createdAt: string;
	htmlUrl: string;
	assetName: string;
	assetSize: number;
	assetDownloadUrl: string;
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

/** Shared regex for redacting secrets in logs and UI messages. */
export const SECRET_PATTERN =
	/gh[pousxra]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|Bearer [a-zA-Z0-9_.-]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export const DEFAULT_SETTINGS: GHVaultSettings = {
	githubToken: "",
	owner: "",
	repo: "",
	branch: "main",
	syncFolder: "",
	logLevel: "info",
	autoSync: false,
	autoSyncDebounce: 10,
	autoSyncPullInterval: 300,
	conflictStrategy: "skip",
	excludePatterns: "",
};
