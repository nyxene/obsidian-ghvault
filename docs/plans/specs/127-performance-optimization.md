# 127 — Performance optimization for large vaults (>1000 files)

**Issue:** #127
**Date:** 2026-03-19
**Status:** APPROVED
**Branch:** feat/127-performance-optimization

## Objective

Optimize sync performance for vaults with 1000+ files. Fix critical bottlenecks in first sync reconciliation, push file reading, and rename detection.

## Changes

### 1. Parallelize first sync reconciliation

`reconcileFirstSync()` calls `getRemoteFileHash()` sequentially for each overlapping file. Wrap in `pMap` with concurrency 8.

Before: 500 files × 500ms = ~250s
After: 500 files / 8 × 500ms = ~31s

### 2. Parallelize push file reading

`push()` reads files in a sequential `for` loop (read + hash + base64). Replace with `pMap` to read files concurrently.

### 3. Hash map rename detection

`detectLocalRenames()` and `detectRemoteRenames()` use nested O(d×c) loops. Replace with hash map: `Map<hash, deletePath>` for O(1) lookup per create.

Before: O(deletes × creates)
After: O(deletes + creates)

### 4. Tree truncation handling

`getTree(recursive=true)` can return `truncated=true` for very large repos. Add warning via logger that files may be incomplete.

### 5. Push chunk progress logging

Log chunk count during multi-chunk push so user/developer sees progress.

## Scope

| File | Change |
|------|--------|
| `src/sync/comparator.ts` | pMap for reconciliation, hash map for renames |
| `src/sync/push.ts` | pMap for file reading |
| `src/sync/pull.ts` | Tree truncation warning |
| `src/github/graphql.ts` | Chunk progress logging |
| Tests | Unit + integration |

## Out of Scope

- REST fallback for files >1.5MB
- File hash caching
- Push chunk parallelization (headOid chaining constraint)

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
