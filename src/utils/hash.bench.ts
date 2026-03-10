import { bench, describe } from "vitest";
import { computeGitBlobSha, computeHash } from "./hash";

const smallContent = "Hello, world!";
const mediumContent = "x".repeat(10_000);
const largeContent = "x".repeat(100_000);

const smallBytes = new TextEncoder().encode(smallContent);
const mediumBytes = new TextEncoder().encode(mediumContent);
const largeBytes = new TextEncoder().encode(largeContent);

describe("computeHash (SHA-256)", () => {
	bench("small string (13 bytes)", async () => {
		await computeHash(smallContent);
	});

	bench("medium string (10KB)", async () => {
		await computeHash(mediumContent);
	});

	bench("large string (100KB)", async () => {
		await computeHash(largeContent);
	});
});

describe("computeGitBlobSha (SHA-1)", () => {
	bench("small bytes (13 bytes)", async () => {
		await computeGitBlobSha(smallBytes);
	});

	bench("medium bytes (10KB)", async () => {
		await computeGitBlobSha(mediumBytes);
	});

	bench("large bytes (100KB)", async () => {
		await computeGitBlobSha(largeBytes);
	});
});
