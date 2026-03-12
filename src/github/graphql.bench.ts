import { bench, describe } from "vitest";
import type { FileAddition } from "./graphql";
import { chunkAdditions } from "./graphql";

function makeAddition(sizeBytes: number): FileAddition {
	return {
		path: `folder/file-${sizeBytes}.md`,
		base64Content: "x".repeat(sizeBytes),
	};
}

// Small files: 1KB each
const small100 = Array.from({ length: 100 }, (_, i) => ({
	path: `notes/file-${i}.md`,
	base64Content: "a".repeat(1024),
}));

const small1000 = Array.from({ length: 1000 }, (_, i) => ({
	path: `notes/file-${i}.md`,
	base64Content: "a".repeat(1024),
}));

// Mixed sizes: simulate real vault with varying file sizes
const mixed = [
	...Array.from({ length: 50 }, () => makeAddition(500)), // 50 small
	...Array.from({ length: 20 }, () => makeAddition(50_000)), // 20 medium (50KB)
	...Array.from({ length: 5 }, () => makeAddition(500_000)), // 5 large (500KB)
	...Array.from({ length: 2 }, () => makeAddition(1_500_000)), // 2 very large (1.5MB)
];

describe("chunkAdditions", () => {
	bench("100 small files (1KB each)", () => {
		chunkAdditions(small100);
	});

	bench("1000 small files (1KB each)", () => {
		chunkAdditions(small1000);
	});

	bench("77 mixed-size files (500B to 1.5MB)", () => {
		chunkAdditions(mixed);
	});

	bench("empty array", () => {
		chunkAdditions([]);
	});
});
