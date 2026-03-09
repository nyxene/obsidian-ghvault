# Migrate Custom Commands to Skills Format

**Issue:** #35
**Date:** 2026-03-10
**Status:** APPROVED
**Branch:** feat/35-migrate-commands-to-skills

## Objective

Migrate `/qa` and `/owasp-audit` from legacy `.claude/commands/` to `.claude/skills/` format with YAML frontmatter.

## Scope

| Action | Path |
|--------|------|
| Delete | `.claude/commands/qa.md` |
| Delete | `.claude/commands/owasp-audit.md` |
| New | `.claude/skills/qa/SKILL.md` |
| New | `.claude/skills/owasp-audit/SKILL.md` |

## Approach

Move prompt content 1:1 into `SKILL.md` files. Add YAML frontmatter with description, argument-hint, and disable-model-invocation where appropriate.

## Tasks

- [ ] Create `.claude/skills/qa/SKILL.md` with frontmatter + qa prompt
- [ ] Create `.claude/skills/owasp-audit/SKILL.md` with frontmatter + owasp prompt
- [ ] Delete `.claude/commands/qa.md`
- [ ] Delete `.claude/commands/owasp-audit.md`
- [ ] Verify both skills appear in skill list

## Risks

None. Straightforward 1:1 migration.

## Out of Scope

- Splitting into supporting files
- New skills

---
*Approved by: the Aronnax*
*Mobilis in Mobili*