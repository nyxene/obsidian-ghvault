# Release Checklist

Step-by-step checklist for releasing GHVault. Combines automated gates, manual QA, and release artifact verification.

## How to use

1. When release-please opens a release PR, create a QA tracking issue from `.github/ISSUE_TEMPLATE/release-qa.md`
2. Determine release type: **patch** / **minor** / **major**
3. Run the corresponding test scope (see below)
4. Check off items as you go, note failures with issue links
5. All required items must pass before merging the release PR

## Release Types

| Type | Version | Manual Test Scope | Required |
|------|---------|-------------------|----------|
| Patch | 0.x.1 | P0 smoke (21 tests) + regression of specific fix | All P0 |
| Minor | 0.x.0 | P0 + P1 (37 tests) + new feature verification | All P0, P1 |
| Major | x.0.0 | P0 + P1 + P2 (40 tests) + mobile + performance | All |

---

## Base Checklist (every release)

### Automated Gates

- [ ] `npm run lint` — clean
- [ ] `npm run type-check` — clean
- [ ] `npm test` — all unit tests pass
- [ ] `npm run build` — succeeds, main.js reasonable size
- [ ] `npm run test:e2e` — all E2E tests pass

### Obsidian Community Plugin Compliance

- [ ] `npm run check:obsidian` — all checks pass:
  - No `innerHTML` / `outerHTML` usage
  - No `fetch()` — only `requestUrl()`
  - No Node.js imports (`fs`, `path`, `child_process`)
  - No regex lookbehind (breaks iOS WebKit)
  - manifest.json: id doesn't contain "obsidian"
  - manifest.json: description doesn't contain "Obsidian"

### Release Artifacts

- [ ] `manifest.json` version matches release
- [ ] `package.json` version matches release
- [ ] CHANGELOG.md updated (release-please handles this)
- [ ] `main.js` built in production mode
- [ ] `styles.css` present
- [ ] `manifest.json` present
- [ ] LICENSE present

---

## Patch Release (additional)

- [ ] Specific fix verified manually
- [ ] Regression test on affected area (check [dependency graph](dependency-graph.md) for impact)
- [ ] P0 smoke tests pass (see [manual-test-cases.md](manual-test-cases.md), Groups A-G + I + K + M)

---

## Minor Release (additional)

- [ ] All P0 smoke tests pass
- [ ] All P1 regression tests pass
- [ ] New features verified manually
- [ ] Settings migration works (if settings shape changed)
- [ ] Existing vaults continue to work after update

---

## Major Release (additional)

- [ ] All P0 + P1 + P2 tests pass (full 40-test catalog)
- [ ] Mobile QA complete — iOS and/or Android (Group K)
- [ ] Performance: sync 100+ files, measure time
- [ ] Large file handling verified (Group J: 2MB, 50MB+)
- [ ] Full plugin lifecycle test (Group L: install/disable/enable/uninstall)
- [ ] All platforms tested: macOS, Windows, Linux, iOS, Android

---

## Post-Release

- [ ] GitHub Release created with `main.js` + `manifest.json` + `styles.css`
- [ ] Release notes reviewed for accuracy
- [ ] Test install from release download on clean vault
- [ ] Update community plugins PR (if applicable)
