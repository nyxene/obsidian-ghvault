# How It Works

GHVault syncs your vault with GitHub using the REST and GraphQL APIs directly — no git binary involved.

```
┌─────────────┐         ┌──────────────┐         ┌──────────┐
│  Obsidian   │         │   GHVault    │         │  GitHub  │
│  Vault      │◄───────►│   Plugin     │◄───────►│  API     │
│  (files)    │  read/  │   (sync      │  REST/  │  (repo)  │
│             │  write  │   engine)    │  GQL    │          │
└─────────────┘         └──────────────┘         └──────────┘
```

## Sync cycle

1. **Pull** — fetch the latest commit and tree from GitHub, compare with local cache, download changed files
2. **Conflict check** — detect files changed on both sides, resolve based on chosen strategy
3. **Push** — collect local changes, batch into a single GraphQL commit

On **first sync**, GHVault compares content hashes for files on both sides. Identical files are cached without transfer; different content is treated as a conflict.

## API usage

| Operation | API | Why |
|-----------|-----|-----|
| Read files, trees, refs | REST API | Granular access, works with large repos |
| Create commits | GraphQL `createCommitOnBranch` | Batch changes in one commit, auto GPG sign |
| First sync | Trees API + batch Contents API | Efficient tree walk + per-file download |

## What gets synced

Everything in your vault **except**:

- `.obsidian/` — Obsidian configuration (device-specific)
- `.trash/` — Obsidian trash
- `ghvault.log` — plugin log file
- Files > 50 MB — GitHub API hard limit
- Custom [exclude patterns](settings.md#exclude-patterns)
- Files with `ghvault-sync: false` in frontmatter

## Limitations

- **No offline sync** — changes queue locally but only sync when online
- **File size** — files > 50 MB are skipped (GitHub API limit); files > 1.5 MB use a slower REST fallback
- **API rate limits** — 5,000 REST requests/hour, 5,000 GraphQL points/hour; large initial syncs may hit limits
- **Single branch** — syncs with one branch at a time
- **No line-level merge** — conflicts are resolved per file or per hunk, not by merging individual lines within a hunk
- **Polling, not real-time** — remote changes are detected periodically (default 5 min, adaptive backoff)

## Security

- **Token storage**: PAT is stored in Obsidian's `data.json` (plaintext) — platform limitation. Use fine-grained tokens with minimal scopes.
- **Token redaction**: tokens are never displayed in UI or written to logs.
- **Path traversal protection**: file paths from GitHub are validated before any read/write.
- **SHA integrity**: downloaded content is verified against GitHub's reported SHA.
- **Request timeouts**: 30-second timeout on all HTTP requests.
- **OWASP audited**: codebase audited against the OWASP Top 10.
