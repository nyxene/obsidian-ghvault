# SyncState manager — persist sync state via plugin.saveData()

**Issue:** #12
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** feat/12-sync-state

## Objective
SyncState manager for persisting sync metadata (SHA cache, last sync timestamp, head OID) via Obsidian's plugin data API.

## Scope
- `src/sync/state.ts`
- `src/sync/state.test.ts`

## Approach
SyncStateManager accepts `loadData`/`saveData` callbacks (from Plugin), decoupled from Plugin class for testability. Uses `SyncState` interface from types.ts. Auto-saves on mutation via debounced save.

## Tasks
- [ ] `src/sync/state.ts` — SyncStateManager class
- [ ] `src/sync/state.test.ts` — load, save, SHA CRUD, batch, head OID, clear
- [ ] All checks pass (lint, type-check, test, build)

## Out of Scope
- State version migration
- File-level locking

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
