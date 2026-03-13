# 098 — Add missing user scenario tests for edge cases

**Issue:** #98
**Branch:** `test/98-user-scenario-edge-cases`
**Scope:** sync

---

## Goal

Add tests for production failure modes: rate limit mid-sync, auth token expiry, corrupted state, plugin unload during sync, GraphQL conflict error. These are high-risk scenarios currently untested.

---

## Current State

- Rate limit pre-check tested, but no test for rate limit error thrown during multi-file download
- Auth error propagation tested in client, but not token expiry between pull and push phases
- Basic state validation tested, but not partially corrupted cache
- Plugin onunload tested, but not during active sync
- GraphQL 409 conflict error untested

---

## Plan

### 1. Extend: `src/sync/pull.test.ts`

- Rate limit error mid-download — one file succeeds, second hits rate limit → error collected, first file still written

### 2. Extend: `src/sync/integration.test.ts`

- Auth error between pull and push — pull succeeds, push throws GitHubAuthError → state from pull preserved
- GraphQL conflict error (stale HEAD OID) — push returns conflict → proper error propagation

### 3. Extend: `src/sync/state.test.ts`

- Load with partially corrupted cache — mix of valid entries and entries with missing fields → valid entries preserved, invalid discarded

### 4. Extend: `src/main.test.ts`

- `onunload()` during active sync — syncEngine nullified, pending sync completes without crash

---

## Files to Modify

| Action | File |
|--------|------|
| Modify | `src/sync/pull.test.ts` |
| Modify | `src/sync/integration.test.ts` |
| Modify | `src/sync/state.test.ts` |
| Modify | `src/main.test.ts` |

---

## Acceptance Criteria

- [ ] All new scenario tests pass
- [ ] No source code modifications
- [ ] All gates pass
