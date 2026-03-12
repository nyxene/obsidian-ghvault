---
name: Release QA
about: QA checklist for a new release
title: "QA: v"
labels: infra
---

## Release QA — v{version}

**Release type:** patch / minor / major (delete as appropriate)
**Tester:** @
**Date:**
**Platforms tested:** macOS / Windows / Linux / iOS / Android

---

### Automated Gates

- [ ] `npm run lint` — clean
- [ ] `npm run type-check` — clean
- [ ] `npm test` — all unit tests pass
- [ ] `npm run build` — succeeds
- [ ] `npm run test:e2e` — all E2E tests pass
- [ ] `npm run check:obsidian` — all compliance checks pass

### Manual Tests — P0 (smoke)

<!-- Copy relevant P0 tests from docs/qa/manual-test-cases.md -->
<!-- Required for ALL release types -->

- [ ] TC-SET-001: Plugin loads with correct defaults
- [ ] TC-SET-002: Test Connection with invalid token
- [ ] TC-SET-003: Test Connection with valid PAT
- [ ] TC-FSYNC-001: Pull all files from populated repo
- [ ] TC-FSYNC-002: Nested directories created
- [ ] TC-FSYNC-005: Push local files to empty repo
- [ ] TC-PULL-001: New remote file pulled
- [ ] TC-PULL-002: Modified remote file updated
- [ ] TC-PULL-003: Deleted remote file removed
- [ ] TC-PUSH-001: New local file pushed
- [ ] TC-PUSH-002: Modified local file pushed
- [ ] TC-PUSH-003: Deleted local file removed from remote
- [ ] TC-BIDI-001: Pull + push in same cycle
- [ ] TC-CONF-001: Conflict detected and reported
- [ ] TC-GUARD-001: No settings configured
- [ ] TC-GUARD-002: Concurrent sync blocked
- [ ] TC-MOB-001: Settings tab renders on mobile
- [ ] TC-MOB-002: Sync works on mobile
- [ ] TC-OBSDN-001: No innerHTML/outerHTML
- [ ] TC-OBSDN-002: No fetch() calls
- [ ] TC-OBSDN-003: No Node.js imports

### Manual Tests — P1 (regression)

<!-- Required for MINOR and MAJOR releases -->
<!-- Delete this section for patch releases -->

- [ ] TC-SET-004: Input sanitization
- [ ] TC-FSYNC-003: Excluded patterns respected
- [ ] TC-FSYNC-004: Binary files handled
- [ ] TC-FSYNC-006: Commit is GPG-signed
- [ ] TC-BIDI-002: No changes — idempotent
- [ ] TC-CONF-002: Non-conflicting files sync alongside conflicts
- [ ] TC-SFLD-001: Only syncFolder files pulled
- [ ] TC-SFLD-002: Local files pushed with prefix
- [ ] TC-SFLD-003: Changing syncFolder clears cache
- [ ] TC-GUARD-003: Cooldown enforced
- [ ] TC-GUARD-004: Network error with token redaction
- [ ] TC-LARGE-001: File ~2MB synced via fallback
- [ ] TC-MOB-003: Create and push from mobile
- [ ] TC-MOB-004: Background/foreground resilience
- [ ] TC-LIFE-001: Disable/enable preserves settings
- [ ] TC-LIFE-002: Clean reinstall restores defaults

### Manual Tests — P2 (full)

<!-- Required for MAJOR releases only -->
<!-- Delete this section for patch/minor releases -->

- [ ] TC-GUARD-005: Expired/revoked token
- [ ] TC-LARGE-002: File >50MB skipped
- [ ] TC-MOB-005: Slow network behavior

### Notes

<!-- Any observations, performance measurements, edge cases discovered -->
