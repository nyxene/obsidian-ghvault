import { describe, expect, it } from "vitest";
import { isExcluded, normalizePath, toRepoPath, toVaultPath } from "./path";

describe("normalizePath", () => {
	it("replaces backslashes", () => {
		expect(normalizePath("a\\b\\c")).toBe("a/b/c");
	});

	it("removes duplicate slashes", () => {
		expect(normalizePath("a//b///c")).toBe("a/b/c");
	});

	it("strips leading and trailing slashes", () => {
		expect(normalizePath("/a/b/c/")).toBe("a/b/c");
	});

	it("handles empty string", () => {
		expect(normalizePath("")).toBe("");
	});
});

describe("toRepoPath", () => {
	it("prepends repoPrefix", () => {
		expect(toRepoPath("notes/daily.md", "docs")).toBe("docs/notes/daily.md");
	});

	it("returns vault path when repoPrefix is empty", () => {
		expect(toRepoPath("notes/daily.md", "")).toBe("notes/daily.md");
	});

	it("normalizes slashes", () => {
		expect(toRepoPath("/notes/daily.md/", "/docs/")).toBe("docs/notes/daily.md");
	});
});

describe("toVaultPath", () => {
	it("strips repoPrefix", () => {
		expect(toVaultPath("docs/notes/daily.md", "docs")).toBe("notes/daily.md");
	});

	it("returns path as-is when repoPrefix is empty", () => {
		expect(toVaultPath("notes/daily.md", "")).toBe("notes/daily.md");
	});

	it("returns null when path does not start with repoPrefix", () => {
		expect(toVaultPath("other/file.md", "docs")).toBeNull();
	});

	it("does not match partial prefix", () => {
		expect(toVaultPath("docs-extra/file.md", "docs")).toBeNull();
	});
});

describe("isExcluded", () => {
	it("excludes .obsidian files", () => {
		expect(isExcluded(".obsidian/config.json")).toBe(true);
		expect(isExcluded(".obsidian/plugins/foo/main.js")).toBe(true);
	});

	it("excludes .obsidian folder itself", () => {
		expect(isExcluded(".obsidian")).toBe(true);
	});

	it("excludes .trash files", () => {
		expect(isExcluded(".trash/deleted-note.md")).toBe(true);
	});

	it("excludes ghvault.log", () => {
		expect(isExcluded("ghvault.log")).toBe(true);
	});

	it("does not exclude regular files", () => {
		expect(isExcluded("notes/daily.md")).toBe(false);
		expect(isExcluded("README.md")).toBe(false);
	});

	it("supports custom patterns", () => {
		expect(isExcluded("secret/data.json", ["secret/**"])).toBe(true);
		expect(isExcluded("public/data.json", ["secret/**"])).toBe(false);
	});
});
