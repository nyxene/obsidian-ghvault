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
