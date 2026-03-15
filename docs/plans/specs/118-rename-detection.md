# 118 — Rename detection for local and remote renames

**Issue:** #118
**Date:** 2026-03-15
**Status:** APPROVED
**Branch:** feat/118-rename-detection

## Objective

Detect file renames (delete + create with same content hash) in both local and remote changes. Use vault.rename() for remote renames to preserve Obsidian backlinks.

## How rename detection works

In a list of changes, find pairs: `{path: A, type: "delete"}` + `{path: B, type: "create"}` where content hash of A matches content hash of B.

**Local renames:**
- delete oldPath (in cache, not in vault) → `cache[oldPath].localContentHash`
- create newPath (in vault, not in cache) → `localFiles[newPath].contentHash`
- If hashes match → rename

**Remote renames:**
- delete oldPath (in cache, not in remote tree)
- create newPath (in remote tree, not in cache)
- `cache[oldPath].remoteSha === tree[newPath].sha` → rename

## Scope

| File | Change |
|------|--------|
| `src/types.ts` | `RenameInfo` interface |
| `src/sync/comparator.ts` | `detectLocalRenames()`, `detectRemoteRenames()` |
| `src/sync/engine.ts` | Wire rename detection, add renames to SyncResult |
| `src/sync/pull.ts` | `VaultAdapter.renameFile()`, use rename for detected remote renames |
| `src/main.ts` | Notice: "N renamed" |
| Tests | TDD — tests written first |

## Tasks (TDD order)

1. [ ] Tests first: `comparator.test.ts` — detectLocalRenames() and detectRemoteRenames()
2. [ ] Implement: `comparator.ts` — detectLocalRenames(), detectRemoteRenames()
3. [ ] Tests first: `engine.test.ts` — rename flow through sync cycle
4. [ ] Implement: `types.ts` — RenameInfo; `engine.ts` — wire rename detection
5. [ ] Tests first: `pull.test.ts` — rename in pull instead of delete+create
6. [ ] Implement: `pull.ts` — VaultAdapter.renameFile(), rename logic
7. [ ] Tests first: `main.test.ts` — notice with rename count
8. [ ] Implement: `main.ts` — notice wording
9. [ ] Integration tests + E2E tests
10. [ ] QA cases + README

## Risks

- **False positive renames**: two different files with identical content. Mitigation: unlikely, and result is the same (content identical).
- **Multiple renames**: one delete + multiple creates with same hash. Mitigation: first match wins.
- **Rename + modify**: renamed AND changed content. Not detectable as rename. Out of scope.

## Out of Scope

- Rename + content modify (simultaneous)
- Directory renames
- Rename history tracking

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
