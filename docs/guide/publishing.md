# Publishing to GitHub Pages

Turn your vault into a live website using GitHub Pages and a static site generator (SSG).

## How it works

```
Edit notes in Obsidian
  → GHVault pushes to GitHub (auto-sync or manual)
    → Dispatch triggers SSG workflow
      → SSG builds website from Markdown
        → GitHub Pages serves it (1-2 min)
```

GHVault handles the sync and trigger. The SSG (Quartz, MkDocs, etc.) handles the build. GitHub Pages handles the hosting.

### Zero-touch publishing

With **auto-sync** enabled, the entire flow is automatic:

1. You edit a note in Obsidian
2. GHVault detects the change and waits for the debounce interval
3. Changes are pushed to GitHub
4. A `repository_dispatch` event triggers the deploy workflow
5. The SSG builds your site and GitHub Pages deploys it

Your site updates within 1-2 minutes of saving a note — no manual steps required.

## Supported generators

| Generator | Language | Best for | Setup complexity |
|-----------|----------|----------|-----------------|
| [Quartz](https://quartz.jzhao.xyz/) | Node.js | Obsidian-native digital gardens | Low |
| [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) | Python | Documentation sites | Low |
| [Astro Starlight](https://starlight.astro.build/) | Node.js | Documentation sites with modern UI | Low |

**Quartz** is recommended for most Obsidian users — it understands wiki-links, backlinks, and graph views natively.

## Step 1: Enable publishing

1. Open **Settings -> GHVault -> Publishing**
2. Turn on **Publish to GitHub Pages**
3. Select your **Static site generator**

> Enabling publishing automatically turns on "Trigger workflow on push" in the Integrations section.

## Step 2: Generate workflow (Quartz, MkDocs)

1. Click **Generate** next to "Generate workflow"
2. GHVault creates `.github/workflows/deploy.yml` in your repository
3. The workflow triggers on every push and on `repository_dispatch` events

After the first generation, the button changes to **Regenerate**. Use it when you:
- Switch to a different SSG (e.g. Quartz -> Hugo)
- Change the sync branch in settings
- Change the sync folder
- Update the plugin and want the latest workflow template

Regenerate overwrites the existing workflow file.

### What the Quartz workflow does

The generated Quartz workflow:
1. Clones `jackyzha0/quartz` v4 from GitHub
2. Copies your vault content into `quartz/content/`
3. Auto-generates an `index.md` if one is missing (so the site always has a home page)
4. Auto-sets `baseUrl` in `quartz.config.ts` from `GITHUB_REPOSITORY` (no manual config needed)
5. Runs `npx quartz build` and deploys to GitHub Pages

### syncFolder support

If you have a **Sync folder** set (e.g. `docs/ai`), only that subfolder is copied to the SSG content directory — not the entire vault. This lets you keep your vault organized while publishing only a subset of notes.

### excludePatterns in the workflow

Your **Exclude patterns** from settings (e.g. `drafts/**`, `*.tmp`) are applied during the build. The workflow runs `find -delete` commands to remove matching files before the SSG processes them. This means excluded files are synced to GitHub but not published to your site.

## Step 3: Enable GitHub Pages

1. In GHVault settings, click the **"Open repo settings"** link next to "Enable GitHub Pages"
2. In your repository's Pages settings, set **Source** to **GitHub Actions**
3. Save

> There is no API button for enabling Pages — GitHub requires you to enable it manually in the repository settings.

After enabling Pages, the **Visit site** link will appear in GHVault settings once the first deploy completes.

## Step 4: Publish

Push a note (manually or via auto-sync) and your site will build automatically:
1. GHVault pushes changes to GitHub
2. Dispatch event triggers the workflow
3. SSG builds the site from your Markdown files
4. GitHub Pages deploys the result

## Customizing the home page

When you first deploy, GHVault generates a default `index.md` with "Welcome to my vault." as the home page. To replace it with your own content:

1. Create a file named exactly **`index.md`** (lowercase) in your sync folder
2. Write your home page content
3. Sync — the next deploy will use your file instead of the generated one

> **Important:** The file must be named `index.md` (not `Index.md`, `README.md`, or `home.md`). This is a requirement of all SSGs — they look for `index.md` as the root page.

If you already have a generated home page and want to replace it, simply create `index.md` in your vault's sync folder and sync. The workflow only generates the default if `index.md` doesn't exist in your content.

## Excluding notes from publishing

By default, all synced notes are published. To exclude a note, add this to its YAML frontmatter:

```yaml
---
ghvault-publish: false
---
```

The deploy workflow includes a pre-build step that removes files marked with `ghvault-publish: false` before the SSG processes them. The files remain in your repo (synced) but are not included in the built website.

## SSG configuration

All SSGs work out of the box — the generated workflow auto-configures each one. You can override the defaults by adding your own config file.

### Quartz

**Auto-configured:** `baseUrl` is set from `GITHUB_REPOSITORY`, `index.md` is created if missing.

To customize, add `quartz.config.ts` to your repo root. See the [Quartz docs](https://quartz.jzhao.xyz/configuration).

### MkDocs Material

**Auto-configured:** `site_name`, `site_url`, and Material theme are set automatically. An `index.md` is created if missing.

To customize, add `mkdocs.yml` to your sync folder (or repo root). Example:

```yaml
site_name: My Vault
site_url: https://username.github.io/repo-name/
theme:
  name: material
  palette:
    scheme: slate
```

See the [MkDocs Material docs](https://squidfunk.github.io/mkdocs-material/getting-started/).

## Token permissions

Publishing requires additional token scopes beyond basic sync:

| Permission | Scope | Why |
|-----------|-------|-----|
| Contents | Read and write | Push files + sync (already required) |
| Workflows | Read and write | Create/update `.github/workflows/` files |

> **Note:** You do NOT need Pages scope on your token. GitHub Pages deployment is handled by the workflow itself using `id-token: write` permissions. The Workflows scope is needed only to push the `deploy.yml` file to your repo.

If your token was created before enabling publishing, update it at [GitHub Settings -> Fine-grained tokens](https://github.com/settings/tokens?type=beta) — add the **Workflows** permission.

## Troubleshooting

**Pages not building after push:**
- Check that "Trigger workflow on push" is enabled in Integrations
- Verify the workflow file exists in `.github/workflows/`
- Go to your repo -> Actions tab -> check for workflow runs
- If auto-sync is enabled, ensure the debounce has passed (default 10s)

**Pages not enabled:**
- Click the "Open repo settings" link in GHVault Publishing settings
- Set Source to "GitHub Actions" and save
- There is no API button — this must be done manually in GitHub

**Site shows 404:**
- Pages may take a few minutes to deploy after the first build
- Check the Actions tab for build errors
- Verify your SSG configuration files are correct
- For Quartz: the workflow auto-sets `baseUrl`, but check it matches your repo name

**"Visit site" link not showing:**
- The link appears after the first successful deploy
- Enable Pages first (Step 3), then push a change to trigger the workflow

**Workflow fails with permission error:**
- Ensure your token has **Workflows: Read and write** permission
- You do NOT need Pages scope — the workflow handles deployment

**Notes marked `ghvault-publish: false` still appear:**
- Check the frontmatter syntax — it must be valid YAML
- Ensure the key is exactly `ghvault-publish: false` (not `ghvault_publish` or `publish`)

**Only some files are published (syncFolder):**
- This is expected — when syncFolder is set, only that subfolder is copied to the SSG
- Check that your notes are in the correct subfolder
