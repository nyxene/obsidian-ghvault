import type { RequestUrlParam, RequestUrlResponse } from "obsidian";
import { requestUrl } from "obsidian";
import { GitHubTimeoutError } from "../types";

/** Default timeout for all GitHub API requests (30 seconds). */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Wraps Obsidian's `requestUrl` with a per-request timeout using `Promise.race`.
 * If the request does not resolve within `timeoutMs`, rejects with `GitHubTimeoutError`.
 */
export function requestWithTimeout(
	params: RequestUrlParam,
	timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<RequestUrlResponse> {
	let timerId: ReturnType<typeof setTimeout>;

	const timeout = new Promise<never>((_resolve, reject) => {
		timerId = setTimeout(() => reject(new GitHubTimeoutError(timeoutMs)), timeoutMs);
	});

	return Promise.race([requestUrl(params), timeout]).finally(() => {
		clearTimeout(timerId);
	});
}
