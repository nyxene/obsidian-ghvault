# 114 — Conflict resolution modal — interactive "ask" strategy

**Issue:** #114
**Date:** 2026-03-15
**Status:** APPROVED
**Branch:** feat/114-conflict-modal-ui

## Objective

Add a 4th conflict resolution strategy `"ask"` that pauses sync, shows a modal listing conflicted files with per-file choices (keep local / keep remote), then continues sync with user decisions applied.

## Scope

| File | Change |
|------|--------|
| `src/types.ts` | `ConflictStrategy` += `"ask"`, add `ConflictResolution`, `ConflictDecision` |
| `src/ui/conflict-modal.ts` | **New** — `ConflictModal` extends Obsidian `Modal` |
| `src/sync/engine.ts` | `onConflict` callback in `SyncEngineOptions`; ask flow in `executeSyncCycle` |
| `src/main.ts` | Pass `onConflict` callback showing modal; ask notice wording |
| `src/settings.ts` | Dropdown: 4th option "Ask" |
| `src/ui/conflict-modal.test.ts` | Modal unit tests |
| `src/sync/engine.test.ts` | Ask strategy + callback tests |
| `src/main.test.ts` | Ask notice + integration tests |
| `src/sync/integration.test.ts` | Ask strategy full sync cycle with mock callback |
| E2E tests | Settings dropdown 4 options, modal appears, Resolve/Skip All work |
| `docs/qa/manual-test-cases.md` | TC-CONF-009..012 |
| `README.md` | Features, Settings table, Conflict handling section |

## Approach

### Callback architecture

```typescript
// types.ts
export type ConflictStrategy = "skip" | "local-wins" | "remote-wins" | "ask";
export type ConflictResolution = "local" | "remote";
export interface ConflictDecision {
  path: string;
  resolution: ConflictResolution;
}

// engine.ts — SyncEngineOptions
onConflict?: (conflicts: ConflictInfo[]) => Promise<ConflictDecision[]>;
```

### Engine flow (strategy=ask)

1. `executeSyncCycle()` detects conflicts
2. If strategy=ask and `onConflict` is set — calls `await this.onConflict(conflicts)`
3. Receives `ConflictDecision[]` — per-file "local" or "remote"
4. Applies decisions: `local` → include in push, skip in pull. `remote` → include in pull, skip in push
5. If callback not set or user closes modal without choosing — fallback to skip

### ConflictModal UI

- Title: "Resolve conflicts (N files)"
- Table: file path | local change | remote change | [Keep Local] [Keep Remote]
- Bottom buttons: "Resolve" (disabled until all files have a choice), "Skip All" (fallback to skip)
- Obsidian `Modal` API — `contentEl` for DOM, `close()` to dismiss
- Returns Promise that resolves on Resolve or Skip All

### Notice wording

- `"ask"` with resolved files: `"N resolved (per-file)"`
- `"ask"` with Skip All: same as `"N conflicts"` (skip behavior)

## Tasks

- [ ] `src/types.ts` — add `"ask"` to `ConflictStrategy`, add `ConflictResolution`, `ConflictDecision`
- [ ] `src/sync/engine.ts` — add `onConflict` callback in options, ask logic in `executeSyncCycle`
- [ ] `src/ui/conflict-modal.ts` — new file, `ConflictModal` with per-file choices
- [ ] `src/main.ts` — pass `onConflict` callback, handle ask in notice wording
- [ ] `src/settings.ts` — add "Ask" to dropdown
- [ ] Unit tests: engine (ask strategy + callback), main (notice + integration), modal
- [ ] Integration tests: `src/sync/integration.test.ts` — ask strategy full sync cycle with mock callback
- [ ] E2E tests (wdio-obsidian-service): settings dropdown 4 options, "Ask" selection saves, conflict modal appears on sync with conflicts, Resolve / Skip All buttons work
- [ ] QA cases: TC-CONF-009..012
- [ ] README.md — update Features (add ask strategy), Settings table (4 options), Conflict handling section (modal description)

## Risks

- **Modal blocking sync** — user may take long to decide. Mitigation: sync mutex already exists, other syncs won't start; modal doesn't block Obsidian UI thread.
- **Auto-sync + ask** — modal may be unexpected during auto-sync. Mitigation: document that ask is best suited for manual sync. Auto-fallback can be added later.

## Out of Scope

- 3-way merge / content diffing
- Per-file strategy override in settings
- Bulk "all local" / "all remote" presets (except Skip All)
- Auto-fallback during auto-sync (future enhancement)

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
