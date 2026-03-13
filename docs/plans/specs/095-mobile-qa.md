# 095 — Manual mobile QA testing (iOS + Android)

**Issue:** #95
**Branch:** N/A (manual testing, no code changes)
**Scope:** infra

---

## Goal

Verify plugin works correctly on mobile platforms (iOS and Android). Obsidian community plugin submission requires mobile compatibility. E2E tests only cover desktop (Electron).

---

## Current State

- All automated tests run on desktop only
- No mobile testing has been performed
- Mobile-specific test cases exist in `docs/qa/manual-test-cases.md` (Group K: TC-MOB-001 through TC-MOB-005)

---

## Plan

### Test cases to execute

From `docs/qa/manual-test-cases.md`:

1. **TC-MOB-001** (P0): Settings tab renders on mobile — all fields visible and functional
2. **TC-MOB-002** (P0): Sync works on mobile — files pulled/pushed correctly
3. **TC-MOB-003** (P1): Create and push from mobile — new note appears on GitHub
4. **TC-MOB-004** (P1): Background/foreground resilience — no crash on app switch during sync
5. **TC-MOB-005** (P2): Slow network behavior — error notice, no crash, can retry

### Additional checks

- Binary file sync (PNG) on mobile
- Status bar visibility on mobile
- Test connection button on mobile
- Settings persistence after app close/reopen

### Platforms

- iOS (iPhone or iPad)
- Android (phone or tablet)

---

## Deliverables

- [ ] Test results documented with pass/fail per test case per platform
- [ ] Any mobile-specific bugs filed as issues
- [ ] Confirmation that plugin meets Obsidian mobile compatibility requirements
