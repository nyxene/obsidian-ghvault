# 108 — Crash Recovery: Persist Pending Changes Across Restarts

**Issue:** #108
**Date:** 2026-03-14
**Status:** APPROVED
**Branch:** `feat/108-crash-recovery`

---

## Objective

When Obsidian crashes, restarts, or the plugin is disabled while auto-sync has accumulated pending changes in the in-memory `ChangeQueue`, those changes are lost. The user has no way to know that unsaved vault edits were never pushed to GitHub.

This feature persists the pending changes buffer to `plugin.saveData()` so they survive restarts, and triggers a sync on load to flush them.

---

## Scope

| File | Changes |
|------|---------|
| `src/sync/change-queue.ts` | Accept `StorageAdapter`, persist `pending` map on mutation, add `restore()` method |
| `src/main.ts` | Pass storage adapter to ChangeQueue, restore pending on load, trigger sync if non-empty |
| `src/sync/change-queue.test.ts` | Tests for persist/restore cycle, corrupted data, stale entries |
| `src/main.test.ts` | Tests for restore-on-load, sync-after-restore, clean buffer after sync |
| `docs/qa/manual-test-cases.md` | New test group TC-CRASH-xxx |
| `README.md` | Mention crash recovery in features |

---

## Approach

### Storage format

Pending changes are stored under a dedicated key in `data.json` alongside `settings` and `syncState`:

```json
{
  "settings": { ... },
  "syncState": { ... },
  "pendingChanges": {
    "notes/todo.md": "modify",
    "attachments/img.png": "create",
    "old-note.md": "delete"
  }
}
```

The value is `Record<string, ChangeType>` — the exact shape of `ChangeQueue.pending`.

### Persistence strategy

**When to persist:**
- On every `push()` call to ChangeQueue (after merge logic)
- On `flush()` — persist empty map (clear)
- On `destroy()` — do NOT clear (preserve for recovery)

**Why persist on every push:**
- Crash can happen at any time — batching risks data loss
- Writes go to `plugin.saveData()` which is a simple JSON write to `data.json`
- At debounce intervals (1–300s), the write frequency is bounded by user edit rate
- Obsidian's `saveData()` is designed for frequent small updates

**Why NOT clear on destroy:**
- `destroy()` is called in `teardownAutoSync()` when settings change or plugin unloads
- On clean unload, the pending queue should already be empty (sync completed)
- On crash, `destroy()` is never called — the persisted data survives
- If plugin is disabled mid-queue, restoring on re-enable is the correct behavior

### Restore flow

```
onload():
  loadSettings()
  rebuildSyncEngine()
  setupAutoSync()          ← creates ChangeQueue
  restorePendingChanges()  ← NEW: reads from storage, pushes into queue
    if pendingChanges exist and autoSync is enabled:
      for each (path, type) in pendingChanges:
        changeQueue.push(path, type)    ← triggers debounce → sync
      logger.info("Restored N pending changes from previous session")
```

The restored changes go through `push()` which:
1. Re-applies merge logic (handles redundant entries)
2. Resets the debounce timer → sync fires after debounce period
3. Persists the merged state back to storage (idempotent)

### Staleness handling

Pending changes could be stale if the user has already synced from another device or the files no longer exist. This is safe because:

- `runSync()` performs a full pull → push cycle
- Pull updates the SHA cache with remote state
- Push computes diffs against the SHA cache
- If a "pending" file hasn't actually changed (hash matches cache), it's a no-op
- If a "pending" file was deleted locally, the push treats it as a deletion
- If the file was already synced from another device, SHA match → skip

No special staleness logic needed — the existing sync pipeline handles it.

### Edge cases

| Case | Behavior |
|------|----------|
| Crash during sync (mid-push) | Pending changes were already persisted pre-sync. On restart, they're restored. Sync retry will reconcile via SHA cache |
| Plugin disabled with pending changes | Changes persisted. On re-enable, restored and synced |
| autoSync disabled on restart | Pending changes stay in storage but are NOT restored (no ChangeQueue). Restored when autoSync is re-enabled |
| Corrupted pendingChanges in data.json | Validate each entry: path must be string, type must be valid ChangeType. Skip invalid entries, log warning |
| Empty pendingChanges | No-op, no sync triggered |
| Pending changes + remote has diverged | Normal flow: pull first (detects remote changes), then push (sends local changes). Conflicts handled by existing logic |

---

## Tasks

- [ ] Add `onPersist` callback to `ChangeQueue` constructor options
- [ ] Call `onPersist(pending)` in `push()` after merge logic
- [ ] Call `onPersist(empty)` in `flush()` to clear persisted buffer
- [ ] Do NOT call `onPersist` in `destroy()` — preserve for recovery
- [ ] Add `restorePendingChanges()` to `main.ts` — read from storage, push into queue
- [ ] Wire `restorePendingChanges()` into `onload()` after `setupAutoSync()`
- [ ] Wire `onPersist` in `setupAutoSync()` — save via `this.saveData()`
- [ ] Validate persisted data on restore (type guards for path + ChangeType)
- [ ] Unit tests change-queue: onPersist called on push, flush clears, destroy preserves
- [ ] Unit tests main.ts: restore on load triggers sync, empty restore is no-op, corrupted data skipped
- [ ] Manual QA test cases (docs/qa/manual-test-cases.md): new group TC-CRASH-xxx
- [ ] README: add crash recovery to features list

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Frequent saveData writes on rapid edits | Bounded by edit rate; Obsidian's saveData is designed for this; debounce already limits sync frequency |
| Stale pending changes cause unexpected syncs | Sync pipeline handles via SHA comparison — stale entries become no-ops |
| Storage quota on mobile | pendingChanges is a small map (<1KB typical); data.json already stores SHA cache which is much larger |

---

## Out of Scope

- Persisting sync-in-progress state (partial push recovery)
- Undo/rollback of synced changes
- UI notification about restored pending changes (logger only)
- Conflict resolution for crash-during-sync scenarios (existing logic handles)

---

*Approved by: the Aronnax*
*Mobilis in Mobili*
