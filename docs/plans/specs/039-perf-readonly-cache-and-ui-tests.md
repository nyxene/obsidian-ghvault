# 039 — Perf: readonly cache + UI integration tests

**Issues:** #75, #76
**Branch:** `refactor/75-readonly-cache-and-ui-tests`
**Scope:** sync, ui, settings

---

## Problem

1. **#75 — `getAllSHAs()` copies on every call.** `state.ts:76` returns `{ ...this.state.cache }` creating a shallow copy. Called 3x per sync cycle. At 5000+ files this becomes noticeable (benchmarks: 771 ops/s for 100 copies of 1000 entries). All callers only read the result — no mutations needed.

2. **#76 — Missing UI integration tests.** Settings→engine rebuild flow and syncFolder onChange→clearSyncState chain are not tested end-to-end.

---

## Fix Plan

### #75 — Return readonly reference instead of copy

**File:** `src/sync/state.ts`

Change `getAllSHAs()` to return a `Readonly` type and return the cache directly:

```typescript
getAllSHAs(): Readonly<Record<string, SHACacheEntry>> {
    return this.state.cache;
}
```

**File:** `src/sync/comparator.ts`

Update parameter types to accept `Readonly`:

```typescript
export function computeLocalChanges(
    localFiles: LocalFileInfo[],
    cache: Readonly<Record<string, SHACacheEntry>>,
): FileChange[]

export function computeRemoteChanges(
    remoteTree: GitHubTreeEntry[],
    cache: Readonly<Record<string, SHACacheEntry>>,
): FileChange[]
```

**File:** `src/sync/state.test.ts`

Update the "getAllSHAs returns a copy" test → "getAllSHAs returns readonly reference". Verify that the TypeScript compiler enforces read-only access (the existing mutation test becomes irrelevant since `Readonly` prevents it at compile time). Replace with a test verifying the returned object reflects live state.

### #76 — UI integration tests

**File:** `src/main.test.ts` — add:

- Test: `onSave` callback with changed syncFolder triggers `clearSyncState`
- Test: `onSave` callback with same syncFolder does NOT trigger `clearSyncState`
- Test: `onSave` rebuilds SyncEngine with new settings

**File:** `src/settings.test.ts` — add:

- Test: settings onChange chain calls `onSave` when value changes

---

## Files Changed

| File | Change |
|------|--------|
| `src/sync/state.ts` | `getAllSHAs()` returns `Readonly<Record<...>>`, no copy |
| `src/sync/comparator.ts` | Parameter types accept `Readonly` |
| `src/sync/state.test.ts` | Update copy test → readonly reference test |
| `src/main.test.ts` | 2-3 new tests for onSave/syncFolder chain |
| `src/settings.test.ts` | 1 new test for onChange→onSave chain |

---

## Verification

```bash
npm run lint
npm run type-check
npm run test
npm run build
```
