# 205 — Fix 15 pre-existing E2E test failures

**Branch:** `fix/205-e2e-failures`
**Scope:** e2e, settings

---

## Goal

Fix all 15 pre-existing E2E test failures across 4 specs. Root causes identified by investigation agent.

---

## Workstreams

### WS1: publishing.spec.mts (7 fails) — Test bug

**Root cause:** `resetPluginSettings()` does `plugin.settings = { ... }` which replaces the object reference. The `GHVaultSettingTab` holds a reference to the OLD object via constructor. After replacement, tab reads stale `pagesEnabled: false`.

**Fix:** In `resetPluginSettings()`, mutate individual properties on the existing object instead of replacing it:
```typescript
Object.assign(plugin.settings, { pagesEnabled: false, pagesGenerator: "quartz", ... });
```
Or use `Object.keys(defaults).forEach(k => plugin.settings[k] = defaults[k])`.

**File:** `tests/e2e/specs/publishing.spec.mts`

### WS2: sync.spec.mts (6 fails) + ui.spec.mts (1 fail) — Mock setup

**Root cause:** After the Compare API feature (#182), `PullEngine.getRemoteChanges()` checks `ref.sha === localHead` — if equal, returns empty (no changes). The E2E mocks set `lastRemoteHeadSha` to the same value that `getRef` returns, so the engine always sees "no changes".

Also, mock client lacks `compareCommits`, causing fallback to full tree, but the SHA equality check happens before that.

**Fix:** In `injectMocks()` / `injectMockWithFiles()`:
1. When cache is provided (incremental sync), set `lastRemoteHeadSha` to a different value from what `getRef` returns (e.g. `"0".repeat(40)` for old, `HEAD_SHA` for new)
2. Add `compareCommits` mock that throws `"Not implemented"` (forces full-tree fallback, same as conflict-modal.spec.mts already does)

For the "binary and text files" test, ensure vault is cleaned of leftover files between tests.

**Files:** `tests/e2e/specs/sync.spec.mts`, `tests/e2e/specs/ui.spec.mts`

### WS3: settings.spec.mts (1 fail) — Source change

**Root cause:** Test expects `.ghvault-token-warning` element with text "stored unencrypted". This feature is documented in CLAUDE.md security notes but never implemented.

**Fix:** Add token warning banner in `src/settings.ts` after the GitHub token input:
```typescript
const warning = containerEl.createDiv({ cls: "ghvault-token-warning" });
warning.setText("Token is stored unencrypted in plugin data. Use a fine-grained PAT with minimal scopes.");
```

**Files:** `src/settings.ts`, `tests/e2e/specs/settings.spec.mts` (verify test assertion matches)

---

## Scope matrix

| File | WS | Change type |
|------|----|-------------|
| `tests/e2e/specs/publishing.spec.mts` | WS1 | E2E: fix reset function |
| `tests/e2e/specs/sync.spec.mts` | WS2 | E2E: fix mock SHA + add compareCommits |
| `tests/e2e/specs/ui.spec.mts` | WS2 | E2E: fix mock SHA |
| `src/settings.ts` | WS3 | Source: add token warning banner |
| `tests/e2e/specs/settings.spec.mts` | WS3 | E2E: verify assertion |

---

## Verification

E2E tests cannot be run in CI without `workflow_dispatch`. Local verification:
1. `npm run build`
2. `bun run test:e2e` — all 8 specs should pass
3. `npm run lint && npm run type-check && npm test` — unit tests still pass
