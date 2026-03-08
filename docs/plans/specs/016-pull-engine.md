# Pull engine — download remote changes to vault

**Issue:** #16
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** feat/16-pull-engine

## Objective
Pull engine that fetches remote tree, computes diff against SHA cache, downloads changed files, and writes them to the vault.

## Scope
- `src/sync/pull.ts`
- `src/sync/pull.test.ts`

## Approach
PullEngine class with injected dependencies (GitHubClient, SyncStateManager, VaultAdapter, Logger). Single `pull(branch)` method:
1. Fetch HEAD ref → commit → recursive tree
2. Compute remote changes via `computeRemoteChanges()`
3. Download and write new/modified files, delete removed files
4. Update SHA cache + head OID + lastSyncedAt
5. Return PullResult with counts and per-file errors

VaultAdapter interface decouples from Obsidian Vault for testability.

## Tasks
- [ ] `src/sync/pull.ts` — PullEngine class + VaultAdapter interface
- [ ] `src/sync/pull.test.ts` — all pull scenarios + error handling
- [ ] All checks pass (lint, type-check, test, build)

## Out of Scope
- Conflict resolution
- Binary file handling
- Subfolder filtering

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
