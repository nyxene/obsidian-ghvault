import { EXCLUDED_PATTERNS } from "../types";

export function toRepoPath(vaultPath: string, syncFolder: string): string {
	const normalized = normalizePath(vaultPath);
	if (!syncFolder) return normalized;
	return `${normalizePath(syncFolder)}/${normalized}`;
}

export function toVaultPath(repoPath: string, syncFolder: string): string | null {
	const normalized = normalizePath(repoPath);
	if (!syncFolder) return normalized;

	const prefix = `${normalizePath(syncFolder)}/`;
	if (!normalized.startsWith(prefix)) return null;
	return normalized.slice(prefix.length);
}

export function isSafePath(path: string): boolean {
	if (path.includes("\0")) return false;
	const normalized = normalizePath(path);
	if (!normalized) return false;
	if (/^[a-zA-Z]:/.test(normalized) || path.startsWith("/")) return false;
	const segments = normalized.split("/");
	for (const seg of segments) {
		if (seg === "..") return false;
	}
	return true;
}

const VALID_PATTERN_RE = /^(\*\*\/)?[a-zA-Z0-9._\-/]+(\*\*)?$|^\*\.[a-zA-Z0-9]+$/;

export function isValidExcludePattern(pattern: string): boolean {
	if (!pattern || pattern.startsWith("#")) return true;
	if (pattern.includes("..")) return false;
	return VALID_PATTERN_RE.test(pattern);
}

export function getEffectiveExcludePatterns(userInput?: string): string[] {
	if (!userInput) return [...EXCLUDED_PATTERNS];
	const userPatterns = userInput
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("#"));
	return [...EXCLUDED_PATTERNS, ...userPatterns];
}

export function isExcluded(
	path: string,
	patterns: ReadonlyArray<string> = EXCLUDED_PATTERNS,
): boolean {
	const normalized = normalizePath(path).toLowerCase();
	for (const pattern of patterns) {
		if (matchPattern(normalized, pattern.toLowerCase())) return true;
	}
	return false;
}

export function normalizePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/|\/$/g, "");
}

function matchPattern(path: string, pattern: string): boolean {
	if (pattern.endsWith("/**")) {
		const prefix = pattern.slice(0, -3);
		return path === prefix || path.startsWith(`${prefix}/`);
	}
	if (pattern.startsWith("**/")) {
		const suffix = pattern.slice(3);
		return path === suffix || path.endsWith(`/${suffix}`);
	}
	if (pattern.startsWith("*.")) {
		return path.endsWith(pattern.slice(1));
	}
	return path === pattern;
}
