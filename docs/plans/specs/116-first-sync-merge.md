# 116 — First sync merge for non-empty vault and repo

**Issue:** #116
**Date:** 2026-03-15
**Status:** APPROVED
**Branch:** feat/116-first-sync-merge

## Objective

When both vault and repo are non-empty on first sync (empty cache + empty headOid), perform diff-based merge instead of treating all overlapping files as conflicts.

## Current behavior (problem)

1. Empty cache → `computeLocalChanges` marks all local files as `create`
2. Empty cache → `computeRemoteChanges` marks all remote files as `create`
3. `detectConflicts` finds intersection of `create` + `create` → conflict
4. Strategy=skip → overlapping files are skipped, never synced

## Expected behavior

- File only in remote → pull (create)
- File only in vault → push (create)
- File on both sides, **content identical** → populate cache, no pull/push
- File on both sides, **content differs** → real conflict, apply conflict strategy

## Approach

### First sync detection

`state.getHeadOid() === ""` AND `Object.keys(cache).length === 0`

### reconcileFirstSync()

New function in `comparator.ts`:

```typescript
interface FirstSyncReconciliation {
  localChanges: FileChange[];
  remoteChanges: FileChange[];
  cacheEntries: Record<string, SHACacheEntry>;
}

async function reconcileFirstSync(
  localChanges: FileChange[],
  remoteChanges: FileChange[],
  localFiles: LocalFileInfo[],
  getRemoteFileHash: (path: string) => Promise<{ contentHash: string; remoteSha: string; size: number; isBinary: boolean }>,
): Promise<FirstSyncReconciliation>;
```

For each path appearing in both localChanges and remoteChanges:
1. Get remote content hash via callback
2. Compare with local content hash from localFiles
3. If equal → remove from both change lists, add to cacheEntries
4. If different → leave as-is (will be detected as conflict)

### Engine changes

In `executeSyncCycle()`, after computing local/remote changes but before `detectConflicts`:

```typescript
const isFirstSync = this.state.getHeadOid() === "" && Object.keys(cache).length === 0;
if (isFirstSync && localChanges.length > 0 && remoteChanges.length > 0) {
  const reconciliation = await reconcileFirstSync(...);
  // Use filtered changes
  // Pre-populate cache with identical files
}
```

### PullEngine addition

Expose `getRemoteFileHash(branch, path)` that downloads file content, computes content hash, and returns hash + SHA + size + isBinary.

## Scope

| File | Change |
|------|--------|
| `src/sync/pull.ts` | Add `getRemoteFileHash()` method |
| `src/sync/comparator.ts` | Add `reconcileFirstSync()` function |
| `src/sync/engine.ts` | Detect first sync, call reconcile, pre-populate cache |
| `src/sync/comparator.test.ts` | reconcileFirstSync unit tests |
| `src/sync/engine.test.ts` | First sync detection + merge tests |
| `src/sync/integration.test.ts` | Both sides non-empty integration tests |
| `tests/e2e/specs/sync.spec.mts` | E2E: first sync merge scenario |
| `docs/qa/manual-test-cases.md` | QA cases |
| `README.md` | Update limitations / first sync section |

## Tasks

- [ ] `src/sync/pull.ts` — add `getRemoteFileHash(branch, path)` method
- [ ] `src/sync/comparator.ts` — add `reconcileFirstSync()` function
- [ ] `src/sync/engine.ts` — detect first sync, call reconcile, pre-populate cache
- [ ] Unit tests: comparator (reconcileFirstSync), engine (first sync detection + merge)
- [ ] Integration tests: both sides non-empty with identical + different files
- [ ] E2E test: first sync merge scenario
- [ ] QA cases
- [ ] README: update limitations / first sync section

## Risks

- **Performance**: downloading remote content for hash comparison adds API calls. Mitigation: only for first sync, only for overlapping paths.
- **Binary files**: content hash comparison must handle binary. Mitigation: use same hash functions as regular sync (computeHash / computeHashFromBuffer).

## Out of Scope

- 3-way content merge (line-level diffing)
- Partial first sync (resume interrupted first sync)
- First sync progress indicator

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
