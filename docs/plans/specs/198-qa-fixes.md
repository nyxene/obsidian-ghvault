# 198–203 — QA audit fixes (coverage, test quality, performance)

**Issues:** #198, #199, #200, #201, #202, #203
**Branch:** `fix/198-qa-fixes`
**Scope:** ui, sync, github, main

---

## Goal

Fix all findings from QA audit: 1 bug (#198), 5 debt items (#199–#203). One branch, 5 parallel workstreams, single PR.

---

## Workstreams

### WS1: Fix computeDiff performance (#198 + #203)

**Source changes** — only workstream that modifies `src/`:

1. **`src/ui/diff.ts`** — add `DIFF_MAX_LINES = 2000` constant. In `computeDiff()`, if `n * m > 4_000_000` (≈2000×2000), return a simple line-by-line diff instead of LCS:
   - Mark all local lines as `remove`, all remote lines as `add`
   - This is the fallback "show both versions" approach — no LCS, O(n+m)
   - The constant lives in diff.ts, NOT in conflict-modal.ts (the guard is at the algorithm level)

2. **`src/ui/diff.test.ts`** — add tests:
   - `computeDiff` with >2000 lines each side → returns fallback (all remove + all add)
   - `computeDiff` with exactly 2000 lines → still uses LCS (boundary)
   - `computeDiff` fallback preserves line numbers

3. **`src/ui/diff.bench.ts`** — already created by QA, verify it runs

No changes to `conflict-modal.ts` — the existing `DIFF_MAX_SIZE` (100KB byte check) stays; the new guard is inside `computeDiff` itself.

No changes to `logger.ts` — the writeCount race (#203 finding 2-3) is theoretical with negligible impact. Not worth the complexity.

### WS2: Sync module test gaps (#199)

**Test-only changes** to `src/sync/pull.test.ts`, `src/sync/push.test.ts`:

1. **pull.test.ts** — add test: `pullViaZip` SHA integrity check failure → file skipped with warning log
   - Mock `computeGitBlobSha` to return wrong SHA for one file
   - Verify that file is excluded from result and warning logged

2. **push.test.ts** — add tests:
   - sizeHint pre-check: when `sizeHint` exceeds chunk limit → splits into multiple chunks
   - REST fallback `updateRef` failure → throws with descriptive error
   - REST fallback `createBlob` failure mid-batch → throws, no partial state

### WS3: GitHub client test gaps (#200)

**Test-only changes** to `src/github/client.test.ts`, `src/github/graphql.test.ts`:

1. **client.test.ts** — add tests:
   - `createBlob()` — correct URL, body, returns SHA
   - `createTreeFromEntries()` — correct URL, body format, returns SHA
   - `createCommitRest()` — correct URL, body with parents/tree/message
   - `updateRef()` — correct URL, PATCH body, force flag
   - 409 error with path containing `/git/ref/` → `GitHubEmptyRepoError`
   - ETag cache: 200 response after 304 → updates cached ETag value

2. **graphql.test.ts** — add test:
   - Error message >200 chars → truncated in thrown error

### WS4: Main.ts and UI modal test quality (#201)

**Test-only changes** to `src/main.test.ts`, `src/ui/backup-modal.test.ts`:

1. **main.test.ts** — add tests:
   - `restoreFromBackup()` — mock `downloadReleaseAsset` + `processZipEntries`, verify vault files written
   - `pullCheckTick()` — verify adaptive backoff: interval doubles after no-change, resets after change
   - `isSyncExcludedByFrontmatter()` — returns true when metadata has `ghvault-sync: false`
   - `generatePagesWorkflow()` — verify dispatch triggered and URL cached after workflow creation
   - `refreshSyncStatusPanel()` — verify panel data built correctly from sync state

2. **backup-modal.test.ts** — add test:
   - Restore confirmation cancel → no restore action taken

### WS5: User scenario integration tests (#202)

**Test-only changes** to `src/sync/integration.test.ts`:

1. Network failure mid-pull — mock `getFileContent` to fail after N files → verify partial state, next sync recovers
2. Rate limit mid-sync — mock `assertCanMakeRequest` to throw after N calls → verify clean abort, no corruption
3. Compare API 300-file boundary — mock compare response with exactly 300 files → verify fallback to full tree
4. Corrupted state recovery — load state with invalid entries mixed with valid → verify graceful degradation

---

## Scope matrix

| File | WS | Change type |
|------|----|-------------|
| `src/ui/diff.ts` | WS1 | Source: add line-count guard |
| `src/ui/diff.test.ts` | WS1 | Test: fallback behavior |
| `src/ui/diff.bench.ts` | WS1 | Bench: verify existing |
| `src/sync/pull.test.ts` | WS2 | Test: SHA integrity failure |
| `src/sync/push.test.ts` | WS2 | Test: sizeHint, REST errors |
| `src/github/client.test.ts` | WS3 | Test: REST Git Data, ETag, 409 |
| `src/github/graphql.test.ts` | WS3 | Test: long error truncation |
| `src/main.test.ts` | WS4 | Test: restore, backoff, frontmatter |
| `src/ui/backup-modal.test.ts` | WS4 | Test: cancel restore |
| `src/sync/integration.test.ts` | WS5 | Test: failure scenarios |

---

## Out of scope

- Logger writeCount race (#203 findings 2-3) — theoretical, negligible impact
- Rewriting LCS to Myers algorithm — fallback is sufficient for v0.1.0
- Modifying `conflict-modal.ts` — existing DIFF_MAX_SIZE byte guard stays

---

## Execution

5 workstreams run in parallel via agent teams. One orchestrator agent manages all. Each workstream runs in a worktree to avoid conflicts. After all complete, merge results into single branch `fix/198-qa-fixes`.

## Verification

After all workstreams complete:
1. `npm run check` (biome lint + format)
2. `npm run typecheck`
3. `npm run test` (all tests pass)
4. `npm run build` (bundle succeeds)