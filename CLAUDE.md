# CLAUDE.md

## Project

GHVault — Obsidian plugin for bidirectional vault-GitHub sync via REST/GraphQL API (no git CLI, mobile-first).

## Language

- Code, comments, commit messages, PR titles/descriptions, public docs — **English only**

## Tech Stack

- TypeScript (strict mode), esbuild, Biome (lint + format), Obsidian API
- Target: ES2020, desktop + mobile (iOS/Android)
- HTTP: `requestUrl()` from Obsidian (CORS-free, mobile-compatible)
- Storage: `plugin.saveData()` / `plugin.loadData()`

## Project Structure

```
src/
  main.ts                  # Plugin entry point
  settings.ts              # Settings tab
  types.ts                 # All interfaces and types
  github/
    client.ts              # REST API wrapper
    graphql.ts             # GraphQL mutations
    rate-limit.ts          # Rate limit tracking
  sync/
    engine.ts              # Sync orchestrator
    change-queue.ts        # Debounced event queue
    sha-cache.ts           # SHA + content hash cache
    diff.ts                # Local vs remote diff
    first-sync.ts          # Initial sync logic
  utils/
    base64.ts              # Base64 encode/decode
    hash.ts                # SHA-256 via Web Crypto
    path.ts                # Path mapping (vault <-> repo)
    logger.ts              # Structured JSON logger
  ui/
    status-bar.ts          # Status bar widget
scripts/
  github.sh                # GitHub CLI wrapper (uses .env)
  ruleset-main.json        # Branch protection rules
docs/
  private/                 # Internal docs (not committed)
```

## Git Workflow

- Branch protection on `main`: PRs only, linear history, required status checks
- Commit style: conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`)
- Always create new commits, never amend unless explicitly asked
- Use `scripts/github.sh` for GitHub operations (reads credentials from `.env`)
- Releases: [release-please](https://github.com/googleapis/release-please) — automated versioning and CHANGELOG from conventional commits
  - Merging to `main` triggers release-please PR with version bump + CHANGELOG update
  - Merging that PR creates a GitHub release + git tag
  - Commit messages drive versioning: `feat:` = minor, `fix:` = patch, `feat!:` / `BREAKING CHANGE` = major

### Git — LOGBOOK Protocol

> Full protocol: [LOGBOOK.md](./LOGBOOK.md)

- **Plan first:** No implementation without an approved plan. Plans are documented in `docs/plans/specs/`
- **Approval required:** The Aronnax must explicitly approve, request revision, or reject every plan before work begins
- **Feature branches:** All implementation work happens on `feat/` or `fix/` branches, never directly on `main`
- **No auto-commit:** After implementation, run all checks locally, report what was done, and WAIT. Never commit until the Aronnax says "вливай"
- **Aronnax merges:** Nemo creates PRs but NEVER merges them. The Aronnax merges manually after CI passes
- **Pre-commit:** Biome auto-check via Husky + lint-staged
- **Commit message:** Conventional commits enforced by commitlint (`type(scope): description`)
- **Commit signature:** `Co-Authored-By: Nemo <nemo@20000leagues.noreply>` (NEVER use default Claude signature)
- **PR footer:** `*Mobilis in Mobili*` — NEVER use `🤖 Generated with Claude Code` or any other AI-generated corporate stamps
- **GitHub operations:** ALL interactions with GitHub (push, PR create/edit/list, status) MUST go through `scripts/github.sh`. NEVER parse `.env` or use `GH_TOKEN=...` inline. Examples: `scripts/github.sh push`, `scripts/github.sh pr-create "title"`, `scripts/github.sh status`
- **CI:** lint → type-check → test → build (all four gates must pass)
- **Release:** release-please auto-generates CHANGELOG and GitHub Releases
- Branch naming: `feat/N-slug`, `fix/N-slug` (N = issue number)
- Never force push to main

## Key Architecture Decisions

- Push: GraphQL `createCommitOnBranch` (batch commit, auto GPG sign)
- Pull: REST Contents API + Git Trees API
- First sync: Trees API + batch Contents API (NOT ZIP for subfolder)
- Chunked push for >2MB payload (GraphQL limit)
- Files >1.5MB: fallback to REST Git Data API (blobs -> trees -> commits -> refs)
- Hardcoded excludes: `.obsidian/**`, `.trash/**`, `ghvault.log`
- Sync mutex to prevent concurrent operations

## Code Style

- No default exports (except `main.ts` Plugin class)
- Explicit return types on public methods
- Errors: typed error classes (`GitHubAuthError`, `GitHubRateLimitError`, etc.)
- No `any` — use `unknown` and type guards
- Prefer `interface` over `type` for object shapes

## Don'ts

- Never import `fs`, `path`, `child_process` — use Obsidian API only
- Never use `fetch` — use `requestUrl()` from Obsidian
- Never store secrets in code — tokens live in plugin settings (data.json)
- Never sync `.obsidian/`, `.trash/`, or `ghvault.log` to GitHub