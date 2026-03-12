# 089 — Release QA skill and public issue templates

**Issue:** #89
**Branch:** `docs/89-release-qa-skill-templates`
**Scope:** infra

---

## Goal

Replace the release-qa issue template with a `/release-qa` skill for AI-assisted release validation. Add public bug report and feature request templates for when the repo goes public.

---

## Deliverables

### 1. Delete release-qa issue template

Remove `.github/ISSUE_TEMPLATE/release-qa.md` — redundant for single-developer workflow.

Update `docs/qa/release-checklist.md` "How to use" section to remove the reference to the deleted template.

### 2. `/release-qa` skill (`.claude/skills/release-qa/SKILL.md`)

A skill that runs automated release checks and outputs a manual test checklist.

**Input:** `$ARGUMENTS` = release type (`patch`, `minor`, `major`). Default: `patch`.

**Behavior:**

1. **Automated gates** — run each and report pass/fail:
   - `npm run lint`
   - `npm run type-check`
   - `npm test`
   - `npm run build`
   - `npm run check:obsidian`

2. **Artifact verification** — check that these files exist and are consistent:
   - `manifest.json` and `package.json` versions match
   - `main.js`, `styles.css`, `manifest.json`, `LICENSE` present

3. **Manual test checklist** — output the relevant test cases from `docs/qa/manual-test-cases.md`:
   - `patch`: P0 tests only (21 tests)
   - `minor`: P0 + P1 tests (37 tests)
   - `major`: P0 + P1 + P2 tests (40 tests)

**Output format:**

```
## Release QA — {type}

### Automated Gates
| Gate | Status |
|------|--------|
| lint | ✅ PASS / ❌ FAIL |
| ...  | ... |

### Artifacts
| File | Status |
|------|--------|
| main.js | ✅ present |
| ...     | ... |

### Manual Tests ({type} scope: P0 / P0+P1 / P0+P1+P2)
Copy the checklist below and verify each test:

- [ ] TC-SET-001: ...
- [ ] TC-SET-002: ...
...
```

### 3. Bug report template (`.github/ISSUE_TEMPLATE/bug-report.yml`)

YAML form-based template for external users.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Description | textarea | yes | What happened? |
| Steps to reproduce | textarea | yes | Numbered steps |
| Expected behavior | textarea | yes | What should have happened |
| Actual behavior | textarea | yes | What actually happened |
| Platform | dropdown | yes | Desktop / Mobile |
| OS | dropdown | yes | macOS / Windows / Linux / iOS / Android |
| Obsidian version | input | yes | e.g. 1.5.3 |
| Plugin version | input | yes | e.g. 0.1.0 |
| Logs | textarea | no | From ghvault.log (Settings → Log Level: debug) |
| Screenshots | textarea | no | If applicable |

**Labels:** `bug`

### 4. Feature request template (`.github/ISSUE_TEMPLATE/feature-request.yml`)

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Description | textarea | yes | What would you like? |
| Use case | textarea | yes | Why do you need this? |
| Alternatives | textarea | no | Have you tried any workarounds? |

**Labels:** `enhancement`

### 5. Config (`.github/ISSUE_TEMPLATE/config.yml`)

```yaml
blank_issues_enabled: false
```

Disable blank issues — force users to pick a template.

---

## Files

| Action | File |
|--------|------|
| Delete | `.github/ISSUE_TEMPLATE/release-qa.md` |
| Edit | `docs/qa/release-checklist.md` |
| Create | `.claude/skills/release-qa/SKILL.md` |
| Create | `.github/ISSUE_TEMPLATE/bug-report.yml` |
| Create | `.github/ISSUE_TEMPLATE/feature-request.yml` |
| Create | `.github/ISSUE_TEMPLATE/config.yml` |

No changes to `src/` files.
