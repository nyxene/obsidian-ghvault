---
description: Run comprehensive QA analysis (coverage, test quality, performance, user scenarios, e2e)
argument-hint: "[module: sync | github | utils | ui | settings | main | types] or [--changed]"
---

Launch a dedicated QA agent to perform comprehensive testing analysis.

## Mode selection

**If `$ARGUMENTS` is `--changed`:**
- Run `git diff main --name-only -- src/` to determine changed files
- Scope analysis to ONLY those files and their corresponding test files
- **DO NOT create GitHub issues** — output all findings inline in the report
- Skip Direction 4 (User Scenarios) and Direction 5 (E2E) — focus on changed code only
- Replace Direction 6 with: **"Suggested Issues"** — list what WOULD be filed, but do not execute `scripts/github.sh`
- This mode is for quick PR review, not full audit

**Otherwise:**
- **Scope:** $ARGUMENTS (empty = full `src/`). Resolve module names to directories: `sync` → `src/sync/**`, `github` → `src/github/**`, `utils` → `src/utils/**`, `ui` → `src/ui/**`, `settings` → `src/settings.ts`, `main` → `src/main.ts`, `types` → `src/types.ts`.
- Perform all 6 directions including issue creation

---

The agent MUST perform the analysis directions in order. The agent is a READ-ONLY auditor for source code — it NEVER modifies `src/**/*.ts` files. It CAN create or update `*.bench.ts` benchmark files and CAN run test commands.

---

## Direction 1: Coverage Gaps

1. Read ALL source files in scope — every `.ts` file (excluding tests and benchmarks)
2. Read ALL corresponding `.test.ts` files
3. Run `npm run test:coverage` and analyze the output
4. For each source file, identify:
   - Untested functions or methods
   - Untested branches (if/else, switch, try/catch, early returns)
   - Untested error paths (throw, reject, error callbacks)
   - Missing edge cases (empty input, null, boundary values, max sizes)

## Direction 2: Test Quality

For each `.test.ts` file in scope, analyze:

1. **Mock realism** — do mocks accurately simulate real behavior? Are there mocks that hide bugs by being too permissive? Do mocks cover error responses from APIs?
2. **Boundary values** — are edge cases tested? Empty strings, zero, MAX_SAFE_INTEGER, empty arrays, single-element arrays, exact size limits (50MB boundary, 2MB chunk boundary)
3. **Negative cases** — are failure paths tested? Invalid input, network errors, malformed responses, corrupted state, permission errors
4. **Assert strength** — do assertions check the right things? Shallow equality where deep is needed? Missing assertions on side effects (state mutations, log calls)?
5. **Test isolation** — do tests leak state between each other? Shared mutable mocks? Missing cleanup?

## Direction 3: Performance

1. Read source files in scope and identify:
   - O(n²) or worse patterns in hot paths (sync loops, file iteration, tree traversal)
   - Unnecessary allocations in loops (object spread, array concat, string concat)
   - Missing early exits / short circuits
   - Large data structure copies where mutation would suffice
   - Blocking operations that could be parallelized

2. Check for existing `*.bench.ts` files in scope — **reuse and extend** them, do NOT recreate from scratch
3. For modules WITHOUT benchmarks, create new `*.bench.ts` files using vitest bench API:
   ```typescript
   import { bench, describe } from "vitest";
   describe("ModuleName", () => {
     bench("operation name", () => { /* ... */ });
   });
   ```
4. Run `npm run test:bench` and include results in the report

## Direction 4: User Scenarios

Model real-world user flows and check whether they are covered by tests:

| Scenario | What to check |
|----------|---------------|
| First sync (empty vault → populated repo) | Full flow: getRef → getTree → getFileContent → writeFile for each |
| First sync (populated vault → empty repo) | Init repo → push all local files |
| Regular sync (no changes) | Short-circuit, no API calls beyond getRef+getTree |
| Regular sync (remote changes only) | Pull downloads, cache updated, no push |
| Regular sync (local changes only) | Push uploads, OID updated, no pull changes |
| Regular sync (both changed, no conflict) | Pull then push, both succeed |
| Conflict (same file changed both sides) | How is this handled? Is it tested? |
| Large vault (1000+ files) | Performance, chunking, memory |
| Large file (>1.5MB, >50MB) | Size limits, fallback behavior |
| Network failure mid-sync | Partial state, recovery on next sync |
| Rate limit hit during sync | RateLimitError handling, retry behavior |
| Invalid/expired token | AuthError, user notification |
| Corrupted local state (tampered data.json) | Graceful recovery, validation |
| Concurrent sync attempts | Mutex, isSyncing check |
| Plugin load → settings empty | No crash, prompt to configure |
| Plugin load → settings valid | Auto-init sync engine |

