# 182 — Compare Commits API for Incremental Pull

**Issue:** #182
**Date:** 2026-03-22
**Status:** APPROVED
**Branch:** `feat/182-compare-commits-incremental-pull`

---

## Objective

Use the GitHub Compare Commits API (`GET /repos/{owner}/{repo}/compare/{base}...{head}`) to detect remote changes incrementally instead of fetching the full recursive tree on every sync. When the local head SHA is known (not first sync), only the delta between the last synced commit and current remote HEAD is needed — reducing API calls and payload size dramatically for repos with many files.

---

## Background

### Current behavior

Every sync cycle calls `PullEngine.getRemoteChanges()`:

1. `getRef(branch)` → 1 API call
2. `getCommit(ref.sha)` → 1 API call
3. `getTree(treeSha, recursive=true)` → 1 API call, returns **all** files
4. `computeRemoteChanges(allEntries, cache)` → in-memory diff

For a repo with 1000 files where 2 changed: we fetch all 1000 tree entries just to find the 2.

### Compare Commits API

`GET /repos/{owner}/{repo}/compare/{base}...{head}` returns:

```json
{
  "status": "ahead",
  "ahead_by": 3,
  "files": [
    { "filename": "notes/meeting.md", "status": "modified", "sha": "abc123" },
    { "filename": "notes/new.md", "status": "added", "sha": "def456" },
    { "filename": "old.md", "status": "removed" }
  ]
}
```

- 1 API call instead of 2 (getCommit + getTree)
- Response contains only changed files, not the full tree
- `status` field maps directly to our `ChangeType`: `added` → `create`, `modified` → `modify`, `removed` → `delete`, `renamed` → rename detection
- Rate limit: 1 REST call (same cost as getRef)

### When to use Compare vs full tree

| Condition | Strategy | Reason |
|-----------|----------|--------|
| `lastRemoteHeadSha` exists AND differs from remote | **Compare** | Incremental delta |
| `lastRemoteHeadSha` is empty (first sync) | **Full tree** | No base commit to compare from |
| `lastRemoteHeadSha` exists AND equals remote | **Skip** | Nothing changed |
| Compare returns `status: "diverged"` | **Full tree fallback** | Force push or rebase happened |
| Compare `files` exceeds 300 (API limit) | **Full tree fallback** | API truncates at 300 files |

---

## Scope

| File | Changes |
|------|---------|
| `src/github/client.ts` | Add `compareCommits(base, head)` method |
| `src/github/client.test.ts` | Tests for compareCommits |
| `src/sync/pull.ts` | Add `getRemoteChangesIncremental()` using Compare API; modify `getRemoteChanges()` to choose strategy |
| `src/sync/pull.test.ts` | Tests for incremental path, fallback logic |

---

## Approach

### New method: `GitHubClient.compareCommits()`

```typescript
interface CompareResult {
  status: "ahead" | "behind" | "diverged" | "identical";
  aheadBy: number;
  files: Array<{
    filename: string;
    status: "added" | "modified" | "removed" | "renamed";
    sha: string;
    previousFilename?: string;
  }>;
  headSha: string;
}

async compareCommits(base: string, head: string): Promise<CompareResult>
```

### Modified `PullEngine.getRemoteChanges()`

```
getRemoteChanges(branch):
  ref = getRef(branch)

  if ref.sha === state.headOid:
    return []  (nothing changed — ETag will make this free)

  localHead = state.headOid

  if !localHead:
    return fullTreeStrategy(branch)  (first sync)

  compare = client.compareCommits(localHead, ref.sha)

  if compare.status === "diverged" OR compare.files.length >= 300:
    logger.warn("Compare fallback to full tree")
    return fullTreeStrategy(branch)

  return mapCompareToChanges(compare)
```

### `mapCompareToChanges()`

Maps Compare API file entries to `FileChange[]`:

- `added` → `{ path, type: "create" }`
- `modified` → `{ path, type: "modify" }`
- `removed` → `{ path, type: "delete" }`
- `renamed` → `{ path: newPath, type: "create" }` + `{ path: oldPath, type: "delete" }` (handled by existing rename detection)

