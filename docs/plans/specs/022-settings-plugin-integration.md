# Settings tab and plugin integration

**Issue:** #22
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** feat/22-settings-plugin-integration

## Objective
Wire all components together: settings tab UI, plugin lifecycle, sync commands, status bar, and ObsidianVaultAdapter bridging Obsidian Vault API to SyncVault interface.

## Scope
- `src/settings.ts` — GHVaultSettingTab
- `src/sync/vault-adapter.ts` — ObsidianVaultAdapter
- `src/main.ts` — Plugin integration (update)
- `src/__mocks__/obsidian.ts` — Extend mock for new Obsidian classes

## Tasks
- [ ] `src/settings.ts` — Settings tab with token, owner, repo, branch, log level
- [ ] `src/sync/vault-adapter.ts` — SyncVault implementation via Obsidian Vault API
- [ ] `src/main.ts` — Wire components, commands, ribbon, status bar
- [ ] Update obsidian mock for new classes used
- [ ] All checks pass (lint, type-check, test, build)

## Out of Scope
- Automatic periodic sync
- Conflict resolution UI

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
