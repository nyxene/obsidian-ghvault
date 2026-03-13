# 099 — Add settings tab and status bar edge case tests

**Issue:** #99
**Branch:** `test/99-ui-edge-case-tests`
**Scope:** ui, settings

---

## Goal

Close UI test coverage gaps: rapid settings onChange, status bar null safety after unload, malformed settings data, saveSettings error handling.

---

## Current State

- Settings onChange: no test for rapid successive changes (debouncing)
- Status bar: no test for `statusBarEl` being null when sync completes after unload
- `loadSettings()`: branch at lines 95-96 (non-string values for token/owner/repo) untested
- `saveSettings()`: error path untested
- `testConnection`: non-Error throw not tested

---

## Plan

### 1. Extend: `src/settings.test.ts`

- Rapid onChange — multiple fast changes to same field → only last value persisted
- loadSettings with malformed data — numbers, booleans, arrays instead of strings → defaults to empty string
- saveSettings error — plugin.saveData rejects → error handled gracefully

### 2. Extend: `src/main.test.ts`

- Status bar null safety — `onunload()` called, then sync completes → no crash when updating status bar
- testConnection with non-Error throw → sanitized error message shown

---

## Files to Modify

| Action | File |
|--------|------|
| Modify | `src/settings.test.ts` |
| Modify | `src/main.test.ts` |

---

## Acceptance Criteria

- [ ] All new tests pass
- [ ] No source code modifications
- [ ] All gates pass
