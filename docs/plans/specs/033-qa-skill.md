# QA Skill: Automated Testing Agent (/qa)

**Issue:** #33
**Date:** 2026-03-09
**Status:** APPROVED
**Branch:** feat/33-qa-skill

## Objective

Create a `/qa` skill that launches a dedicated QA agent for comprehensive testing analysis. The agent is a read-only auditor: reads code, runs tests, writes benchmarks, produces a structured report. Never modifies source code.

## Scope

| File | Action |
|------|--------|
| `.claude/commands/qa.md` | New — skill prompt |
| `vitest.config.ts` | Edit — add coverage provider |
| `package.json` | Edit — add `test:coverage` and `test:bench` scripts, install `@vitest/coverage-v8` |

## Approach

### Skill invocation

- `/qa` — full `src/` scope
- `/qa sync` — only `src/sync/**`
- `/qa github utils` — multiple modules

Arguments are resolved to directories: `sync` → `src/sync/**`, `github` → `src/github/**`, `utils` → `src/utils/**`, `ui` → `src/ui/**`.

### 5 directions of analysis

1. **Coverage gaps** — run `vitest --coverage`, cross-reference with source, find untested branches/error paths
2. **Test quality** — mock realism, boundary values, negative cases, assert strength
3. **Performance** — suspicious patterns (O(n²), allocations in loops); reuse existing `*.bench.ts` or create new ones, run `vitest bench`
4. **User scenarios** — model real flows (first sync, conflict, 1000+ files, network loss), verify coverage
5. **E2E integration** — Obsidian API mock layer coverage (onload/onunload, settings, status bar, commands)

### Agent rules

- READ-ONLY for source code — never modifies `src/**/*.ts`
- CAN create/update `*.bench.ts` benchmark files
- CAN run `npm test`, `npm run test:coverage`, `npm run test:bench`
- Produces structured report
- Does NOT fix issues — only reports

### Benchmarks strategy

Agent first checks for existing `*.bench.ts` files in scope. Reuses and extends them. Creates new files only for modules without benchmarks.

## Tasks

- [ ] Install `@vitest/coverage-v8` as devDependency
- [ ] Add `test:coverage` and `test:bench` scripts to `package.json`
- [ ] Configure coverage in `vitest.config.ts`
- [ ] Create `.claude/commands/qa.md` with full agent prompt

## Risks

- Coverage provider may need extra config for Obsidian API mocks
- Benchmarks: agent reuses existing `*.bench.ts` first, creates new only when needed

## Out of Scope

- Playwright / real Obsidian E2E (Phase 2)
- Writing fix code — agent only recommends

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
