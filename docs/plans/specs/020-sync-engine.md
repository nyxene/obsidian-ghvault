# SyncEngine — orchestrate pull and push

**Issue:** #20
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** feat/20-sync-engine

## Objective
SyncEngine orchestrates the full sync cycle: pull remote changes, compute local diff, push local changes. Single entry point for the plugin.

## Scope
- `src/sync/engine.ts`
- `src/sync/engine.test.ts`

## Approach
SyncEngine class with injected PullEngine, PushEngine, SyncStateManager, and SyncVault. Single `sync()` method runs pull → local diff → push. Mutex prevents concurrent syncs. Unified SyncResult returned.

SyncVault interface unifies VaultAdapter + VaultReader + listFiles.

## Tasks
- [ ] `src/sync/engine.ts` — SyncEngine class + SyncVault interface
- [ ] `src/sync/engine.test.ts` — all sync scenarios + mutex + error handling
- [ ] All checks pass (lint, type-check, test, build)

## Out of Scope
- Conflict resolution beyond last-write-wins
- Automatic periodic sync
- Binary file handling

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
