# Push engine — upload local changes to GitHub

**Issue:** #18
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** feat/18-push-engine

## Objective
Push engine that reads locally changed files, encodes to base64, and commits to GitHub via GraphQL createCommitOnBranch mutation.

## Scope
- `src/sync/push.ts`
- `src/sync/push.test.ts`

## Approach
PushEngine class with injected dependencies (GitHubGraphQL, SyncStateManager, VaultReader, Logger). Single `push()` method accepts FileChange[] and commit metadata, reads files, encodes, creates commit, updates state.

VaultReader interface decouples from Obsidian Vault for testability.

## Tasks
- [ ] `src/sync/push.ts` — PushEngine class + VaultReader interface
- [ ] `src/sync/push.test.ts` — all push scenarios + error handling
- [ ] All checks pass (lint, type-check, test, build)

## Out of Scope
- Conflict resolution
- Binary file handling

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
