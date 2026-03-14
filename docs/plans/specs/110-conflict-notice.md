# 110 — Display conflict count in sync notice

**Status:** DRAFT
**Issue:** #110

## Goal

Show conflict count in the user-facing Notice after sync, so users know conflicts occurred without checking the log.

## Current behavior

`runSync()` in `main.ts` displays:
- `GHVault: Synced — N pulled, M pushed` (when changes exist)
- `GHVault: Already up to date` (when no changes)

`result.conflicts` is returned by `SyncEngine.sync()` but ignored in the Notice.

## Proposed behavior

Include conflict count in Notice when `result.conflicts.length > 0`:

| Scenario | Notice |
|----------|--------|
| Changes + conflicts | `GHVault: Synced — 3 pulled, 1 pushed, 2 conflicts` |
| No changes + conflicts | `GHVault: Synced — 0 pulled, 0 pushed, 2 conflicts` |
| Changes, no conflicts | `GHVault: Synced — 3 pulled, 1 pushed` (unchanged) |
| No changes, no conflicts | `GHVault: Already up to date` (unchanged) |

Note: when conflicts exist, always show the full "Synced" format (not "Already up to date") even if pull/push counts are zero — the user needs to know something happened.

## Changes

### `src/main.ts` — `runSync()`

```typescript
const conflictCount = result.conflicts.length;

if (pullCount === 0 && pushCount === 0 && conflictCount === 0) {
    if (!silent) new Notice("GHVault: Already up to date");
} else {
    const parts = [`${pullCount} pulled`, `${pushCount} pushed`];
    if (conflictCount > 0) {
        parts.push(`${conflictCount} conflicts`);
    }
    new Notice(`GHVault: Synced — ${parts.join(", ")}`);
}
```

### `src/main.test.ts`

Add tests:
1. Notice includes conflict count when conflicts exist
2. Notice shows "Synced" (not "Already up to date") when only conflicts exist
3. Notice omits conflict info when no conflicts (existing behavior preserved)

### `docs/qa/manual-test-cases.md`

Verify TC-CONF-001 expected result matches new behavior.

## Out of scope

- Listing individual file paths in Notice
- Conflict resolution strategies or UI
- Changes to SyncEngine or conflict detection logic
