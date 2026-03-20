# Contributing to GHVault

Thank you for your interest in contributing to GHVault! This document explains how to get started.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/obsidian-ghvault.git`
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feat/your-feature`

## Development

```bash
npm run dev          # Watch mode (rebuild on changes)
npm run build        # Production build
npm run lint         # Biome lint + format check
npm run type-check   # TypeScript strict mode
npm run test         # Unit tests (vitest)
npm run test:e2e     # E2E tests (requires Obsidian via wdio-obsidian-service)
```

## Code Style

- **TypeScript strict mode** — no `any`, explicit return types on public methods
- **Biome** for linting and formatting — runs automatically via pre-commit hook
- **No default exports** (except `main.ts` Plugin class)
- **No Node.js APIs** — use Obsidian API only (`requestUrl`, `vault.*`, etc.)
- Prefer `interface` over `type` for object shapes
- Use `unknown` instead of `any`, with type guards

## Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint:

```
type(scope): description
```

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Scopes:** `github`, `sync`, `ui`, `settings`, `utils`, `types`, `deps`, `infra`

**Examples:**
```
feat(sync): add rename detection for local changes
fix(settings): validate exclude patterns on input
test(github): add coverage for rate limit handling
```

## Development Workflow

For human contributors:

1. Open or pick a GitHub Issue
2. Create a feature branch (`feat/N-slug`, `fix/N-slug`)
3. Implement, write tests
4. Ensure CI gates pass
5. Open a PR referencing the issue

No specs or plan documents required for human contributions — just clear code and tests.

> **Note:** This project uses an extended AI-assisted workflow documented in [LOGBOOK.md](LOGBOOK.md), which includes plan/spec creation steps. These are required only for AI-assisted development, not for human contributors.

## Pull Requests

1. Ensure all CI gates pass: `npm run lint && npm run type-check && npm run test && npm run build`
2. Write tests for new functionality
3. Update README.md if adding user-facing features
4. Keep PRs focused — one feature or fix per PR
5. Reference the issue number: `Closes #N`

## Branching

- `feat/N-slug` for features
- `fix/N-slug` for bug fixes
- `test/N-slug` for test-only changes
- `docs/N-slug` for documentation
- `perf/N-slug` for performance improvements

Never push directly to `main` — always use pull requests.

## Testing

- **Unit tests** in `src/**/*.test.ts` using vitest
- **E2E tests** in `tests/e2e/specs/*.spec.mts` using wdio-obsidian-service
- **Benchmarks** in `src/**/*.bench.ts` using vitest bench
- Run `npm run test:coverage` to check coverage

## Architecture

```
src/
  main.ts              # Plugin entry point
  settings.ts          # Settings tab
  types.ts             # All interfaces and types
  github/              # REST + GraphQL API clients
  sync/                # Sync engine, pull, push, comparator
  ui/                  # Modal UI (conflict resolution, file history)
  utils/               # Base64, hash, path, logger, ZIP, concurrency
```

## Claude Code Skills

This project includes custom [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) — slash commands that automate complex workflows when developing with AI. Run them from the Claude Code CLI.

| Skill | Command | When to use |
|-------|---------|-------------|
| **QA** | `/qa` or `/qa sync` | After implementing a feature or before release. Runs 6-direction analysis: coverage gaps, test quality, performance, user scenarios, E2E, and auto-files issues. Scope to a module (`sync`, `github`, `ui`, etc.) or run on full `src/`. |
| **OWASP Audit** | `/owasp-audit` | Before release or after security-sensitive changes (auth, tokens, file I/O). Full OWASP Top 10 analysis with findings, severity ratings, and remediation guidance. Read-only — does not modify code. |
| **Release QA** | `/release-qa patch` | Before merging a release PR. Runs automated CI gates and produces a manual test checklist based on release type (`patch` = P0 smoke, `minor` = P0+P1, `major` = full catalog). |

**These skills are for AI-assisted development only** — they launch background agents that read the codebase and produce reports. Human contributors do not need to run them, but maintainers may run them during code review.

## AI-Assisted Contributions

This project was built with AI assistance ([Claude Code](https://claude.ai/claude-code)). We welcome AI-assisted contributions from others. See our full policy: **[AI_POLICY.md](AI_POLICY.md)**.

Key points:
- You are fully responsible for all code you submit
- Disclose substantial AI usage in PR description
- "AI generated it and it works" is not an acceptable answer during code review

## Security

If you discover a security vulnerability, please see [SECURITY.md](SECURITY.md) for our disclosure policy. Do not open a public issue for security vulnerabilities.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
