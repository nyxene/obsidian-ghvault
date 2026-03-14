# 106 — Periodic Pull Check with Adaptive Interval

**Issue:** #106
**Date:** 2026-03-14
**Status:** APPROVED
**Branch:** `feat/106-periodic-pull-check`

---

## Objective

Automatically poll remote for new commits and pull changes when detected. Currently auto-sync only reacts to local vault events — remote changes require manual Pull. This feature closes that gap with an adaptive polling mechanism that backs off when idle and resets when changes are found.

---

## Scope

| File | Changes |
|------|---------|
| `src/types.ts` | Add `autoSyncPullInterval: number` to settings + defaults |
| `src/main.ts` | `setupPullCheck()` / `teardownPullCheck()` — setTimeout chain with adaptive interval |
| `src/settings.ts` | Pull interval input (visible when autoSync=true), validation 30–3600s |
| `README.md` | Update features, settings table, remove "no remote polling" limitation |
| `docs/qa/manual-test-cases.md` | New test group for periodic pull check |
| `__tests__/main.test.ts` | Unit tests for timer lifecycle, SHA comparison, backoff, skip logic |
| `__tests__/settings.test.ts` | Validation tests for pull interval input |

---

## Approach

### Adaptive polling via setTimeout chain

```
baseInterval = autoSyncPullInterval (user setting, default 300s)
currentInterval = baseInterval
maxInterval = baseInterval × 8 (hardcoded cap)

on tick:
  if isSyncing → skip, reschedule(currentInterval)
  if !rateLimiter.canMakeRequest() → skip, reschedule(currentInterval)

  sha = getRef(branch)
  if sha !== state.headOid:
    runSync(silent=true)
    currentInterval = baseInterval        ← reset
  else:
    currentInterval = min(currentInterval × 2, maxInterval)  ← backoff

  reschedule(currentInterval)
```

### Why setTimeout over setInterval

Each tick schedules the next with the current (possibly changed) interval. No need to clear/recreate intervals on backoff. Cleaner lifecycle management.

### Why not a separate toggle

Pull polling is gated by the existing `autoSync` toggle. Adding a second toggle increases UI complexity for minimal benefit — if you want auto-sync, you want both directions.

---

## Tasks

- [ ] Add `autoSyncPullInterval` to `GHVaultSettings` interface and `DEFAULT_SETTINGS`
- [ ] Implement `setupPullCheck()` in main.ts — setTimeout chain, SHA comparison via `getRef()`
- [ ] Implement `teardownPullCheck()` in main.ts — clear timeout, reset state
- [ ] Adaptive interval logic: ×2 backoff on no-change, cap at ×8, reset on change detected
- [ ] Skip logic: isSyncing guard, rate limit check
- [ ] Error handling: log network errors, no notice, reschedule with backoff
- [ ] Wire setup/teardown into `setupAutoSync()` / `teardownAutoSync()` lifecycle
- [ ] Re-setup on settings change (teardown + setup with new interval)
- [ ] Settings UI: pull interval input with validation (30–3600s), blur restore, conditional visibility
- [ ] Unit tests main.ts: timer setup/teardown, SHA match/mismatch → sync/no-sync, backoff progression, cap, reset on change, skip during sync, skip on rate limit, error handling
- [ ] Unit tests settings.ts: validation bounds, blur restore, hidden when autoSync=false
- [ ] Manual QA test cases (docs/qa/manual-test-cases.md): new group TC-RPULL-xxx
- [ ] README: add periodic pull to features, add pullInterval to settings table, remove "no remote polling" limitation

---

## Edge Cases

- Sync already in progress → skip tick, keep current interval
- Rate limit near exhaustion → skip tick, keep current interval
- Network error → log silently, apply backoff, retry next tick
- Plugin unload → clearTimeout in teardownPullCheck()
- Settings change → teardown + setup with new base interval (resets backoff)
- autoSync disabled → timer not created / destroyed
- headOid is null (first sync not done yet) → skip tick

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Rate limit consumption | Even at min 30s = 120 calls/hour = 2.4% of 5000 limit. With backoff, much less |
| Mobile battery drain | Default 300s is conservative. Backoff reduces further when idle |
| False positive SHA mismatch | SHA comparison is exact — impossible |

---

## Out of Scope

- WebSocket / SSE (GitHub doesn't support for repo changes)
- Separate toggle for pull polling
- User-configurable backoff multiplier or cap

---

*Approved by: the Aronnax*
*Mobilis in Mobili*