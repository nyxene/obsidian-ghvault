# TreeComparator — diff local vault against remote tree

**Issue:** #14
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** feat/14-tree-comparator

## Objective
Pure functions to compare local vault files and remote GitHub tree against SHA cache, producing typed change lists.

## Scope
- `src/sync/comparator.ts`
- `src/sync/comparator.test.ts`

## Approach
Two pure functions (no class, no state):
- `computeLocalChanges(localFiles, cache)` — detect local creates/modifies/deletes vs cache
- `computeRemoteChanges(remoteTree, cache)` — detect remote creates/modifies/deletes vs cache
- Both filter out EXCLUDED_PATTERNS via `isExcluded()`
- Input types: `LocalFileInfo` (new), `GitHubTreeEntry` + `SHACacheEntry` (existing)

## Tasks
- [ ] `src/sync/comparator.ts` — computeLocalChanges, computeRemoteChanges
- [ ] `src/sync/comparator.test.ts` — all change scenarios + exclusion filtering
- [ ] All checks pass (lint, type-check, test, build)

## Out of Scope
- Conflict resolution (SyncEngine responsibility)
- File content fetching

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
