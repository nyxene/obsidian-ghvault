# 097 — Improve vault-adapter and pull test coverage

**Issue:** #97
**Branch:** `test/97-vault-adapter-pull-coverage`
**Scope:** sync

---

## Goal

Close coverage gaps in `vault-adapter.ts` (67% line, 69% branch) and `pull.ts` (81% branch). These modules are the boundary with Obsidian API — regressions here break all sync operations.

---

## Current State

- `vault-adapter.ts`: `readFileBinary()` and binary `listFiles` path have 0% direct coverage
- `pull.ts`: delete error handling (lines 242-244), `skipPaths` filtering (line 135) partially covered
- `push.ts`: binary detection branch (lines 107-116) and state update null safety (lines 144-148) low coverage

---

## Plan

### 1. Extend: `src/sync/vault-adapter.test.ts`

- `readFileBinary` — reads existing file, throws on missing file
- `writeFileBinary` — modifies existing file, creates new file with parent dir
- `listFiles` with binary files — file with `.png` extension uses `readBinary` path, returns `isBinary: true`
- `listFiles` with mixed text + binary — text uses `cachedRead`, binary uses `readBinary`

### 2. Extend: `src/sync/pull.test.ts`

- Delete error handling — `vault.deleteFile` throws → error collected, other deletes proceed
- `skipPaths` filtering — changes in skipPaths set are excluded from pull

### 3. Extend: `src/sync/push.test.ts`

- Push binary file — file with null bytes → `arrayBufferToBase64` path used
- State update with isBinary flag — verify cache entry has `isBinary: true` for binary files

---

## Files to Modify

| Action | File |
|--------|------|
| Modify | `src/sync/vault-adapter.test.ts` |
| Modify | `src/sync/pull.test.ts` |
| Modify | `src/sync/push.test.ts` |

---

## Acceptance Criteria

- [ ] `vault-adapter.ts` line coverage ≥ 90%
- [ ] `pull.ts` branch coverage ≥ 90%
- [ ] No source code modifications
- [ ] All gates pass
