# 124 — User-configurable exclude patterns

**Issue:** #124
**Date:** 2026-03-16
**Status:** APPROVED
**Branch:** feat/124-exclude-patterns

## Objective

Allow users to define custom glob patterns to exclude files from sync, in addition to hardcoded excludes (.obsidian, .trash, ghvault.log).

## Approach

### Settings

- New field `excludePatterns: string` (multi-line, one pattern per line)
- Default: `""` (empty)
- Textarea in settings tab

### Pattern merging

`getEffectiveExcludePatterns(userInput: string): string[]` in `utils/path.ts`:
- Split by `\n`, trim, filter empty lines
- Combine with `EXCLUDED_PATTERNS`
- Return merged array

### Passing patterns

Combined patterns computed once in `main.ts` at `rebuildSyncEngine()`, passed via options to all engines. Each component receives `excludePatterns: string[]` in its constructor/options.

## Scope

| File | Change |
|------|--------|
| `src/types.ts` | `excludePatterns` in GHVaultSettings + DEFAULT_SETTINGS |
| `src/utils/path.ts` | `getEffectiveExcludePatterns()` |
| `src/settings.ts` | Textarea UI |
| `src/main.ts` | Compute + pass combined patterns |
| `src/sync/comparator.ts` | Accept patterns parameter |
| `src/sync/change-queue.ts` | Accept patterns in constructor |
| `src/sync/vault-adapter.ts` | Accept patterns in listFiles |
| `src/sync/pull.ts` | Accept patterns in constructor |
| `src/sync/engine.ts` | Accept + forward patterns |
| Tests | path, settings, comparator, engine, integration, E2E |
| QA + README | |

## Tasks

- [ ] `src/types.ts` — excludePatterns field
- [ ] `src/utils/path.ts` — getEffectiveExcludePatterns()
- [ ] `src/settings.ts` — textarea UI
- [ ] `src/sync/comparator.ts` — patterns param
- [ ] `src/sync/change-queue.ts` — patterns in constructor
- [ ] `src/sync/vault-adapter.ts` — patterns in listFiles
- [ ] `src/sync/pull.ts` — patterns in constructor
- [ ] `src/sync/engine.ts` — patterns in options, forward
- [ ] `src/main.ts` — compute + pass combined patterns
- [ ] Unit + integration + E2E tests
- [ ] QA cases + README

## Risks

- **Breaking change in comparator API** — new param with default = EXCLUDED_PATTERNS
- **Invalid globs** — matchPattern returns false for unknown patterns (safe)

## Out of Scope

- Include patterns (whitelist)
- Per-file override
- Regex patterns (only glob)

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
