# Core types and utility modules

**Issue:** #3
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** feat/3-core-types-utils

## Objective
Create the foundation layer: all TypeScript types/interfaces and utility modules that github/, sync/, and UI layers depend on.

## Scope
- `src/types.ts`
- `src/utils/hash.ts` + test
- `src/utils/base64.ts` + test
- `src/utils/path.ts` + test
- `src/utils/logger.ts` + test

## Approach
Single types file with all interfaces, error classes, and constants. Each utility module is small, focused, and independently testable. Logger writes JSON lines via vault.adapter.append().

## Tasks
- [ ] `src/types.ts` — interfaces, error classes, constants
- [ ] `src/utils/hash.ts` + `src/utils/hash.test.ts`
- [ ] `src/utils/base64.ts` + `src/utils/base64.test.ts`
- [ ] `src/utils/path.ts` + `src/utils/path.test.ts`
- [ ] `src/utils/logger.ts` + `src/utils/logger.test.ts`
- [ ] All checks pass (lint, type-check, test, build)

## Risks
- Logger uses vault.adapter — tests need mock
- crypto.subtle available in all target environments (confirmed)

## Out of Scope
- GitHub client
- Sync engine

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
