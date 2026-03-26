# LOGBOOK — Development Workflow

> **What is this?** This is GHVault's development workflow protocol — the complete lifecycle from issue to merge. If you're contributing, start with [CONTRIBUTING.md](CONTRIBUTING.md) for a quick overview, then refer here for the full process.

> *The Nautilus keeps a logbook. Every course change is recorded, every depth noted.*
> *In our case — the protocol through which code enters the repository.*

---

## Unified Flow

Every unit of work follows this chain. No exceptions, no shortcuts. The issue number `#N` is the universal anchor — it appears in every artifact.

```
logbook: issue → plan → spec → branch → implement → checks → qa/review → report → "вливай" → PR → merge
```

### Traceability Chain

Every artifact references the issue number:

| Artifact | Naming | Example |
|----------|--------|---------|
| Issue | `#N` (auto) | `#15` |
| Spec | `docs/plans/specs/NNN-<slug>.md` | `015-sha-cache-validation.md` |
| Branch | `feat/N-<slug>` or `fix/N-<slug>` | `feat/15-sha-cache-validation` |
| PR body | `Closes #N` + `Spec: NNN-<slug>.md` | `Closes #15` |

One issue = one spec = one branch = one PR. No multi-issue PRs.

---

## Step 0: Issue

Every unit of work begins with a GitHub Issue.

```bash
scripts/github.sh issue-create "title" -l feat -b "description"
```

### Labels

| Label | Purpose |
|-------|---------|
| `feat` | New feature or capability |
| `bug` | Something is broken |
| `infra` | Infrastructure, CI/CD, tooling, scripts |
| `debt` | Technical debt, refactoring, cleanup |

### Who Creates Issues

