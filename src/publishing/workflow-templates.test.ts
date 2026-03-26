import { describe, expect, it } from "vitest";
import type { PagesGenerator } from "../types";
import { getWorkflowTemplate } from "./workflow-templates";

describe("workflow-templates", () => {
	const generators: PagesGenerator[] = ["quartz", "mkdocs", "starlight"];

	for (const gen of generators) {
		describe(gen, () => {
			it("returns a non-empty template", () => {
				const template = getWorkflowTemplate(gen, "main");
				expect(template).toBeTruthy();
				expect(typeof template).toBe("string");
			});

			it("includes repository_dispatch trigger", () => {
				const template = getWorkflowTemplate(gen, "main")!;
				expect(template).toContain("repository_dispatch");
				expect(template).toContain("vault-synced");
			});

			it("includes ghvault-publish exclusion step", () => {
				const template = getWorkflowTemplate(gen, "main")!;
				expect(template).toContain("ghvault-publish: false");
				expect(template).toContain("Exclude unpublished and filtered files");
			});

			it("includes pages deploy action", () => {
				const template = getWorkflowTemplate(gen, "main")!;
				expect(template).toContain("actions/deploy-pages@v5");
			});

			it("includes pages permissions", () => {
				const template = getWorkflowTemplate(gen, "main")!;
				expect(template).toContain("pages: write");
				expect(template).toContain("id-token: write");
			});
		});
	}

	describe("quartz-specific", () => {
		it("uses npx quartz build", () => {
			const template = getWorkflowTemplate("quartz", "main")!;
			expect(template).toContain("npx quartz build");
		});
	});

	describe("mkdocs-specific", () => {
		it("installs mkdocs-material", () => {
			const template = getWorkflowTemplate("mkdocs", "main")!;
			expect(template).toContain("mkdocs-material");
		});

		it("uses mkdocs build", () => {
			const template = getWorkflowTemplate("mkdocs", "main")!;
			expect(template).toContain("mkdocs build");
		});

		it("generates mkdocs.yml if missing", () => {
			const template = getWorkflowTemplate("mkdocs", "main")!;
			expect(template).toContain("mkdocs.yml");
			expect(template).toContain("name: material");
		});

		it("copies content into mkdocs-build/docs/", () => {
			const template = getWorkflowTemplate("mkdocs", "main")!;
			expect(template).toContain("mkdocs-build/docs");
			expect(template).toContain("working-directory: mkdocs-build");
		});

		it("uses syncFolder as content source", () => {
			const template = getWorkflowTemplate("mkdocs", "main", "docs/notes")!;
			expect(template).toContain('cp -a "vault/docs/notes/." mkdocs-build/docs/');
		});
	});

	describe("syncFolder support", () => {
		it("quartz copies only syncFolder content when set", () => {
			const template = getWorkflowTemplate("quartz", "main", "docs/ai")!;
			expect(template).toContain('cp -a "vault/docs/ai/."');
			expect(template).not.toContain('cp -a "vault/."');
		});

		it("quartz copies entire vault when syncFolder is empty", () => {
			const template = getWorkflowTemplate("quartz", "main", "")!;
			expect(template).toContain('cp -a "vault/."');
		});

		it("mkdocs uses syncFolder path for exclude step", () => {
			const template = getWorkflowTemplate("mkdocs", "main", "notes")!;
			expect(template).toContain("vault/notes");
		});

		it("mkdocs uses syncFolder path for exclude step", () => {
			const template = getWorkflowTemplate("mkdocs", "main", "content/posts")!;
			expect(template).toContain("vault/content/posts");
		});
	});

	describe("excludePatterns support", () => {
		it("adds find -delete commands for each pattern", () => {
			const template = getWorkflowTemplate("quartz", "main", "", "drafts/**\n*.tmp")!;
			expect(template).toContain('find quartz/content -path "quartz/content/drafts/**" -delete');
			expect(template).toContain('find quartz/content -path "quartz/content/*.tmp" -delete');
		});

		it("ignores empty lines and comments", () => {
			const template = getWorkflowTemplate("quartz", "main", "", "drafts/**\n\n# comment\n*.tmp")!;
			expect(template).toContain("drafts/**");
			expect(template).toContain("*.tmp");
			expect(template).not.toContain("# comment");
		});

		it("works with syncFolder + excludePatterns together", () => {
			const template = getWorkflowTemplate("quartz", "main", "docs/ai", "private/**")!;
			expect(template).toContain('cp -a "vault/docs/ai/."');
			expect(template).toContain('find quartz/content -path "quartz/content/private/**" -delete');
		});

		it("generates no find commands when excludePatterns is empty", () => {
			const template = getWorkflowTemplate("quartz", "main", "", "")!;
			expect(template).not.toContain("find quartz/content -path");
		});
	});

	describe("quartz template details", () => {
		it("clones jackyzha0/quartz repo", () => {
			const template = getWorkflowTemplate("quartz", "main")!;
			expect(template).toContain("repository: jackyzha0/quartz");
			expect(template).toContain("ref: v4");
		});

		it("creates index.md fallback step", () => {
			const template = getWorkflowTemplate("quartz", "main")!;
			expect(template).toContain("if [ ! -f quartz/content/index.md ]");
			expect(template).toContain("title: Home");
			expect(template).toContain("Welcome to my vault.");
		});

		it("sets base URL via sed using GITHUB_REPOSITORY", () => {
			const template = getWorkflowTemplate("quartz", "main")!;
			expect(template).toContain("Set base URL");
			expect(template).toContain("GITHUB_REPOSITORY");
			expect(template).toContain("sed -i");
			expect(template).toContain("baseUrl:");
		});

		it("uses quartz/content as content directory", () => {
			const template = getWorkflowTemplate("quartz", "main")!;
			expect(template).toContain('cp -a "vault/." quartz/content/');
		});

		it("uses quartz/content as exclude dir (not vault)", () => {
			const template = getWorkflowTemplate("quartz", "main", "", "drafts/**")!;
			expect(template).toContain('find quartz/content -path "quartz/content/drafts/**" -delete');
			expect(template).not.toMatch(/find vault -path "vault\/drafts\/\*\*" -delete/);
		});
	});

	describe("syncFolder content source", () => {
		it("quartz uses syncFolder subpath for content copy", () => {
			const template = getWorkflowTemplate("quartz", "main", "notes/public")!;
			expect(template).toContain('cp -a "vault/notes/public/."');
		});

		it("mkdocs uses syncFolder for build directory", () => {
			const template = getWorkflowTemplate("mkdocs", "main", "docs")!;
			expect(template).toContain("vault/docs");
		});
	});

	describe("excludePatterns edge cases", () => {
		it("handles glob ** special characters", () => {
			const template = getWorkflowTemplate("quartz", "main", "", "private/nested/**")!;
			expect(template).toContain(
				'find quartz/content -path "quartz/content/private/nested/**" -delete',
			);
		});

		it("generates multiple find commands for multiple patterns", () => {
			const template = getWorkflowTemplate("quartz", "main", "", "drafts/**\nprivate/**\n*.tmp")!;
			const findCommands = template.match(/find quartz\/content -path/g);
			expect(findCommands).toHaveLength(3);
		});

		it("quartz uses quartz/content as exclude dir even with syncFolder", () => {
			const template = getWorkflowTemplate("quartz", "main", "docs/ai", "temp/**")!;
			expect(template).toContain('find quartz/content -path "quartz/content/temp/**" -delete');
		});
	});
});
