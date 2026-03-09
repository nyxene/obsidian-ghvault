import { describe, expect, it } from "vitest";
import { pMap } from "./concurrency";

describe("pMap", () => {
	it("maps items in order", async () => {
		const result = await pMap([1, 2, 3], async (x) => x * 2, 2);
		expect(result).toEqual([2, 4, 6]);
	});

	it("respects concurrency limit", async () => {
		let active = 0;
		let maxActive = 0;

		const result = await pMap(
			[1, 2, 3, 4, 5, 6],
			async (x) => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((r) => setTimeout(r, 10));
				active--;
				return x;
			},
			3,
		);

		expect(result).toEqual([1, 2, 3, 4, 5, 6]);
		expect(maxActive).toBeLessThanOrEqual(3);
		expect(maxActive).toBeGreaterThan(1);
	});

	it("handles empty array", async () => {
		const result = await pMap([], async (x: number) => x, 5);
		expect(result).toEqual([]);
	});

	it("handles concurrency greater than items length", async () => {
		const result = await pMap([1, 2], async (x) => x * 10, 100);
		expect(result).toEqual([10, 20]);
	});

	it("propagates errors from mapper function", async () => {
		await expect(
			pMap(
				[1, 2, 3],
				async (x) => {
					if (x === 2) throw new Error("fail");
					return x;
				},
				2,
			),
		).rejects.toThrow("fail");
	});

	it("throws on invalid concurrency", async () => {
		await expect(pMap([1], async (x) => x, 0)).rejects.toThrow("Concurrency must be at least 1");
	});

	it("passes index to mapper", async () => {
		const indices: number[] = [];
		await pMap(
			[10, 20, 30],
			async (_, i) => {
				indices.push(i);
			},
			2,
		);
		expect(indices.sort()).toEqual([0, 1, 2]);
	});

	it("preserves result order regardless of completion order", async () => {
		const result = await pMap(
			[30, 10, 20],
			async (delay) => {
				await new Promise((r) => setTimeout(r, delay));
				return delay;
			},
			3,
		);
		expect(result).toEqual([30, 10, 20]);
	});
});