| Actor | Scope |
|-------|-------|
| **Aronnax** | Strategic issues — features, priorities, direction |
| **Nemo** | Technical issues — debt, infra improvements, bugs found during work (requires Aronnax's approval) |

### All Issue Operations

All operations go through `scripts/github.sh`. Never use `gh` directly.

```bash
scripts/github.sh label-list
scripts/github.sh issue-create "title" -l feat -b "description"
scripts/github.sh issue-list
scripts/github.sh issue-view 7
scripts/github.sh issue-close 7
```

---

## Step 1: Plan

No code enters the repository without an approved plan. This is the first gate — before branches, before commits, before a single line is written.

### 1.1 Plan Creation

Before any implementation task, a plan MUST be created. The plan includes:

| Section | Required | Description |
|---------|----------|-------------|
| Objective | yes | What is being built and why |
| Scope | yes | Which files/modules are affected |
| Approach | yes | Technical approach and key decisions |
| Tasks | yes | Step-by-step breakdown of work |
| Dependencies | if any | External libs, APIs, data sources |
| Risks | if any | Known risks and mitigation |
| Out of scope | recommended | What this plan explicitly does NOT cover |

### 1.2 Review & Approval

The plan is presented to the Aronnax for review. Three outcomes:

| Decision | Effect |
|----------|--------|
| **APPROVED** | Plan is documented as spec, work begins |
| **REVISE** | The Aronnax provides feedback, plan is updated and re-submitted |
| **REJECTED** | Plan is discarded. No code is written. Back to the drawing board |

No implementation begins until the Aronnax gives explicit approval. No course is set without the navigator's word.

---

## Step 2: Spec

Every approved plan is saved as a spec document BEFORE any implementation begins.

### Naming Convention

```
docs/plans/specs/<NNN>-<slug>.md
```

- `NNN` — zero-padded issue number (001, 015, 142)
- `<slug>` — kebab-case, same as in the branch name

### Spec Template

```markdown
# <Plan Title>

**Issue:** #N
**Date:** YYYY-MM-DD
**Status:** APPROVED
**Branch:** feat/N-<slug>

## Objective
<what and why>

## Scope
<affected files and modules>

## Approach
<technical decisions>

## Tasks
- [ ] Task 1
- [ ] Task 2
- [ ] ...

## Risks
<if any>

## Out of Scope
<if any>

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
```

---

## Step 3: Branch

After the spec is committed, a dedicated branch is created. Branch name MUST include the issue number:

```
git checkout -b feat/<N>-<short-name>
git checkout -b fix/<N>-<short-name>
```

Examples:
```
feat/7-github-client
fix/12-sha-cache-corruption
feat/15-sha-cache-validation
```

All work happens on this branch. Direct commits to `main` are forbidden for implementation work.

---

## Step 4: Implement

Nemo implements the plan on the feature branch. All tasks from the spec are completed.

---

## Step 5: Local Checks

Before reporting, Nemo runs ALL available checks locally:

```
npm run lint
npm run type-check
npm run test
npm run build
```

All four must pass. If any fail — fix first, then report.

---

## Step 6: QA & Review Gate

After local checks pass but BEFORE reporting to the Aronnax, Nemo runs two automated audits and fixes all findings:

### 6.1 QA Audit

```
/qa --changed
```

Analyzes changed files for: coverage gaps, test quality, performance concerns. Nemo MUST fix all P1 (blocker) and P2 (should fix) findings before proceeding. P3 findings are optional.

### 6.2 Code Review

```
/review
```

Reviews the diff for: logic errors, security issues, code style, missing edge cases. Nemo MUST address all findings before proceeding.

### Iterate Until Clean

If fixes introduce new code, re-run local checks (Step 5) and repeat QA/Review until both pass clean. Only then proceed to Step 7.

---

## Step 7: Report

Code is written but NOT committed until the Aronnax has inspected. All hands report before anchoring.

Nemo presents a summary:

| Section | Description |
|---------|-------------|
| **What was done** | List of completed tasks from the plan |
| **Files changed** | Every new or modified file with a brief note |
| **Attention points** | Anything unusual, risky, or worth extra scrutiny |
| **Check results** | Status of lint, type-check, test, build |
| **What was NOT done** | Deviations from the plan, if any |

No commits are created at this point. The code sits unstaged.

---

## Step 8: The Aronnax Reviews

The Aronnax inspects all changed files manually. The Aronnax may:
- Request changes → Nemo fixes, re-runs checks, reports again
- Approve → proceed to Step 9

---

## Step 9: "вливай"

Only after explicit approval from the Aronnax, Nemo:

1. Stages and commits all changes (conventional commit + Nemo signature)
2. Pushes the feature branch via `scripts/github.sh push`
3. Creates a Pull Request via `scripts/github.sh pr-create "<title>" --body "Closes #N ..."`
4. Waits for CI pipeline to complete
5. Reports CI status to the Aronnax (via `scripts/github.sh pr-checks <number>`)

**"вливай" means:** commit to feature branch → push → PR. It does NOT mean commit to `main`.

**IMPORTANT:** All GitHub operations go through `scripts/github.sh`. Never use `gh` directly or parse `.env` inline.

---

## Step 10: The Aronnax Merges

The Aronnax merges the PR manually. Nemo does NOT merge PRs.

After merge, Nemo proposes what to work on next based on:
- Remaining tasks from the current plan
- The roadmap priorities
- Any issues discovered during implementation

---

## Lifecycle Summary

| Step | Artifact | Who |
|------|----------|-----|
| 0. Issue | GitHub Issue `#N` | the Aronnax or Nemo |
| 1. Plan | conversation | Nemo proposes, the Aronnax reviews |
| 2. Spec | `docs/plans/specs/NNN-<slug>.md` | Nemo documents |
| 3. Branch | `feat/N-<slug>` | Nemo creates |
| 4. Implement | code on feature branch | Nemo |
| 5. Checks | lint, type-check, test, build | Nemo |
| 6. QA & Review | `/qa --changed` + `/review`, fix all findings | Nemo |
| 7. Report | summary in conversation | Nemo |
| 8. Review | file inspection | the Aronnax |
| 9. "вливай" | commit + push + PR | Nemo |
| 10. Merge | PR merge | the Aronnax |

---

## Commit Protocol

Every commit MUST pass through LOGBOOK before reaching the repository.

### Pre-commit (automatic via Husky)

```
logbook: lint-staged → biome check --write
```

All staged files are checked and formatted by Biome. Failing code is rejected.

### Commit message (automatic via commitlint)

```
logbook: commitlint → conventional commits
```

Format: `type(scope): description`

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

**Scopes:** `github`, `sync`, `ui`, `settings`, `utils`, `types`, `deps`, `infra`

**Examples:**
```
feat(github): add REST client with rate limit tracking
fix(sync): handle undefined SHA in cache lookup
docs(infra): update LOGBOOK protocol
refactor(utils): extract path mapping helpers
```

### Signature

Every commit ends with:

```
Co-Authored-By: Nemo <nemo@20000leagues.noreply>
```

The Nautilus leaves no unsigned entry in the logbook.

### CI Pipeline (automatic via GitHub Actions)

```
logbook: lint → type-check → test → build
```

All four gates must pass. A single failure blocks the merge.

| Gate | Tool | What it checks |
|------|------|----------------|
| lint | Biome | Formatting, linting rules, import order |
| type-check | tsc --noEmit | TypeScript strict mode, no unused vars |
| test | vitest | Unit tests pass |
| build | esbuild | Plugin compiles to main.js |

### E2E Pipeline (manual via GitHub Actions)

```
logbook: build → e2e (wdio-obsidian-service)
```

E2E tests run against a real Obsidian instance. Triggered manually before releases:
GitHub → Actions → "E2E Tests" → Run workflow (select branch + runner).

Linux uses `xvfb-run` for virtual display. macOS runs directly.

### Pull Request

PRs to `main` require:
- All CI gates green
- Conventional commit history
- Nemo signature on every commit

PR body format:
```
Closes #N
Spec: NNN-<slug>.md

## Summary
<what changed and why>

## Test plan
- [ ] Lint passes
- [ ] Type-check passes
- [ ] Tests pass
- [ ] Build succeeds
- [ ] No secrets in code (.env, API keys)
- [ ] No console.log in production code

*Mobilis in Mobili*
```

**FORBIDDEN:** Never use default AI-generated footers such as `🤖 Generated with [Claude Code]` or similar corporate stamps. The only permitted footer is `*Mobilis in Mobili*`.

---

## What LOGBOOK rejects

| Violation | Gate | Rule |
|-----------|------|------|
| `any` type | lint | `noExplicitAny: error` |
| `console.log` in production | lint | `noConsole: error` |
| Unused variables | lint | `noUnusedVariables: error` |
| Non-conventional commit | commit-msg | commitlint |
| Type errors | type-check | `strict: true` |
| Failed tests | test | vitest |
| Secrets in code | review | manual check |
| Default exports | lint | named exports only |
| Unsigned logbook entry | review | every commit |

---

## Release Protocol (release-please)

When commits reach `main`, release-please reads them and:

1. Groups `feat:` → minor version bump
2. Groups `fix:` → patch version bump
3. Auto-generates `CHANGELOG.md`
4. Creates a Release PR
5. On merge → GitHub Release with tag `vX.Y.Z`

---

*Mobilis in Mobili*
*Course: STEADY*
*Helm: AUTOMATIC*
