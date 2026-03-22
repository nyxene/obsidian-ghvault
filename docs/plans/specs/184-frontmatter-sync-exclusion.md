# 184 — Frontmatter `ghvault-sync: false` Exclusion

**Issue:** #184
**Date:** 2026-03-22
**Status:** APPROVED
**Branch:** `feat/184-frontmatter-sync-exclusion`

---

## Objective

Allow users to exclude individual files from sync by adding `ghvault-sync: false` to the file's frontmatter (Obsidian Properties). This provides per-file opt-out without needing glob patterns in settings — useful for drafts, private notes, or work-in-progress files.

---

## Background

### Current exclusion

Files are excluded via glob patterns in settings (`excludePatterns` textarea) and hardcoded patterns (`.obsidian/**`, `.trash/**`, `ghvault.log`). These are path-based — there's no way to exclude a specific file without knowing its exact path or writing a pattern that matches it.

### Obsidian Properties / Frontmatter

Obsidian supports YAML frontmatter at the top of `.md` files:

```yaml
---
ghvault-sync: false
---
# My Draft Note
```

Obsidian parses frontmatter into `app.metadataCache`. Accessing it is instant (no file I/O):

```typescript
const cache = app.metadataCache.getFileCache(file);
const syncDisabled = cache?.frontmatter?.["ghvault-sync"] === false;
```

### Non-markdown files

Frontmatter only works for `.md` files. Non-markdown files (images, PDFs, etc.) cannot use this feature — they must use glob patterns.

---

## Scope

| File | Changes |
|------|---------|
| `src/sync/vault-adapter.ts` | Accept `isSyncExcluded` callback; check in `listFiles()` |
| `src/sync/vault-adapter.test.ts` | Tests for frontmatter exclusion |
| `src/main.ts` | Pass `isSyncExcluded` callback using `app.metadataCache` |
| `src/main.test.ts` | Test callback wiring |
| `src/sync/change-queue.ts` | Check frontmatter before queuing auto-sync events |
| `src/sync/change-queue.test.ts` | Tests for frontmatter filtering in queue |

---

## Approach

### Callback injection (no App dependency in adapter)

Add an optional `isSyncExcluded?: (path: string) => boolean` callback to `ObsidianVaultAdapter` constructor. This keeps the adapter testable without mocking `App`:

```typescript
constructor(vault: Vault, excludePatterns?: readonly string[], isSyncExcluded?: (path: string) => boolean)
```

### Where the callback is created (main.ts)

```typescript
const isSyncExcluded = (path: string): boolean => {
  const cache = this.app.metadataCache.getCache(path);
  return cache?.frontmatter?.["ghvault-sync"] === false;
};
```

### Where frontmatter is checked

**1. `listFiles()` in vault-adapter.ts** — filter out files with `ghvault-sync: false` before computing hashes. This prevents excluded files from appearing as local changes.

**2. `ChangeQueue` in change-queue.ts** — when auto-sync is enabled, vault events (create/modify/delete) go through the change queue. Check frontmatter before adding to queue. This prevents excluded files from triggering auto-sync.

### What about pull (remote → local)?

Frontmatter exclusion is **local-only**: it prevents local files from being pushed. Remote files are always pulled regardless of frontmatter — because we can't read frontmatter from a remote file without downloading it first (chicken-and-egg). A file pulled from remote that has `ghvault-sync: false` in its frontmatter will be written locally but won't be pushed back on subsequent syncs.

### What about delete sync?

If a file has `ghvault-sync: false` and is deleted locally, the delete should NOT be synced to remote. `listFiles()` already skips excluded files, so `computeLocalChanges()` won't see the file disappear (it was never in the local file list). This works naturally.

### Property name

`ghvault-sync` — hyphenated to match Obsidian Properties convention. Value: `false` (boolean). Any other value or missing property = sync enabled.

---

## Tasks

- [ ] Add `isSyncExcluded` callback parameter to `ObsidianVaultAdapter` constructor
- [ ] Check `isSyncExcluded` in `listFiles()` — skip files that return true
- [ ] Create `isSyncExcluded` callback in `main.ts` using `app.metadataCache`
- [ ] Pass callback when constructing `ObsidianVaultAdapter` in `rebuildSyncEngine()`
- [ ] Add frontmatter check in `ChangeQueue.push()` — skip excluded files
- [ ] Add `isSyncExcluded` callback parameter to `ChangeQueue` constructor
- [ ] Unit tests: `listFiles()` skips files with `ghvault-sync: false`
- [ ] Unit tests: `listFiles()` includes files with `ghvault-sync: true` or no frontmatter
- [ ] Unit tests: `ChangeQueue` skips excluded files
- [ ] Unit tests: callback wiring in main.ts

---

## Edge Cases

- File has `ghvault-sync: false` → not pushed, not in local changes
- File has `ghvault-sync: true` → synced normally (explicit opt-in same as default)
- File has no `ghvault-sync` property → synced normally (default: sync)
- File has `ghvault-sync: "false"` (string, not boolean) → synced normally (only boolean `false` counts)
- Non-markdown file → no frontmatter, synced normally
- File deleted locally with `ghvault-sync: false` → delete NOT synced to remote
- Remote file pulled with `ghvault-sync: false` in its content → written locally, not pushed back
- `metadataCache` not ready yet (plugin loading) → `getFileCache` returns null → file synced (safe default)
- File renamed while excluded → rename not synced (file invisible to listFiles)

---

## Risks

| Risk | Mitigation |
|------|-----------|
| User forgets frontmatter is set, wonders why file doesn't sync | Status bar or log message could hint at excluded files count (future) |
| metadataCache stale | Obsidian updates cache on file save; for initial load, cache is populated before plugin runs |
| Performance of checking frontmatter per file | `getFileCache` is O(1) lookup in memory, negligible |

---

## Out of Scope

- UI indicator showing which files are excluded
- Bulk toggle (exclude entire folder via frontmatter)
- Remote-side frontmatter checking (would require downloading file first)
- `ghvault-sync: push-only` or `ghvault-sync: pull-only` variants

---

*Mobilis in Mobili*
