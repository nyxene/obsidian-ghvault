---
description: Run release QA — automated gates + manual test checklist by release type
argument-hint: "[patch | minor | major]"
---

Run release QA checks for GHVault. Executes automated gates and outputs a manual test checklist scoped to the release type.

**Release type:** $ARGUMENTS (default: `patch`). Options: `patch`, `minor`, `major`.

---

## Step 1: Automated Gates

Run each command and report pass/fail:

1. `npm run lint`
2. `npm run type-check`
3. `npm test`
4. `npm run build`
5. `npm run check:obsidian`

If any gate fails, report the failure details and stop. Do not proceed to manual tests until all gates pass.

## Step 2: Artifact Verification

Check that release artifacts exist and are consistent:

1. `main.js` exists in project root (built in Step 1)
2. `styles.css` exists
3. `manifest.json` exists
4. `LICENSE` exists
5. Version in `manifest.json` matches version in `package.json`

## Step 3: Manual Test Checklist

Read `docs/qa/manual-test-cases.md` and output the relevant test cases based on release type:

- **patch**: P0 tests only (21 tests)
- **minor**: P0 + P1 tests (37 tests)
- **major**: P0 + P1 + P2 tests (40 tests)

## Output Format

```
## Release QA — {type}

### Automated Gates

| # | Gate | Status | Details |
|---|------|--------|---------|
| 1 | lint | ✅ PASS / ❌ FAIL | (error details if failed) |
| 2 | type-check | ✅ PASS / ❌ FAIL | |
| 3 | unit tests | ✅ PASS / ❌ FAIL | N tests passed |
| 4 | build | ✅ PASS / ❌ FAIL | main.js size |
| 5 | obsidian compliance | ✅ PASS / ❌ FAIL | |

### Artifacts

| File | Status |
|------|--------|
| main.js | ✅ present / ❌ missing |
| styles.css | ✅ present / ❌ missing |
| manifest.json | ✅ present / ❌ missing |
| LICENSE | ✅ present / ❌ missing |
| Versions match | ✅ yes / ❌ no (manifest: X, package: Y) |

### Manual Tests — {type} scope

{For each test case in scope, output as a checklist item:}

**Group A: First Launch & Settings**
- [ ] TC-SET-001: Plugin loads with correct defaults
- [ ] TC-SET-002: Test Connection with invalid token
...

{Continue for all groups with tests in scope}

### Summary

- Automated gates: N/5 passed
- Artifacts: N/5 verified
- Manual tests to complete: N ({type} scope)
```

## Important Notes

- This skill runs commands but does NOT modify any files
- If E2E tests are needed (`npm run test:e2e`), mention it but do not run automatically — they require Obsidian desktop and take significant time
- Reference `docs/qa/release-checklist.md` for the full release process including post-release steps
