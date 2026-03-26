import type { PagesGenerator } from "../types";

interface TemplateOptions {
	branch: string;
	syncFolder: string;
	excludePatterns: string;
}

function excludeStep(contentDir: string, excludePatterns: string): string {
	const lines: string[] = [
		`      - name: Exclude unpublished and filtered files`,
		`        run: |`,
		`          grep -rl "ghvault-publish: false" ${contentDir} --include="*.md" | xargs rm -f || true`,
	];
	const patterns = excludePatterns
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith("#"));
	for (const pattern of patterns) {
		lines.push(
			`          find ${contentDir} -path "${contentDir}/${pattern}" -delete 2>/dev/null || true`,
		);
	}
	return lines.join("\n");
}

const PAGES_PERMISSIONS = `permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true`;

const DEPLOY_JOB = `  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5`;

function contentSource(syncFolder: string): string {
	if (!syncFolder) return "vault";
	return `vault/${syncFolder}`;
}

function quartzTemplate(opts: TemplateOptions): string {
	const src = contentSource(opts.syncFolder);
	return `name: Deploy vault to GitHub Pages (Quartz)

on:
  repository_dispatch:
    types: [vault-synced]

${PAGES_PERMISSIONS}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout vault
        uses: actions/checkout@v5
        with:
          path: vault

      - name: Clone Quartz
        uses: actions/checkout@v5
        with:
          repository: jackyzha0/quartz
          ref: v4
          path: quartz

      - uses: actions/setup-node@v5
        with:
          node-version: 22

      - name: Install Quartz dependencies
        run: npm ci
        working-directory: quartz

      - name: Copy vault content into Quartz
        run: |
          cp -a "${src}/." quartz/content/
          if [ ! -f quartz/content/index.md ]; then
            echo '---' > quartz/content/index.md
            echo 'title: Home' >> quartz/content/index.md
            echo '---' >> quartz/content/index.md
            echo '' >> quartz/content/index.md
            echo 'Welcome to my vault.' >> quartz/content/index.md
          fi

${excludeStep("quartz/content", opts.excludePatterns)}

      - name: Set base URL
        run: |
          REPO_NAME=\${GITHUB_REPOSITORY#*/}
          OWNER=\${GITHUB_REPOSITORY_OWNER}
          sed -i "s|baseUrl:.*|baseUrl: \\"\${OWNER}.github.io/\${REPO_NAME}\\",|" quartz.config.ts
        working-directory: quartz

      - name: Build Quartz
        run: npx quartz build
        working-directory: quartz

      - uses: actions/upload-pages-artifact@v4
        with:
          path: quartz/public

${DEPLOY_JOB}
`;
}

function mkdocsTemplate(opts: TemplateOptions): string {
	const src = contentSource(opts.syncFolder);
	return `name: Deploy vault to GitHub Pages (MkDocs)

on:
  repository_dispatch:
    types: [vault-synced]

${PAGES_PERMISSIONS}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          path: vault

      - name: Prepare MkDocs project
        run: |
          mkdir -p mkdocs-build/docs
          cp -a "${src}/." mkdocs-build/docs/
          if [ ! -f mkdocs-build/docs/index.md ]; then
            echo '# Home' > mkdocs-build/docs/index.md
            echo '' >> mkdocs-build/docs/index.md
            echo 'Welcome to my vault.' >> mkdocs-build/docs/index.md
          fi
          REPO_NAME=\${GITHUB_REPOSITORY#*/}
          OWNER=\${GITHUB_REPOSITORY_OWNER}
          if [ -f ${src}/mkdocs.yml ]; then
            cp ${src}/mkdocs.yml mkdocs-build/
          else
            echo "site_name: $REPO_NAME" > mkdocs-build/mkdocs.yml
            echo "site_url: https://$OWNER.github.io/$REPO_NAME/" >> mkdocs-build/mkdocs.yml
            echo "theme:" >> mkdocs-build/mkdocs.yml
            echo "  name: material" >> mkdocs-build/mkdocs.yml
          fi

${excludeStep("mkdocs-build/docs", opts.excludePatterns)}

      - uses: actions/setup-python@v6
        with:
          python-version: "3.x"

      - name: Install MkDocs
        run: pip install mkdocs-material

      - name: Build MkDocs
        run: mkdocs build
        working-directory: mkdocs-build

      - uses: actions/upload-pages-artifact@v4
        with:
          path: mkdocs-build/site

${DEPLOY_JOB}
`;
}

function starlightTemplate(opts: TemplateOptions): string {
	const src = contentSource(opts.syncFolder);
	return `name: Deploy vault to GitHub Pages (Astro Starlight)

on:
  repository_dispatch:
    types: [vault-synced]

${PAGES_PERMISSIONS}

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          path: vault

      - uses: actions/setup-node@v5
        with:
          node-version: 22

      - name: Create Starlight project
        run: |
          npm create astro@latest starlight -- --template starlight --no-install --no-git -y
          rm -rf starlight/src/content/docs/*
          cp -a "${src}/." starlight/src/content/docs/
          if [ ! -f starlight/src/content/docs/index.md ] && [ ! -f starlight/src/content/docs/index.mdx ]; then
            echo '---' > starlight/src/content/docs/index.md
            echo 'title: Home' >> starlight/src/content/docs/index.md
            echo '---' >> starlight/src/content/docs/index.md
            echo '' >> starlight/src/content/docs/index.md
            echo 'Welcome to my vault.' >> starlight/src/content/docs/index.md
          fi

      - name: Add missing title frontmatter
        run: |
          find starlight/src/content/docs -name '*.md' -print0 | while IFS= read -r -d '' file; do
            if ! head -n 1 "$file" | grep -q '^---'; then
              title=$(basename "$file" .md)
              { echo '---'; echo "title: $title"; echo '---'; echo ''; cat "$file"; } > "$file.tmp"
              mv "$file.tmp" "$file"
            elif ! grep -q '^title:' "$file"; then
              title=$(basename "$file" .md)
              sed -i "1a title: $title" "$file"
            fi
          done

${excludeStep("starlight/src/content/docs", opts.excludePatterns)}

      - name: Configure Starlight
        run: |
          REPO_NAME=\${GITHUB_REPOSITORY#*/}
          OWNER=\${GITHUB_REPOSITORY_OWNER}
          echo "import { defineConfig } from 'astro/config';" > starlight/astro.config.mjs
          echo "import starlight from '@astrojs/starlight';" >> starlight/astro.config.mjs
          echo "export default defineConfig({" >> starlight/astro.config.mjs
          echo "  site: 'https://\${OWNER}.github.io'," >> starlight/astro.config.mjs
          echo "  base: '/\${REPO_NAME}'," >> starlight/astro.config.mjs
          echo "  integrations: [starlight({ title: '\${REPO_NAME}' })]," >> starlight/astro.config.mjs
          echo "});" >> starlight/astro.config.mjs

      - name: Install dependencies
        run: npm install
        working-directory: starlight

      - name: Build Starlight
        run: npx astro build
        working-directory: starlight

      - uses: actions/upload-pages-artifact@v4
        with:
          path: starlight/dist

${DEPLOY_JOB}
`;
}

const templates: Record<PagesGenerator, (opts: TemplateOptions) => string> = {
	quartz: quartzTemplate,
	mkdocs: mkdocsTemplate,
	starlight: starlightTemplate,
};

export function getWorkflowTemplate(
	generator: PagesGenerator,
	branch: string,
	syncFolder = "",
	excludePatterns = "",
): string {
	const fn = templates[generator];
	return fn({ branch, syncFolder, excludePatterns });
}
