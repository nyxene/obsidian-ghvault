# 178 — "Last synced" in Status Bar

**Issue:** #178
**Date:** 2026-03-22
**Status:** APPROVED
**Branch:** `feat/178-last-synced-status-bar`

---

## Objective

Show when the last successful sync happened in the status bar. Currently the status bar shows only `GHVault: idle` / `syncing...` / `error` — the user has no idea when data was last synchronized. Two display modes depending on whether auto-sync is enabled.

---

## Scope

| File | Changes |
|------|---------|
| `src/main.ts` | Track `lastSuccessfulSyncAt` timestamp; two display modes; refresh interval for manual mode |
| `src/main.test.ts` | Unit tests for both modes, formatting, timer lifecycle, edge cases |
| `tests/e2e/specs/ui.spec.mts` | E2E tests: status bar shows synced time after sync, updates on mode switch |

---

## Approach

### Two display modes

| Mode | After successful sync | Refresh timer | Rationale |
|------|----------------------|---------------|-----------|
| `autoSync: true` | `GHVault: synced 14:32` | no | Syncs happen frequently, timestamp refreshes naturally |
| `autoSync: false` | `GHVault: synced 5 min ago` | yes, 30s | Manual syncs are rare, relative time is more informative |

### All status bar states

| State | Text |
|-------|------|
| Not configured | `GHVault: idle` |
| Configured, never synced | `GHVault: idle` |
| Syncing | `GHVault: syncing...` |
| Error | `GHVault: error` |
| Success, autoSync ON | `GHVault: synced HH:MM` |
| Success, autoSync OFF | `GHVault: synced just now` → `synced N min ago` → ... |

### Relative time formatting (manual mode)

```
< 60s  → "synced just now"
< 60m  → "synced N min ago"    (1 min ago, 2 min ago, ...)
< 24h  → "synced N hr ago"     (1 hr ago, 2 hr ago, ...)
≥ 24h  → "synced N d ago"      (1 d ago, 2 d ago, ...)
```

### Absolute time formatting (auto-sync mode)

```
Intl.DateTimeFormat with HH:MM in user's locale
Fallback: zero-padded 24h format (14:32)
```

### Implementation

1. Add `lastSuccessfulSyncAt: number` field to `GHVaultPlugin` (in-memory only, not persisted)
2. Add `statusRefreshInterval: ReturnType<typeof setInterval> | null` field
3. Extract two pure functions (exported for testing):
   - `formatRelativeTime(timestampMs: number, nowMs: number): string`
   - `formatAbsoluteTime(timestampMs: number): string`
4. Update `runSync()` — on success: set `lastSuccessfulSyncAt = Date.now()`, then `setStatus("idle")`
5. Modify `setStatus()`:
   - `"syncing..."` / `"error"` → display as-is, clear refresh interval
   - `"idle"` → check `lastSuccessfulSyncAt`:
     - `0` (never synced) → `GHVault: idle`
     - `> 0` + `autoSync: true` → `GHVault: synced HH:MM` (no interval)
     - `> 0` + `autoSync: false` → `GHVault: synced N ago` (start 30s interval)
6. Add `refreshStatusBar()` — recalculates relative time, calls `setText()`
7. Add `clearStatusRefresh()` — clears interval; called from `setStatus()` and `onunload()`
8. In `setupAutoSync()` — after teardown+setup, call `setStatus("idle")` to switch display mode

### Why in-memory only

- `SyncState.lastSyncedAt` tracks per-file sync time, not the overall last sync
- On plugin reload, showing "idle" until first sync is correct — the user just restarted
- No schema changes, no migration

### Why 30s refresh interval (manual mode only)

- Matches "just now" granularity (< 60s)
- After minutes, 30s resolution is more than enough
- Negligible CPU cost — one `setText()` call
- Not needed in auto-sync mode where syncs themselves update the text

---

## Tasks

- [ ] Add `lastSuccessfulSyncAt` and `statusRefreshInterval` fields to `GHVaultPlugin`
- [ ] Implement `formatRelativeTime(timestampMs, nowMs)` pure function
- [ ] Implement `formatAbsoluteTime(timestampMs)` pure function
- [ ] Modify `setStatus()` — branching logic for auto/manual mode
- [ ] Add `refreshStatusBar()` — 30s interval, manual mode only
- [ ] Add `clearStatusRefresh()` — clear interval; wire into `onunload()`
- [ ] Update `runSync()` — set `lastSuccessfulSyncAt` on success
- [ ] Update `setupAutoSync()` — re-render status bar on mode switch
- [ ] Unit tests: `formatRelativeTime()` — all brackets, boundaries
- [ ] Unit tests: `formatAbsoluteTime()` — HH:MM output
- [ ] Unit tests: auto-sync ON → shows `synced HH:MM`, no interval created
- [ ] Unit tests: auto-sync OFF → shows `synced just now`, interval created
- [ ] Unit tests: interval cleared on `syncing...` / `error` / `onunload()`
- [ ] Unit tests: mode switch (autoSync toggled) → display format changes
- [ ] E2E test: after successful sync, status bar shows `synced HH:MM` or `synced just now` (not `idle`)
- [ ] E2E test: update existing "shows idle on load" test — still valid (never synced)
- [ ] E2E test: update existing "syncing → idle" transition test — now transitions to `synced ...`

---

## Edge Cases

- Plugin loaded, never synced → `GHVault: idle` (both modes)
- Auto-sync toggled while "synced N min ago" showing → switches to `synced HH:MM` (or vice versa)
- Sync fails → `GHVault: error`, interval cleared, `lastSuccessfulSyncAt` preserved for next success
- Plugin unloaded during active interval → interval cleared, no leaks
- `statusBarEl` is null after unload → `refreshStatusBar()` is a no-op

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Interval leak on unload | `clearStatusRefresh()` in `onunload()`, defensive null check |
| Timer accumulation | `clearStatusRefresh()` called before creating new interval in `setStatus()` |
| `Intl.DateTimeFormat` unavailable on old mobile | Fallback to manual `HH:MM` formatting |

---

## Out of Scope

- Persisting last sync timestamp across plugin reloads
- Tooltip with exact timestamp on hover
- Different status for push vs pull
- Separate `src/ui/status-bar.ts` extraction (future refactor)

---

*Mobilis in Mobili*