Path mapping: `filename` is repo path → needs `toVaultPath()` conversion. Files outside `syncFolder` are filtered. Excluded patterns applied.

### Full tree still needed for `pull()`

`getRemoteChanges()` returns the delta, but `pull()` also needs the tree for:
- Building `repoPathMap` (vault path → repo path for API calls)
- Building `treeSizeMap` and `treeShaMap` for downloads
- ZIP download strategy decision

**For incremental changes:** we skip the full tree. Instead, we use `getFileContent()` per file — which we already do in `pullPerFile()`. The Compare API provides SHA and filename, which is enough.

**Key insight:** when using Compare path, `pull()` doesn't need the full tree at all. The compare result has everything needed: filename, sha, status. We only need `getFileContent()` for actual downloads.

### Adjustments to `pull()`

When incremental path is used:
- Skip `fetchRefAndTree()` — we already have the ref SHA from `getRemoteChanges()`
- Skip `computeRemoteChanges()` — changes already computed from Compare
- Build `treeShaMap` from Compare result files
- Use `pullPerFile()` only (no ZIP for incremental — typically few files)
- Still process deletes, renames, safe path checks as before

### Storing state for `pull()` reuse

Currently `getRemoteChanges()` stores `lastRefSha`, `lastRawTree`, `lastMappedTree` for `pull()` to reuse. With incremental path, we store:
- `lastRefSha` — same as before
- `lastCompareFiles` — the compare result files (for pull to use)
- `lastIncrementalMode: boolean` — flag to tell `pull()` which strategy was used

---

## Tasks

- [ ] Add `compareCommits(base, head)` to `GitHubClient`
- [ ] Add `CompareResult` interface to types or client
- [ ] Unit tests: `compareCommits` — response parsing, error handling
- [ ] Modify `getRemoteChanges()` — choose Compare vs full tree based on state
- [ ] Add `mapCompareToChanges()` — convert Compare files to FileChange[]
- [ ] Modify `pull()` — handle incremental mode (skip full tree, use compare data)
- [ ] Unit tests: incremental path — compare used when headOid exists
- [ ] Unit tests: full tree fallback — first sync (no headOid)
- [ ] Unit tests: full tree fallback — diverged status
- [ ] Unit tests: full tree fallback — 300+ files in compare
- [ ] Unit tests: path mapping with syncFolder in incremental mode
- [ ] Unit tests: excluded patterns applied to compare results

---

## Edge Cases

- First sync (no headOid) → full tree strategy, no compare
- Force push / rebase → `status: "diverged"` → fallback to full tree
- More than 300 changed files → API truncates → fallback to full tree
- `base` commit no longer exists (GC'd) → 404 → fallback to full tree
- Compare returns `status: "identical"` → return empty changes
- Compare returns `status: "behind"` → local is ahead of remote (shouldn't happen in normal flow, treat as no remote changes)
- Renamed file with `previousFilename` → existing rename detection handles it
- Files outside syncFolder in compare result → filtered by `toVaultPath()`

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Compare API 300 file limit | Detect and fallback to full tree |
| Force push invalidates base SHA | `status: "diverged"` or 404 → fallback |
| Compare API not available (GitHub Enterprise) | Unlikely for github.com; full tree as universal fallback |

---

## Performance Impact

| Scenario | Before | After |
|----------|--------|-------|
| 1000 files, 2 changed | getRef + getCommit + getTree(1000 entries) = 3 calls | getRef + compare = 2 calls, tiny payload |
| 1000 files, 0 changed | getRef + getCommit + getTree = 3 calls | getRef (ETag 304) = 0 cost |
| First sync | getRef + getCommit + getTree = 3 calls | Same (no optimization possible) |
| 300+ files changed | 3 calls | getRef + compare + fallback getCommit + getTree = 4 calls (rare, acceptable) |

---

## Out of Scope

- Pagination for Compare API (300 file limit → fallback instead)
- Using Compare API for push operations
- Caching Compare results across sync cycles

---

*Mobilis in Mobili*
