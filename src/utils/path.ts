import { EXCLUDED_PATTERNS } from "../types";

export function toRepoPath(vaultPath: string, repoPrefix: string): string {
	const normalized = normalizePath(vaultPath);
	if (!repoPrefix) return normalized;
	return `${normalizePath(repoPrefix)}/${normalized}`;
}

export function toVaultPath(repoPath: string, repoPrefix: string): string | null {
	const normalized = normalizePath(repoPath);
	if (!repoPrefix) return normalized;

	const prefix = `${normalizePath(repoPrefix)}/`;
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
