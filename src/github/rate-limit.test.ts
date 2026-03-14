import { beforeEach, describe, expect, it } from "vitest";
import { GitHubRateLimitError } from "../types";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
	let limiter: RateLimiter;

	beforeEach(() => {
		limiter = new RateLimiter();
	});

	describe("updateFromHeaders", () => {
		it("parses rate limit headers", () => {
			limiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "4999",
				"x-ratelimit-reset": "1700000000",
			});

			const state = limiter.getState();
			expect(state).not.toBeNull();
			expect(state?.limit).toBe(5000);
			expect(state?.remaining).toBe(4999);
			expect(state?.resetAt).toEqual(new Date(1700000000 * 1000));
		});

		it("tracks REST and GraphQL separately", () => {
			limiter.updateFromHeaders(
				{
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "4000",
					"x-ratelimit-reset": "1700000000",
				},
				"rest",
			);

			limiter.updateFromHeaders(
				{
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "3000",
					"x-ratelimit-reset": "1700000000",
				},
				"graphql",
			);

			expect(limiter.getState("rest")?.remaining).toBe(4000);
			expect(limiter.getState("graphql")?.remaining).toBe(3000);
		});

		it("ignores invalid headers", () => {
			limiter.updateFromHeaders({});
			expect(limiter.getState()).toBeNull();
		});

		it("ignores partial headers", () => {
			limiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
			});
			expect(limiter.getState()).toBeNull();
		});
	});

	describe("assertCanMakeRequest", () => {
		it("does not throw when no state exists", () => {
			expect(() => limiter.assertCanMakeRequest()).not.toThrow();
		});

		it("does not throw when remaining > 0", () => {
			limiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "100",
				"x-ratelimit-reset": "1700000000",
			});

			expect(() => limiter.assertCanMakeRequest()).not.toThrow();
		});

		it("throws GitHubRateLimitError when exhausted and reset is in future", () => {
			const futureReset = Math.floor(Date.now() / 1000) + 3600;
			limiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": String(futureReset),
			});

			expect(() => limiter.assertCanMakeRequest()).toThrow(GitHubRateLimitError);
		});

		it("does not throw when exhausted but reset is in the past", () => {
			const pastReset = Math.floor(Date.now() / 1000) - 60;
			limiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": String(pastReset),
			});

			expect(() => limiter.assertCanMakeRequest()).not.toThrow();
		});

		it("checks correct type", () => {
			const futureReset = Math.floor(Date.now() / 1000) + 3600;
			limiter.updateFromHeaders(
				{
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "0",
					"x-ratelimit-reset": String(futureReset),
				},
				"graphql",
			);

			// REST has no state, should not throw
			expect(() => limiter.assertCanMakeRequest("rest")).not.toThrow();
			// GraphQL is exhausted
			expect(() => limiter.assertCanMakeRequest("graphql")).toThrow(GitHubRateLimitError);
		});
	});

	describe("canMakeRequest", () => {
		it("returns true when no state exists", () => {
			expect(limiter.canMakeRequest()).toBe(true);
		});

		it("returns true when remaining > 0", () => {
			limiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "100",
				"x-ratelimit-reset": "1700000000",
			});
			expect(limiter.canMakeRequest()).toBe(true);
		});

		it("returns false when exhausted and reset is in the future", () => {
			const futureReset = Math.floor(Date.now() / 1000) + 3600;
			limiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": String(futureReset),
			});
			expect(limiter.canMakeRequest()).toBe(false);
		});

		it("returns true when exhausted but reset is in the past", () => {
			const pastReset = Math.floor(Date.now() / 1000) - 60;
			limiter.updateFromHeaders({
				"x-ratelimit-limit": "5000",
				"x-ratelimit-remaining": "0",
				"x-ratelimit-reset": String(pastReset),
			});
			expect(limiter.canMakeRequest()).toBe(true);
		});

		it("checks correct type", () => {
			const futureReset = Math.floor(Date.now() / 1000) + 3600;
			limiter.updateFromHeaders(
				{
					"x-ratelimit-limit": "5000",
					"x-ratelimit-remaining": "0",
					"x-ratelimit-reset": String(futureReset),
				},
				"graphql",
			);
			expect(limiter.canMakeRequest("rest")).toBe(true);
			expect(limiter.canMakeRequest("graphql")).toBe(false);
		});
	});
});
