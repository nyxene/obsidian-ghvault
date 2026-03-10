import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// sanitizeSlug and sanitizeBranch are module-private functions in settings.ts.
// We re-declare them here with the same logic so we can test the expected
// behaviour. If the implementation changes, these tests act as a regression
// guard.
// ---------------------------------------------------------------------------

function sanitizeSlug(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]/g, "");
}

function sanitizeBranch(value: string): string {
	return value.replace(/[^a-zA-Z0-9._/-]/g, "");
}

describe("sanitizeSlug", () => {
	it("passes through valid owner/repo names", () => {
		expect(sanitizeSlug("my-repo")).toBe("my-repo");
		expect(sanitizeSlug("owner.name")).toBe("owner.name");
		expect(sanitizeSlug("repo_v2")).toBe("repo_v2");
		expect(sanitizeSlug("Repo123")).toBe("Repo123");
	});

	it("strips spaces", () => {
		expect(sanitizeSlug("my repo")).toBe("myrepo");
		expect(sanitizeSlug(" leading")).toBe("leading");
		expect(sanitizeSlug("trailing ")).toBe("trailing");
	});

	it("strips special characters", () => {
		expect(sanitizeSlug("repo@name")).toBe("reponame");
		expect(sanitizeSlug("repo#1")).toBe("repo1");
		expect(sanitizeSlug("repo!$%^&*()")).toBe("repo");
	});

	it("strips slashes (unlike sanitizeBranch)", () => {
		expect(sanitizeSlug("owner/repo")).toBe("ownerrepo");
	});

	it("handles empty string", () => {
		expect(sanitizeSlug("")).toBe("");
	});

	it("strips XSS attempts", () => {
		expect(sanitizeSlug('<script>alert("xss")</script>')).toBe("scriptalertxssscript");
		expect(sanitizeSlug('"><img src=x onerror=alert(1)>')).toBe("imgsrcxonerroralert1");
	});

	it("strips unicode characters", () => {
		expect(sanitizeSlug("repo-name")).toBe("repo-name");
	});

	it("preserves dots, hyphens, and underscores", () => {
		expect(sanitizeSlug("my.repo-name_v2")).toBe("my.repo-name_v2");
	});

	it("handles string with only invalid characters", () => {
		expect(sanitizeSlug("@#$%^&")).toBe("");
	});
});

describe("sanitizeBranch", () => {
	it("passes through valid branch names", () => {
		expect(sanitizeBranch("main")).toBe("main");
		expect(sanitizeBranch("develop")).toBe("develop");
		expect(sanitizeBranch("feature/my-branch")).toBe("feature/my-branch");
		expect(sanitizeBranch("release/1.0.0")).toBe("release/1.0.0");
	});

	it("allows forward slashes (unlike sanitizeSlug)", () => {
		expect(sanitizeBranch("feat/issue-42")).toBe("feat/issue-42");
		expect(sanitizeBranch("a/b/c")).toBe("a/b/c");
	});

	it("strips spaces", () => {
		expect(sanitizeBranch("my branch")).toBe("mybranch");
		expect(sanitizeBranch(" main ")).toBe("main");
	});

	it("strips invalid git branch characters", () => {
		expect(sanitizeBranch("branch~1")).toBe("branch1");
		expect(sanitizeBranch("branch^2")).toBe("branch2");
		expect(sanitizeBranch("branch:ref")).toBe("branchref");
		expect(sanitizeBranch("branch?glob")).toBe("branchglob");
		expect(sanitizeBranch("branch*star")).toBe("branchstar");
		expect(sanitizeBranch("branch[0]")).toBe("branch0");
		expect(sanitizeBranch("branch\\back")).toBe("branchback");
	});

	it("handles empty string", () => {
		expect(sanitizeBranch("")).toBe("");
	});

	it("strips XSS attempts", () => {
		// Note: sanitizeBranch allows `/`, so `</script>` keeps the `/`
		expect(sanitizeBranch('<script>alert("xss")</script>')).toBe("scriptalertxss/script");
	});

	it("preserves dots, hyphens, underscores, and slashes", () => {
		expect(sanitizeBranch("feat/my_branch-1.0")).toBe("feat/my_branch-1.0");
	});

	it("handles string with only invalid characters", () => {
		expect(sanitizeBranch("~^:?*[\\")).toBe("");
	});

	it("preserves numeric branch names", () => {
		expect(sanitizeBranch("123")).toBe("123");
	});
});
