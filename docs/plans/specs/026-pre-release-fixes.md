# Critical pre-release fixes

**Issue:** #26
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** fix/26-pre-release-fixes

## Fixes
1. **state.load() called in SyncEngine.sync()** — ensures state is loaded from disk before each sync
2. **Empty repo handling** — PullEngine catches GitHubEmptyRepoError, creates initial commit via REST, sets headOid
3. **Token masking** — password input type in settings tab

## Scope
- `src/types.ts` — GitHubEmptyRepoError
- `src/github/client.ts` — empty repo detection, createFile method
- `src/sync/pull.ts` — catch empty repo, auto-initialize
- `src/sync/engine.ts` — state.load() before sync
- `src/settings.ts` — token masking
- Tests updated

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
