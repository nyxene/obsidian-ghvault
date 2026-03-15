# 112 — Conflict resolution strategies

**Status:** DRAFT
**Issue:** #112

## Goal

Allow users to choose how conflicts are resolved instead of always skipping.

## Current behavior

`SyncEngine.executeSyncCycle()` detects conflicts via `detectConflicts()`, builds `conflictPaths` set, and:
- Excludes them from pull (`skipPaths`)
- Excludes them from push (`safePushChanges` filter)
- Reports in Notice (since #110)

Files stay untouched on both sides.

## Proposed behavior

New setting `conflictStrategy` with three values:

| Strategy | Pull behavior | Push behavior | Use case |
|----------|--------------|---------------|----------|
| `skip` (default) | Skip conflicted files | Skip conflicted files | Current behavior, safest |
| `local-wins` | Skip conflicted files | Push local version (include in push) | "My device is the source of truth" |
| `remote-wins` | Pull remote version (include in pull) | Skip conflicted files | "GitHub is the source of truth" |

### Notice wording

- **skip:** `N conflicts` (as now)
- **local-wins:** `N resolved (local wins)`
- **remote-wins:** `N resolved (remote wins)`

## Changes

### `src/types.ts`

```typescript
export type ConflictStrategy = "skip" | "local-wins" | "remote-wins";

export const VALID_CONFLICT_STRATEGIES: ReadonlyArray<ConflictStrategy> = [
    "skip", "local-wins", "remote-wins",
];

// Add to GHVaultSettings:
conflictStrategy: ConflictStrategy;

// Add to DEFAULT_SETTINGS:
conflictStrategy: "skip",
```

### `src/settings.ts`

Add dropdown setting after "Log Level":
- Name: "Conflict strategy"
- Description: "How to handle files changed on both sides"
- Options: Skip (default) / Local wins / Remote wins

### `src/main.ts`

- Load/save/validate `conflictStrategy` (same pattern as `logLevel`)
- Pass `conflictStrategy` to `SyncEngine` (via `SyncEngineOptions` or `sync()` param)
- Update Notice: use "resolved" wording for non-skip strategies

### `src/sync/engine.ts`

Key change in `executeSyncCycle()`:

```typescript
const conflicts = detectConflicts(localChanges, remoteChanges);
const conflictPaths = new Set(conflicts.map((c) => c.path));

// Determine which sides get the conflicted files
let pullSkipPaths: ReadonlySet<string>;
let pushIncludeConflicts: boolean;

switch (this.conflictStrategy) {
    case "local-wins":
        // Skip in pull, include in push
        pullSkipPaths = conflictPaths;
        pushIncludeConflicts = true;
        break;
    case "remote-wins":
        // Include in pull, skip in push
        pullSkipPaths = new Set();
        pushIncludeConflicts = false;
        break;
    case "skip":
    default:
        // Skip both
        pullSkipPaths = conflictPaths;
        pushIncludeConflicts = false;
        break;
}

const pull = await this.pullEngine.pull(branch, pullSkipPaths);

const safePushChanges = localChanges.filter((c) => {
    if (!conflictPaths.has(c.path)) return true;
    return pushIncludeConflicts;
});
```

No changes needed in `pull.ts` or `push.ts` — they already support `skipPaths` filtering and accept arbitrary change lists.

### `src/sync/engine.ts` — SyncEngineOptions

Add `conflictStrategy` to options:

```typescript
export interface SyncEngineOptions {
    // ... existing fields
    conflictStrategy?: ConflictStrategy;
}
```

Default to `"skip"` if not provided.

### Tests

**`src/sync/engine.test.ts`:**
- skip strategy: conflicted files excluded from pull AND push (existing behavior)
- local-wins: conflicted files excluded from pull, included in push
- remote-wins: conflicted files included in pull, excluded from push
- default strategy (undefined) behaves as skip

**`src/main.test.ts`:**
- Notice shows "N conflicts" for skip strategy
- Notice shows "N resolved (local wins)" for local-wins strategy
- Notice shows "N resolved (remote wins)" for remote-wins strategy
- conflictStrategy loads/saves/validates correctly
- Invalid conflictStrategy in storage falls back to "skip"
- conflictStrategy passed to SyncEngine on rebuild

**`src/settings.test.ts`:**
- Conflict strategy dropdown renders with correct options
- Setting count updated (10 → 11)
- Dropdown has 3 options: Skip / Local wins / Remote wins

**`src/sync/integration.test.ts`:**
- End-to-end: local-wins pushes local version of conflicted file, remote file overwritten
- End-to-end: remote-wins pulls remote version of conflicted file, local file overwritten
- End-to-end: skip preserves both sides (existing tests)

### QA test cases (`docs/qa/manual-test-cases.md`)

Add to Group F (Conflict Handling):

- **TC-CONF-003 [P0]:** local-wins — edit file locally + remotely → sync → local version pushed, remote overwritten
- **TC-CONF-004 [P0]:** remote-wins — edit file locally + remotely → sync → remote version pulled, local overwritten
- **TC-CONF-005 [P1]:** skip strategy — same as TC-CONF-001 (existing behavior preserved)
- **TC-CONF-006 [P1]:** change strategy in settings → next sync uses new strategy
- **TC-CONF-007 [P1]:** local-wins with delete conflict — file deleted remotely, modified locally → local version pushed
- **TC-CONF-008 [P1]:** remote-wins with delete conflict — file deleted remotely, modified locally → local file deleted

### README

- Update Features section: "Conflict handling" → "Configurable conflict resolution — skip, local-wins, or remote-wins strategies"
- Add `conflictStrategy` to Settings table
- Update Conflict handling section with strategy descriptions

## Out of scope

- Interactive "ask" strategy with modal UI (issue TBD)
- 3-way merge / content diffing
- Per-file strategy override
