# Test Connection Button and First Sync Verification

**Issue:** #30
**Date:** 2026-03-09
**Status:** APPROVED
**Branch:** feat/30-test-connection-first-sync

## Objective
Finalize v0.1 MVP: add "Test connection" button in settings and verify first sync (empty vault → non-empty repo).

## Scope
| File | Changes |
|------|---------|
| `src/settings.ts` | Add "Test connection" button with callback |
| `src/main.ts` | Pass `onTestConnection` callback, create GitHubClient, call `getRepoInfo()` |
| `src/sync/engine.ts` | Verify first sync already works (empty cache + non-empty repo) |

## Approach

### Test connection
- Button in settings after branch field
- On click: create temporary GitHubClient, call `getRepoInfo()`
- Success → Notice `"Connected: owner/repo (private|public)"`
- Error → Notice with typed message (auth error, not found, rate limit)
- Button disabled while token/owner/repo are empty

### First sync
- Already works: PullEngine.pull() fetches tree, comparator sees all files as `create` (cache empty) → downloads everything
- Verify E2E with non-empty repo

## Tasks
- [ ] Add `onTestConnection` callback to `GHVaultSettingTab`
- [ ] "Test connection" button in settings UI
- [ ] Implement test connection via `getRepoInfo()` in `main.ts`
- [ ] E2E: test connection with valid/invalid token
- [ ] E2E: first sync — empty vault + non-empty repo → all files downloaded

## Risks
None — both changes are isolated.

## Out of Scope
- Auto-sync, conflict resolution, binary files

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
