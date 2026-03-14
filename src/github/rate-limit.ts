import { GitHubRateLimitError } from "../types";

export interface RateLimitState {
	limit: number;
	remaining: number;
	resetAt: Date;
}

export class RateLimiter {
	private rest: RateLimitState | null = null;
	private graphql: RateLimitState | null = null;

	updateFromHeaders(headers: Record<string, string>, type: "rest" | "graphql" = "rest"): void {
		const limit = Number.parseInt(headers["x-ratelimit-limit"] ?? "", 10);
		const remaining = Number.parseInt(headers["x-ratelimit-remaining"] ?? "", 10);
		const reset = Number.parseInt(headers["x-ratelimit-reset"] ?? "", 10);

		if (Number.isNaN(limit) || Number.isNaN(remaining) || Number.isNaN(reset)) return;

		const state: RateLimitState = {
			limit,
			remaining,
			resetAt: new Date(reset * 1000),
		};

		if (type === "graphql") {
			this.graphql = state;
		} else {
			this.rest = state;
		}
	}

	canMakeRequest(type: "rest" | "graphql" = "rest"): boolean {
		const state = type === "graphql" ? this.graphql : this.rest;
		if (!state) return true;
		return !(state.remaining <= 0 && state.resetAt.getTime() > Date.now());
	}

	assertCanMakeRequest(type: "rest" | "graphql" = "rest"): void {
		const state = type === "graphql" ? this.graphql : this.rest;
		if (!state) return;

		if (state.remaining <= 0 && state.resetAt.getTime() > Date.now()) {
			throw new GitHubRateLimitError(state.resetAt);
		}
	}

	getState(type: "rest" | "graphql" = "rest"): RateLimitState | null {
		return type === "graphql" ? this.graphql : this.rest;
	}
}
