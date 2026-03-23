# 188 — Sync Status Panel (Per-File Status)

**Issue:** #188
**Date:** 2026-03-23
**Status:** APPROVED
**Branch:** `feat/188-sync-status-panel`

---

## Objective

Add a dedicated sidebar panel showing per-file sync status. Users can see at a glance which files are synced, pending, or in conflict — without relying on undocumented file explorer DOM manipulation.

---

## Background

### Why not decorate the native file explorer?

Obsidian's public API (v1.12.3) does **not** expose file explorer decoration APIs. Obsidian Git uses undocumented DOM mutation on `.nav-file` elements — this approach is fragile and breaks on Obsidian updates. We use `registerView()` + `ItemView` instead — a documented, stable API that works on desktop and mobile.

### What status information is available?

| Source | Data | Derivable status |
|--------|------|-----------------|
| `SHACacheEntry` | remoteSha, localContentHash, lastSyncedAt | synced / modified since sync |
| `ChangeQueue.pending` | Map<path, ChangeType> | pending push (create/modify/delete) |
| `SyncResult.conflicts` | ConflictInfo[] | conflicted files (after sync) |
| Vault files not in cache | — | untracked (new local files) |
| Cache entries without vault file | — | deleted locally |

### File statuses

| Status | Icon | Color | Meaning |
|--------|------|-------|---------|
| **Synced** | `check-circle` | green | File matches remote, no pending changes |
| **Pending** | `upload` | yellow | Local changes not yet pushed |
| **Conflict** | `alert-triangle` | red | Changed on both sides, needs resolution |
| **Untracked** | `plus-circle` | blue | New local file, not yet synced |

---

## Scope

| File | Changes |
|------|---------|
| `src/ui/sync-status-view.ts` | New: custom ItemView for sidebar panel |
| `src/ui/sync-status-view.test.ts` | New: unit tests |
| `src/main.ts` | Register view, add command, wire sync events |
| `src/main.test.ts` | Test view registration and command |
| `src/sync/engine.ts` | Emit sync result event for view refresh |

---

## Approach

### Custom ItemView (`src/ui/sync-status-view.ts`)

```typescript
export const SYNC_STATUS_VIEW_TYPE = "ghvault-sync-status";

export class SyncStatusView extends ItemView {
  getViewType(): string { return SYNC_STATUS_VIEW_TYPE; }
  getDisplayText(): string { return "GHVault: Sync Status"; }
  getIcon(): string { return "layers"; }

  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> { this.contentEl.empty(); }

  refresh(data: SyncStatusData): void { /* re-render */ }
}
```

### Data model

```typescript
interface SyncStatusData {
  synced: string[];      // files matching remote
  pending: Array<{ path: string; type: ChangeType }>;
  conflicts: ConflictInfo[];
  untracked: string[];   // local files not in cache
  lastSyncedAt: number;
}
```

Built from:
- `stateManager.getAllSHAs()` — cache entries
- `changeQueue.pending` (expose via getter)
- Last sync result conflicts (stored in plugin)
- `vault.getFiles()` — all local files
- Compare local files vs cache → derive untracked

### View layout

```
┌─ GHVault: Sync Status ───────────[🔄]─┐
│                                         │
│ Last synced: 14:32                      │
│                                         │
│ ⚠ CONFLICTS (1)                         │
│   △ notes/meeting.md                    │
│                                         │
│ ↑ PENDING (3)                           │
│   ↑ journal/today.md         modify     │
│   + projects/new.md          create     │
│   − old-draft.md             delete     │
│                                         │
│ ✓ SYNCED (47)                           │
│   ✓ notes/readme.md                     │
│   ✓ notes/ideas.md                      │
│   ...                                   │
│   [Show all 47 files]                   │
└─────────────────────────────────────────┘
```

- Sections ordered by priority: Conflicts → Pending → Synced
- Conflicts section: red, clickable → opens conflict modal or file
- Pending section: yellow, shows change type
- Synced section: green, collapsed by default (show first 5, "Show all N" expander)
- Header action button [🔄] triggers manual sync
- File paths clickable → open file in editor
- Refresh button in view header via `addAction()`

### View registration and lifecycle (main.ts)

```typescript
// In onload():
this.registerView(
  SYNC_STATUS_VIEW_TYPE,
  (leaf) => new SyncStatusView(leaf),
);

this.addCommand({
  id: "ghvault-toggle-sync-status",
  name: "Toggle sync status panel",
  callback: () => this.toggleSyncStatusPanel(),
});
```

### Refresh triggers

The view refreshes on:
1. **After sync completes** — `runSync()` calls `refreshSyncStatus()` with sync result
2. **Auto-sync change queued** — ChangeQueue `onPersist` callback triggers refresh
3. **Manual refresh** — header action button [🔄]
4. **View opened** — initial render with current state

### Exposing pending changes from ChangeQueue

Add `getPending(): ReadonlyMap<string, ChangeType>` to ChangeQueue:

```typescript
getPending(): ReadonlyMap<string, ChangeType> {
  return this.pending;
}
```

### Building SyncStatusData

```typescript
function buildSyncStatusData(
  cache: Record<string, SHACacheEntry>,
  vaultFiles: string[],
  pending: ReadonlyMap<string, ChangeType>,
  conflicts: ConflictInfo[],
  lastSyncedAt: number,
): SyncStatusData {
  const cachedPaths = new Set(Object.keys(cache));
  const synced: string[] = [];
  const untracked: string[] = [];

  for (const path of vaultFiles) {
    if (pending.has(path)) continue;
    if (cachedPaths.has(path)) {
      synced.push(path);
    } else {
      untracked.push(path);
    }
  }

  return {
    synced,
    pending: [...pending.entries()].map(([path, type]) => ({ path, type })),
    conflicts,
    untracked,
    lastSyncedAt,
  };
}
```

---

## Tasks

- [ ] Create `src/ui/sync-status-view.ts` — ItemView with sections
- [ ] Implement `buildSyncStatusData()` function
- [ ] Add `getPending()` getter to ChangeQueue
- [ ] Register view in main.ts `onload()`
- [ ] Add toggle command `ghvault-toggle-sync-status`
- [ ] Wire refresh after sync in `runSync()`
- [ ] Wire refresh on ChangeQueue persist
- [ ] Header action button for manual sync
- [ ] Clickable file paths → open file in editor
- [ ] Collapsible synced section (show first 5 + expander)
- [ ] Unit tests: buildSyncStatusData logic
- [ ] Unit tests: view registration and command
- [ ] Unit tests: refresh triggers
- [ ] E2E test: panel opens, shows status sections

---

## Edge Cases

- No sync engine configured → show "Configure GHVault settings" message
- Empty vault → show "No files in vault" message
- All files synced → only synced section, no pending/conflicts
- 1000+ synced files → collapsed by default, "Show all" expander
- Conflict from previous sync → persists in panel until resolved
- File deleted while panel open → refresh removes it
- Plugin unload → view detached cleanly
- Mobile → view in drawer, same content

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Performance with 1000+ files | Synced section collapsed, render only visible items |
| View not persisted across restart | Obsidian persists workspace layout automatically |
| ChangeQueue destroyed during sync | Refresh only when queue exists |

---

## Out of Scope

- Native file explorer decoration (no public API)
- Per-folder aggregated status (file-level only)
- Real-time content hash comparison (uses cache, not live hashing)
- Drag-and-drop from status panel

---

*Mobilis in Mobili*
