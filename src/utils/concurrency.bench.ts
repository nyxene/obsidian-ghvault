import { bench, describe } from "vitest";
import { pMap } from "./concurrency";

const items100 = Array.from({ length: 100 }, (_, i) => i);
const items1000 = Array.from({ length: 1000 }, (_, i) => i);
const items5000 = Array.from({ length: 5000 }, (_, i) => i);

describe("pMap", () => {
	bench("100 items, concurrency 8, sync-like fn", async () => {
		await pMap(items100, async (x) => x * 2, 8);
	});

	bench("1000 items, concurrency 8, sync-like fn", async () => {
		await pMap(items1000, async (x) => x * 2, 8);
	});

	bench("5000 items, concurrency 20, sync-like fn", async () => {
		await pMap(items5000, async (x) => x * 2, 20);
	});

	bench("100 items, concurrency 1 (sequential)", async () => {
		await pMap(items100, async (x) => x * 2, 1);
	});
});
