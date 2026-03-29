import { describe, expect, it } from "vitest";
import {
	getEffectiveExcludePatterns,
	isExcluded,
	isSafePath,
	isValidExcludePattern,
	normalizePath,
	toRepoPath,
	toVaultPath,
} from "./path";

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
	it("prepends syncFolder", () => {
		expect(toRepoPath("notes/daily.md", "docs")).toBe("docs/notes/daily.md");
	});

	it("returns vault path when syncFolder is empty", () => {
		expect(toRepoPath("notes/daily.md", "")).toBe("notes/daily.md");
	});

	it("normalizes slashes", () => {
		expect(toRepoPath("/notes/daily.md/", "/docs/")).toBe("docs/notes/daily.md");
	});
});

describe("toVaultPath", () => {
	it("strips syncFolder", () => {
		expect(toVaultPath("docs/notes/daily.md", "docs")).toBe("notes/daily.md");
	});

	it("returns path as-is when syncFolder is empty", () => {
		expect(toVaultPath("notes/daily.md", "")).toBe("notes/daily.md");
	});

	it("returns null when path does not start with syncFolder", () => {
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

	it("excludes .ghvault marker file", () => {
		expect(isExcluded(".ghvault")).toBe(true);
	});

	it("does not exclude regular files", () => {
		expect(isExcluded("notes/daily.md")).toBe(false);
		expect(isExcluded("README.md")).toBe(false);
	});

	it("supports custom patterns", () => {
		expect(isExcluded("secret/data.json", ["secret/**"])).toBe(true);
		expect(isExcluded("public/data.json", ["secret/**"])).toBe(false);
	});

	it("excludes case-insensitively", () => {
		expect(isExcluded(".Obsidian/workspace")).toBe(true);
		expect(isExcluded(".TRASH/old.md")).toBe(true);
		expect(isExcluded("GHVAULT.LOG")).toBe(true);
	});
});

describe("isExcluded — ** prefix patterns", () => {
	it("matches file at root matching **/suffix", () => {
		expect(isExcluded(".git", ["**/.git"])).toBe(true);
	});

	it("matches file nested under directory matching **/suffix", () => {
		expect(isExcluded("subdir/.git", ["**/.git"])).toBe(true);
		expect(isExcluded("a/b/c/.git", ["**/.git"])).toBe(true);
	});

	it("does not match partial name for **/suffix", () => {
		expect(isExcluded("not-git", ["**/.git"])).toBe(false);
		expect(isExcluded("subdir/not.git", ["**/.git"])).toBe(false);
	});

	it("matches nested directory path with **/suffix", () => {
		expect(isExcluded("deep/nested/node_modules", ["**/node_modules"])).toBe(true);
	});

	it("does not match when suffix is only a substring", () => {
		expect(isExcluded("my-node_modules-extra", ["**/node_modules"])).toBe(false);
	});
});

describe("isExcluded — *. extension patterns", () => {
	it("matches file with given extension at root", () => {
		expect(isExcluded("file.tmp", ["*.tmp"])).toBe(true);
	});

	it("matches file with given extension in subdirectory", () => {
		expect(isExcluded("notes/scratch.tmp", ["*.tmp"])).toBe(true);
		expect(isExcluded("a/b/c/data.bak", ["*.bak"])).toBe(true);
	});

	it("does not match different extension", () => {
		expect(isExcluded("file.md", ["*.tmp"])).toBe(false);
	});

	it("does not match extension as substring", () => {
		expect(isExcluded("file.tmp2", ["*.tmp"])).toBe(false);
	});

	it("matches case-insensitively", () => {
		expect(isExcluded("FILE.TMP", ["*.tmp"])).toBe(true);
		expect(isExcluded("notes/Data.BAK", ["*.bak"])).toBe(true);
	});

	it("handles dotfile-like extensions", () => {
		expect(isExcluded("archive.tar.gz", ["*.gz"])).toBe(true);
		expect(isExcluded("archive.tar.gz", ["*.tar.gz"])).toBe(true);
	});
});

describe("isExcluded — combined pattern types", () => {
	it("checks multiple pattern types together", () => {
		const patterns = [".obsidian/**", "**/.git", "*.tmp"];
		expect(isExcluded(".obsidian/config.json", patterns)).toBe(true);
		expect(isExcluded("sub/.git", patterns)).toBe(true);
		expect(isExcluded("notes/scratch.tmp", patterns)).toBe(true);
		expect(isExcluded("notes/daily.md", patterns)).toBe(false);
	});

	it("handles exact match pattern alongside glob patterns", () => {
		const patterns = ["ghvault.log", "**/.DS_Store", "*.bak"];
		expect(isExcluded("ghvault.log", patterns)).toBe(true);
		expect(isExcluded("folder/.DS_Store", patterns)).toBe(true);
		expect(isExcluded("old/backup.bak", patterns)).toBe(true);
		expect(isExcluded("readme.md", patterns)).toBe(false);
	});
});

describe("isSafePath", () => {
	it("allows normal paths", () => {
		expect(isSafePath("notes/daily.md")).toBe(true);
		expect(isSafePath("folder/sub/file.txt")).toBe(true);
		expect(isSafePath("README.md")).toBe(true);
	});

	it("rejects path traversal with ..", () => {
		expect(isSafePath("../etc/passwd")).toBe(false);
		expect(isSafePath("notes/../../secret")).toBe(false);
		expect(isSafePath("a/b/../../../c")).toBe(false);
	});

	it("rejects absolute paths", () => {
		expect(isSafePath("/etc/passwd")).toBe(false);
		expect(isSafePath("C:/Windows/system32")).toBe(false);
	});

	it("rejects empty paths", () => {
		expect(isSafePath("")).toBe(false);
	});

	it("allows paths with dots in filenames", () => {
		expect(isSafePath("file.test.md")).toBe(true);
		expect(isSafePath(".hidden/file.md")).toBe(true);
	});
});

describe("getEffectiveExcludePatterns", () => {
	it("returns hardcoded patterns when input is empty", () => {
		const patterns = getEffectiveExcludePatterns("");
		expect(patterns).toContain(".obsidian/**");
		expect(patterns).toContain(".trash/**");
		expect(patterns).toContain("ghvault.log");
		expect(patterns).toContain(".ghvault");
	});

	it("returns hardcoded patterns when input is undefined", () => {
		const patterns = getEffectiveExcludePatterns(undefined);
		expect(patterns).toContain(".obsidian/**");
	});

	it("merges user patterns with hardcoded", () => {
		const patterns = getEffectiveExcludePatterns("drafts/**\n*.tmp");
		expect(patterns).toContain(".obsidian/**");
		expect(patterns).toContain("drafts/**");
		expect(patterns).toContain("*.tmp");
	});

	it("trims whitespace and skips empty lines", () => {
		const patterns = getEffectiveExcludePatterns("  drafts/**  \n\n  *.bak  \n");
		expect(patterns).toContain("drafts/**");
		expect(patterns).toContain("*.bak");
		expect(patterns.filter((p) => p === "")).toHaveLength(0);
	});

	it("skips comment lines starting with #", () => {
		const patterns = getEffectiveExcludePatterns("# My excludes\ndrafts/**\n# Another comment");
		expect(patterns).toContain("drafts/**");
		expect(patterns.some((p) => p.startsWith("#"))).toBe(false);
	});

	it("works with user patterns in isExcluded", () => {
		const patterns = getEffectiveExcludePatterns("private/**\n*.pdf");
		expect(isExcluded("private/secret.md", patterns)).toBe(true);
		expect(isExcluded("docs/report.pdf", patterns)).toBe(true);
		expect(isExcluded("docs/notes.md", patterns)).toBe(false);
		// Hardcoded still work
		expect(isExcluded(".obsidian/config.json", patterns)).toBe(true);
	});
});

describe("isValidExcludePattern", () => {
	it("accepts dir/** patterns", () => {
		expect(isValidExcludePattern("drafts/**")).toBe(true);
		expect(isValidExcludePattern("a/b/c/**")).toBe(true);
	});

	it("accepts *.ext patterns", () => {
		expect(isValidExcludePattern("*.tmp")).toBe(true);
		expect(isValidExcludePattern("*.pdf")).toBe(true);
	});

	it("accepts **/name patterns", () => {
		expect(isValidExcludePattern("**/node_modules")).toBe(true);
		expect(isValidExcludePattern("**/.git")).toBe(true);
	});

	it("accepts exact path patterns", () => {
		expect(isValidExcludePattern("secret/data.json")).toBe(true);
		expect(isValidExcludePattern("file.txt")).toBe(true);
	});

	it("accepts comments and empty", () => {
		expect(isValidExcludePattern("# comment")).toBe(true);
		expect(isValidExcludePattern("")).toBe(true);
	});

	it("rejects patterns with special characters", () => {
		expect(isValidExcludePattern("&&%$]")).toBe(false);
		expect(isValidExcludePattern("file[0].md")).toBe(false);
		expect(isValidExcludePattern("path with spaces")).toBe(false);
		expect(isValidExcludePattern("$(command)")).toBe(false);
	});

	it("rejects patterns with path traversal", () => {
		expect(isValidExcludePattern("../../etc/passwd")).toBe(false);
		expect(isValidExcludePattern("notes/../../escape")).toBe(false);
		expect(isValidExcludePattern("..")).toBe(false);
		expect(isValidExcludePattern("a/../b")).toBe(false);
	});
});
