# Settings Reference

All GHVault settings, organized by section.

---

## Connection

### GitHub token

Your GitHub Personal Access Token (PAT). Use a [fine-grained token](https://github.com/settings/tokens?type=beta) with minimal permissions:

| Permission | Scope | Required |
|-----------|-------|----------|
| Contents | Read and write | Yes |
| Metadata | Read-only | Yes (auto) |
| Gists | Read and write | Only for Share as Gist |
| Workflows | Read and write | Only for generating deploy workflow file (publishing) |

The token is stored in your vault's `data.json` file (Obsidian plugin storage). There is no secure keychain API available on all platforms. Mitigations:
- Use a fine-grained PAT scoped to a single repository
- Do not sync your `.obsidian/` folder via cloud storage if security is a concern

**Forget token** — removes the token from storage. You will need to re-enter it to sync again.

### Repository owner

GitHub username or organization that owns the repository. Example: `nyxene`.

### Repository name

The repository to sync with. Example: `my-vault`.

### Branch

Git branch to sync with. Default: `main`.

### Sync folder

Sync a subfolder of the repository instead of the root. Leave empty to sync the entire repo. Example: `notes/` syncs only the `notes` directory.

### Test connection

Verifies that the token, owner, repo, and branch are valid and accessible.

---

## Sync

### Auto-sync

When enabled, GHVault automatically pushes changes when you create, modify, delete, or rename files in your vault. Changes are batched using the debounce interval below.

Remote changes are also checked periodically (see Remote pull interval).

Default: **off**.

### Auto-sync debounce

How long to wait after the last file change before pushing. Prevents excessive API calls during rapid editing.

- Range: 1–300 seconds
- Default: **10 seconds**

### Remote pull interval

How often to check for remote changes when auto-sync is enabled. Uses adaptive backoff — if no changes are found, the interval gradually increases.

- Range: 30–3600 seconds
- Default: **300 seconds** (5 minutes)

### Conflict strategy

What to do when a file has been changed both locally and on GitHub since the last sync:

| Strategy | Behavior |
|----------|----------|
| **Skip** (default) | Leave the file unchanged, report the conflict |
| **Local wins** | Overwrite remote with local version |
| **Remote wins** | Overwrite local with remote version |
| **Ask** | Show an interactive modal with inline diff view and per-hunk accept/reject |

---

## Filtering

### Exclude patterns

Glob patterns for files to exclude from sync. One pattern per line.

Examples:
```
drafts/**
*.tmp
private/**
```

The following paths are always excluded: `.obsidian/**`, `.trash/**`, `ghvault.log`.

You can also exclude individual files by adding `ghvault-sync: false` to the file's YAML frontmatter:

```yaml
---
ghvault-sync: false
---
```

---

## Publishing

### Publish to GitHub Pages

Master toggle for website publishing. When enabled, shows SSG selection and workflow generation controls.

Enabling this automatically turns on "Trigger workflow on push" in Integrations.

Default: **off**. See the [Publishing Guide](publishing.md) for step-by-step setup.

### Static site generator

Choose which SSG builds your website:

| Generator | Best for |
|-----------|----------|
| **Quartz** (default) | Obsidian-native digital gardens with wiki-links and backlinks |
| **MkDocs Material** | Documentation sites |
| **Astro Starlight** | Documentation sites with modern UI |

### Generate workflow

Creates `.github/workflows/deploy.yml` in your repository. The workflow:
- Triggers on `repository_dispatch` (after GHVault push) and on direct `push`
- Excludes notes marked with `ghvault-publish: false`
- Builds the site with the selected SSG
- Deploys to GitHub Pages

Not needed for Jekyll (uses GitHub's built-in build).

### Enable GitHub Pages

Shows a direct link to your repository's Pages settings on GitHub. Click it to open the settings page where you set Source to "GitHub Actions". There is no API button — GitHub requires manual enablement.

After Pages is enabled and the first deploy succeeds, a **Visit site** link will appear in settings.

### Auto-deploy flow

When **auto-sync** is enabled, publishing is fully automatic:

1. You edit a note in Obsidian
2. GHVault waits for the debounce interval (default 10s)
3. Changes are pushed to GitHub
4. A `repository_dispatch` event triggers the deploy workflow
5. Your site updates within 1-2 minutes

No manual sync or dispatch is needed — just edit and save.

### Selective exclusion

To exclude a note from the published site while keeping it synced, add:

```yaml
---
ghvault-publish: false
---
```

---

## Integrations

### Trigger workflow on push

When enabled, GHVault sends a [`repository_dispatch`](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#repository_dispatch) event to GitHub after each successful push. This triggers any GitHub Actions workflow that listens for the configured event type.

Use cases:
- Publish your vault as a website (Quartz, MkDocs, Hugo)
- Generate backups
- Send notifications
- Run custom automation

Default: **off**. See the [Workflow Dispatch Guide](workflow-dispatch.md) for step-by-step setup.

### Event type

The event type string sent with the dispatch. Must match the `types` filter in your workflow file.

Default: `vault-synced`.

Example workflow trigger:
```yaml
on:
  repository_dispatch:
    types: [vault-synced]
```

---

## Advanced

### Log level

Minimum severity for log messages written to `ghvault.log` in your vault root.

| Level | What's logged |
|-------|--------------|
| **Debug** | Everything — API calls, file hashes, cache operations |
| **Info** (default) | Sync results, configuration changes, warnings |
| **Warning** | Issues that don't prevent sync but may need attention |
| **Error** | Failures only |

The log file is automatically excluded from sync.
