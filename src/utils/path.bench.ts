import { bench, describe } from "vitest";
import { isExcluded, isSafePath, normalizePath } from "./path";

describe("normalizePath", () => {
	bench("simple path", () => {
		normalizePath("folder/subfolder/file.md");
	});

	bench("path with backslashes", () => {
		normalizePath("folder\\subfolder\\file.md");
	});

	bench("path with multiple slashes and edges", () => {
		normalizePath("//folder///subfolder//file.md//");
	});
});

describe("isExcluded", () => {
	bench("non-excluded path", () => {
		isExcluded("notes/daily/2024-01-01.md");
	});

	bench("excluded .obsidian path", () => {
		isExcluded(".obsidian/plugins/ghvault/main.js");
	});

	bench("ghvault.log", () => {
		isExcluded("ghvault.log");
	});

	bench("1000 paths in loop", () => {
		for (let i = 0; i < 1000; i++) {
			isExcluded(`folder/subfolder/file-${i}.md`);
		}
	});
});

describe("isSafePath", () => {
	bench("safe path", () => {
		isSafePath("notes/daily/2024-01-01.md");
	});

	bench("unsafe path with traversal", () => {
		isSafePath("../../etc/passwd");
	});

	bench("absolute path", () => {
		isSafePath("/etc/passwd");
	});
});