For each scenario: is it tested? Partially? What's missing?

## Direction 5: E2E / Integration

Analyze integration-level coverage:

1. **Plugin lifecycle** — is `onload()` / `onunload()` tested with realistic Obsidian API mocks?
2. **Settings tab** — are all settings inputs tested (onChange callbacks, sanitization, persistence)?
3. **Status bar** — is status text updated correctly through sync lifecycle?
4. **Commands** — are registered commands tested?
5. **Ribbon icon** — is click handler tested?
6. **SyncEngine integration** — is the full pull→push cycle tested end-to-end with all components wired together (not just unit mocks)?
7. **Error propagation** — do errors from deep modules (GitHub API) bubble up correctly to user-facing Notice messages?

---

## Direction 6: Auto-file Issues (full mode) / Suggested Issues (--changed mode)

**If `--changed` mode:** Do NOT create issues. Instead, list all findings as "Suggested Issues" in the report with the title, label, and body that WOULD be filed. Format as a table in the report.

**If full mode:** After completing all 5 analysis directions, review your findings and auto-create GitHub issues for **confirmed bugs** and **technical debt**.

### Step 1: Check existing issues

```bash
scripts/github.sh issue-list
```

Do NOT create duplicates of already-open issues.

### Step 2: File bug issues

Read the bug template at `.claude/skills/qa/templates/bug.md` and follow it exactly.

For each finding where code **behaves incorrectly** (wrong result, data corruption, skipped validation, logic error), create a bug issue:

```bash
scripts/github.sh issue-create "<type>(<scope>): <description>" -l bug -b "<body>"
```

### Step 3: File debt issues

Read the debt template at `.claude/skills/qa/templates/debt.md` and follow it exactly.

**Group related findings** by module or theme into one issue (2-8 findings per issue). Do NOT create one issue per finding.

For each group of findings where code **works but is fragile/untested/slow**, create a debt issue:

```bash
scripts/github.sh issue-create "<type>(<scope>): <description>" -l debt -b "<body>"
```

### Rules

- Scopes for issue titles: `github`, `sync`, `ui`, `settings`, `utils`, `types`, `deps`, `infra` — ONLY these
- Types: `fix` for bugs, `test`/`perf`/`refactor` for debt
- All issue creation goes through `scripts/github.sh` — NEVER use `gh` directly
- If `scripts/github.sh` fails or is unavailable, list the issues you would create in the report instead

---

## Report Format

Produce the report in this exact structure:

```
## QA Report — [scope]

### 1. Coverage Gaps

| # | File | Untested path | Risk |
|---|------|---------------|------|

### 2. Test Quality Issues

| # | Test file | Issue | Severity |
|---|-----------|-------|----------|

### 3. Performance Concerns

| # | File:line | Pattern | Impact |
|---|-----------|---------|--------|

Benchmark results: (paste vitest bench output if benchmarks were run)

### 4. User Scenarios

| # | Scenario | Status | Missing |
|---|----------|--------|---------|
(Status: ✅ Covered | ⚠️ Partial | ❌ Not covered)

### 5. E2E / Integration

| # | Area | Status | Notes |
|---|------|--------|-------|

### 6. Filed Issues

| # | Issue | Label | Title |
|---|-------|-------|-------|
(List all issues created by this QA run. If none, write "No issues filed.")

### Recommendations

**Priority 1 — Blockers (must fix before release):**
1. ...

**Priority 2 — Should fix:**
1. ...

**Priority 3 — Nice to have:**
1. ...

### Stats
- Files analyzed: N
- Tests analyzed: N
- Coverage: N% statements, N% branches
- Benchmarks run: N
- Findings total: N (P1: N, P2: N, P3: N)
- Issues filed: N (bugs: N, debt: N)
```

## Important Notes

- Be thorough but practical — flag REAL gaps, not theoretical ones
- Consider the Obsidian plugin context: desktop + mobile, no Node.js APIs, `requestUrl()` for HTTP
- If a test exists but is weak, say so — "covered" ≠ "well-tested"
- For performance: focus on paths that scale with vault size (file count, tree size)
- DO NOT modify source files. Only create/update `*.bench.ts` files
- DO NOT suggest fixes in code — give general recommendations, the team decides how to fix