# obsidian-ghvault

[![Release](https://img.shields.io/github/v/release/nyxene/obsidian-ghvault?style=flat-square)](https://github.com/nyxene/obsidian-ghvault/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/nyxene/obsidian-ghvault/ci.yml?style=flat-square)](https://github.com/nyxene/obsidian-ghvault/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

**GHVault** — bidirectional vault-GitHub sync plugin for [Obsidian](https://obsidian.md). No git CLI required. Works on desktop and mobile.

Syncs your vault to a GitHub repository using the REST and GraphQL APIs directly — no `git` binary, no shell commands, no desktop-only dependencies. Designed from the ground up to work everywhere Obsidian runs, including iOS and Android.

## Why GHVault?

Most Obsidian-to-GitHub solutions wrap the `git` CLI, which means they only work on desktop or require complex mobile workarounds. GHVault takes a different approach:

| | GHVault | git-based plugins |
|---|---|---|
| Mobile (iOS/Android) | Full support | Limited or none |
| Git CLI required | No | Yes |
| Commit signing | Automatic (GPG via GitHub) | Manual setup |
| Setup complexity | Token + repo name | Git install + SSH keys + config |
| Conflict handling | Per-file resolution (skip, local/remote wins, or interactive) | Merge conflicts (manual resolution) |

If you want simple, reliable vault backup to GitHub that works the same on every device — GHVault is for you.

## Features

- **Push & Pull** — sync changes in both directions between your vault and a GitHub repo
- **Auto-sync** — automatically syncs when files change in the vault, with configurable debounce (1–300 seconds)
- **Remote pull check** — periodically checks for remote changes and pulls them automatically, with adaptive backoff when idle
- **Mobile-first** — works on iOS, Android, and desktop equally
- **No git CLI** — uses GitHub REST API for reads and GraphQL `createCommitOnBranch` for writes
- **Conflict resolution** — configurable strategy for files changed on both sides: skip (default), local-wins, remote-wins, or ask (interactive per-file modal)
- **Rename detection** — detects file renames (delete + create with same content) in both directions, reports them in sync notices
- **Automatic GPG signing** — commits made via GraphQL are signed by GitHub automatically
- **Rate limit aware** — tracks GitHub API rate limits and pauses before hitting them
- **SHA integrity checks** — verifies downloaded file content matches GitHub's reported SHA
- **Subfolder sync** — sync a specific folder in the repo instead of the entire repository
- **Selective sync** — `.obsidian/`, `.trash/`, and log files are never synced
- **Parallel operations** — file downloads and hash computation run with controlled concurrency
- **Crash recovery** — pending changes are persisted to disk and restored after restart

## Requirements

- Obsidian **1.5.0+** (desktop or mobile)
- A GitHub repository (public or private)
- GitHub Personal Access Token ([fine-grained](https://github.com/settings/tokens?type=beta) recommended)
- Internet connection (no offline sync)

## Installation

> [!NOTE]
> GHVault is in active development. We recommend testing on a non-critical repository first and keeping backups of important vaults.

GHVault is not yet in the Obsidian Community Plugins directory. Install manually:

1. Download the latest release from [Releases](https://github.com/nyxene/obsidian-ghvault/releases)
2. Extract `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/ghvault/` directory
3. Open Obsidian Settings → Community Plugins → Enable "GHVault"

## Setup

### 1. Create a GitHub Personal Access Token

Go to [GitHub Settings → Fine-grained tokens](https://github.com/settings/tokens?type=beta) and create a token with:

- **Repository access**: select the repository you want to sync with
- **Permissions**:
  - Contents: Read and Write
  - Metadata: Read-only

> Fine-grained tokens are recommended over classic tokens — they limit access to specific repos and permissions.

### 2. Configure the plugin

Open Obsidian Settings → GHVault and fill in:

![GHVault Settings](docs/screenshots/settings.png)

| Setting | Description |
|---------|-------------|
| **GitHub Token** | Your Personal Access Token |
| **Owner** | GitHub username or organization |
| **Repository** | Repository name |
| **Branch** | Branch to sync with (default: `main`) |
| **Sync Folder** | Subfolder in the repo to sync (leave empty for entire repo) |
| **Auto-sync** | Automatically sync when vault files change (default: off) |
| **Auto-sync debounce** | Seconds to wait after last change before syncing (1–300, default: 10) |
| **Remote pull interval** | Base interval in seconds to check for remote changes (30–3600, default: 300). Backs off automatically when idle. |
| **Conflict strategy** | How to handle files changed on both sides: `skip` (default), `local-wins`, `remote-wins`, or `ask` (per-file modal) |
| **Log Level** | `info`, `debug`, `warn`, or `error` |

Use the **Test Connection** button to verify your settings before syncing.

### 3. Sync

Click the GHVault icon in the ribbon or run the **GHVault: Sync now** command from the command palette. Enable **Auto-sync** to sync automatically when you create, edit, delete, or rename files — the plugin waits for the debounce period after your last change before syncing.

The status bar shows the current state:

![GHVault: idle](docs/screenshots/vault-idle.png) ![GHVault: syncing...](docs/screenshots/vault-syncing.png)

## How it works

```
┌─────────────┐         ┌──────────────┐         ┌──────────┐
│  Obsidian   │         │   GHVault    │         │  GitHub  │
│  Vault      │◄───────►│   Plugin     │◄───────►│  API     │
│  (files)    │  read/  │   (sync      │  REST/  │  (repo)  │
│             │  write  │   engine)    │  GQL    │          │
└─────────────┘         └──────────────┘         └──────────┘
```

### Sync cycle

1. **Pull**: fetch the latest commit and tree from GitHub, compare with local cache, download changed files
2. **Conflict check**: detect files changed on both sides — resolve based on chosen strategy
3. **Push**: collect local changes, batch them into a single GraphQL commit

On **first sync** with a non-empty vault and repo, GHVault compares content hashes for files that exist on both sides. Identical files are cached without transfer. Files with different content are treated as conflicts.

### API usage

| Operation | API | Why |
|-----------|-----|-----|
| Read files, trees, refs | REST API | Granular access, works with large repos |
| Create commits | GraphQL `createCommitOnBranch` | Batch multiple file changes in one commit, auto GPG sign |
| First sync | Trees API + batch Contents API | Efficient initial download without cloning |

### What gets synced

Everything in your vault **except**:

- `.obsidian/` — Obsidian configuration (device-specific)
- `.trash/` — Obsidian trash
- `ghvault.log` — plugin log file
- Files > 50MB — GitHub API hard limit

### Conflict handling

When the same file is changed both locally and on GitHub between syncs, GHVault resolves the conflict based on the configured strategy:

| Strategy | Behavior |
|----------|----------|
| **Skip** (default) | Skip the file on both sides — neither version is overwritten |
| **Local wins** | Push the local version to GitHub, overwriting the remote |
| **Remote wins** | Pull the remote version to the vault, overwriting the local |
| **Ask** | Show a modal listing each conflict — choose "Keep Local" or "Keep Remote" per file |

The number of conflicts (or resolved files) is shown in the sync Notice.

## Limitations

- **No offline sync** — requires an internet connection. Changes are queued locally but not synced until online.
- **File size limits** — files over 50MB are skipped (GitHub API limit). Files over 1.5MB use a slower upload path due to GraphQL payload limits.
- **No merge** — conflicting files are resolved by choosing one version (local or remote), not by merging content.
- **API rate limits** — GitHub allows 5,000 REST requests/hour and 5,000 GraphQL points/hour. Large vaults with thousands of files may hit limits during initial sync.
- **Single branch** — syncs with one branch at a time. No multi-branch workflows.
- **No real-time sync** — remote changes are detected via periodic polling (not webhooks/websockets). The default check interval is 5 minutes, with adaptive backoff when idle.

## Security

- **Token storage**: your GitHub PAT is stored in Obsidian's `data.json` (plaintext). This is an Obsidian platform limitation — no secure keychain API is available. We recommend using fine-grained tokens with minimal scopes.
- **Token redaction**: tokens are never displayed in the UI or written to logs. Error messages are sanitized before display.
- **Path traversal protection**: all file paths from GitHub are validated against directory traversal attacks before any read/write operation.
- **SHA integrity**: downloaded file content is verified against GitHub's reported SHA to detect tampering or corruption.
- **Request timeouts**: all HTTP requests have a 30-second timeout to prevent indefinite hangs.
- **OWASP audited**: the codebase has been audited against the OWASP Top 10.

## Getting help

- **Questions?** Start a [Discussion](https://github.com/nyxene/obsidian-ghvault/discussions)
- **Found a bug?** Open an [Issue](https://github.com/nyxene/obsidian-ghvault/issues)
- **Feature idea?** Post in [Discussions → Ideas](https://github.com/nyxene/obsidian-ghvault/discussions/categories/ideas)

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
git clone https://github.com/nyxene/obsidian-ghvault.git
cd obsidian-ghvault
npm install
```

### Commands

```bash
npm run dev           # Build in watch mode
npm run build         # Production build
npm run lint          # Lint with Biome
npm run format        # Auto-fix lint issues
npm run type-check    # TypeScript type checking
npm run test          # Run tests
npm run test:coverage # Tests with coverage report
npm run test:bench    # Run benchmarks
npm run test:e2e      # E2E tests (requires Obsidian, runs via wdio-obsidian-service)
```

### Project structure

```
src/
  main.ts                  # Plugin entry point
  settings.ts              # Settings tab
  types.ts                 # Interfaces and types
  github/
    client.ts              # REST API wrapper
    graphql.ts             # GraphQL mutations
    rate-limit.ts          # Rate limit tracking
    request-timeout.ts     # Request timeout wrapper
  sync/
    engine.ts              # Sync orchestrator
    pull.ts                # Pull engine (remote → local)
    push.ts                # Push engine (local → remote)
    comparator.ts          # Local/remote diff computation
    change-queue.ts        # Debounced event queue for auto-sync
    state.ts               # SHA cache + sync state
    vault-adapter.ts       # Obsidian Vault API adapter
  utils/
    base64.ts              # Base64 encode/decode
    concurrency.ts         # Controlled parallel execution
    hash.ts                # SHA-256 / Git blob SHA
    logger.ts              # Structured JSON logger
    path.ts                # Path mapping and validation
```

## License

[MIT](LICENSE)
