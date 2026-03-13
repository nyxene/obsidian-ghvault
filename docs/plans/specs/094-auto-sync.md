# 094 — Auto-sync on vault events

**Issue:** #94
**Branch:** `feat/94-auto-sync`
**Scope:** sync, settings, ui

---

## Goal

Automatically sync when files are created, modified, deleted, or renamed in the vault. Manual sync requires user action every time — auto-sync makes the plugin seamless.

---

## Current State

- Sync is manual-only (ribbon icon, command, or hotkey)
- No vault event listeners
- `ChangeQueue` class exists in types but not implemented
- Settings have no auto-sync toggle or interval config

---

## Plan

### 1. Vault event listeners (`src/sync/change-queue.ts`)

New `ChangeQueue` class:
- Listen to `vault.on('create' | 'modify' | 'delete' | 'rename')`
- Collect changed file paths with type (create/modify/delete)
- Debounce: wait N seconds after last event before triggering sync
- Merge rules: create + modify → create, create + delete → noop, modify + delete → delete
- Respect excluded paths (`isExcluded`)
- Flush: return accumulated changes and clear queue

### 2. Auto-push on vault events

- After debounce expires, trigger push-only sync (skip pull)
- Respect sync mutex and rate limits
- If sync fails, re-queue changes for next attempt
- Configurable: on/off toggle in settings

### 3. Periodic pull check

- Timer-based: check remote HEAD SHA at configurable interval (default: 5 min)
- If HEAD changed → trigger full pull
- Skip check during active sync
- Disable when auto-sync is off

### 4. Settings additions

- `autoSync: boolean` (default: false)
- `autoSyncInterval: number` (default: 300 — seconds between pull checks)
- `autoSyncDebounce: number` (default: 10 — seconds after last vault event)

### 5. Crash recovery

- Pending changes buffer persisted to plugin data
- On plugin load, check for unflushed changes and sync them

---

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/sync/change-queue.ts` |
| Create | `src/sync/change-queue.test.ts` |
| Modify | `src/sync/engine.ts` — add auto-sync orchestration |
| Modify | `src/settings.ts` — add auto-sync settings UI |
| Modify | `src/types.ts` — add settings fields |
| Modify | `src/main.ts` — wire event listeners, timers, lifecycle |
| Modify | `tests/e2e/specs/sync.spec.mts` — E2E auto-sync tests |

---

## Acceptance Criteria

- [ ] Vault create/modify/delete/rename events trigger auto-push after debounce
- [ ] Periodic pull detects remote changes
- [ ] Settings toggle enables/disables auto-sync
- [ ] Respects sync mutex, rate limits, excluded paths
- [ ] Unflushed changes survive plugin reload
- [ ] All gates pass (lint, type-check, test, build, check:obsidian)
