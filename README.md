# obsidian-ghvault

**GHVault** — bidirectional vault-GitHub sync plugin for [Obsidian](https://obsidian.md). No git CLI required. Works on desktop and mobile.

Syncs your vault to a GitHub repository using the REST and GraphQL APIs directly — no `git` binary, no shell commands, no desktop-only dependencies. Designed from the ground up to work everywhere Obsidian runs, including iOS and Android.

## Features

- **Push & Pull** — sync changes in both directions between your vault and a GitHub repo
- **Mobile-first** — works on iOS, Android, and desktop equally
- **No git CLI** — uses GitHub REST API for reads and GraphQL `createCommitOnBranch` for writes
- **Conflict detection** — files changed on both sides are skipped (not overwritten) and reported
- **Automatic GPG signing** — commits made via GraphQL are signed by GitHub automatically
- **Rate limit aware** — tracks GitHub API rate limits and pauses before hitting them
- **SHA integrity checks** — verifies downloaded file content matches GitHub's reported SHA
- **Selective sync** — `.obsidian/`, `.trash/`, and log files are never synced
- **Parallel operations** — file downloads and hash computation run with controlled concurrency

## Installation

> GHVault is not yet published to the Obsidian Community Plugins directory. Manual installation is required for now.

1. Download the latest release from [Releases](https://github.com/nyxene/obsidian-ghvault/releases)
2. Extract `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/ghvault/` directory
3. Open Obsidian Settings → Community Plugins → Enable "GHVault"

## Setup

### 1. Create a GitHub Personal Access Token

Go to [GitHub Settings → Developer Settings → Fine-grained tokens](https://github.com/settings/tokens?type=beta) and create a token with:

- **Repository access**: select the repository you want to sync with
- **Permissions**:
  - Contents: Read and Write
  - Metadata: Read-only

> Fine-grained tokens are recommended over classic tokens — they limit access to specific repos and permissions.

### 2. Configure the plugin

Open Obsidian Settings → GHVault and fill in:

| Setting | Description |
|---------|-------------|
| **GitHub Token** | Your Personal Access Token |
| **Owner** | GitHub username or organization |
| **Repository** | Repository name |
| **Branch** | Branch to sync with (default: `main`) |
| **Log Level** | `info`, `debug`, `warn`, or `error` |

### 3. Sync

Click the GHVault icon in the ribbon or run the **GHVault: Sync** command from the command palette.

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
2. **Conflict check**: detect files changed on both sides — skip them, report to user
3. **Push**: collect local changes, batch them into a single GraphQL commit

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

When the same file is changed both locally and on GitHub between syncs, GHVault **skips the file on both sides** and reports it as a conflict. Neither version is overwritten. This is the safest default — you can resolve conflicts manually.

## Security

- **Token storage**: your GitHub PAT is stored in Obsidian's `data.json` (plaintext). This is an Obsidian platform limitation — no secure keychain API is available. We recommend using fine-grained tokens with minimal scopes.
- **Token redaction**: tokens are never displayed in the UI or written to logs. Error messages are sanitized before display.
- **Path traversal protection**: all file paths from GitHub are validated against directory traversal attacks before any read/write operation.
- **SHA integrity**: downloaded file content is verified against GitHub's reported SHA to detect tampering or corruption.
- **Request timeouts**: all HTTP requests have a 30-second timeout to prevent indefinite hangs.
- **OWASP audited**: the codebase has been audited against the OWASP Top 10.

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
    state.ts               # SHA cache + sync state
    vault-adapter.ts       # Obsidian Vault API adapter
  utils/
    base64.ts              # Base64 encode/decode
    concurrency.ts         # Controlled parallel execution
    hash.ts                # SHA-256 / Git blob SHA
    logger.ts              # Structured JSON logger
    path.ts                # Path mapping and validation
  ui/
    status-bar.ts          # Status bar widget
```

## License

[MIT](LICENSE)
