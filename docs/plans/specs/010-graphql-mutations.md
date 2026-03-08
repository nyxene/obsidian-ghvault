# GraphQL mutations: createCommitOnBranch with chunking

**Issue:** #10
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** feat/10-graphql-mutations

## Objective
Create a GraphQL wrapper for push operations via createCommitOnBranch mutation with automatic chunking when exceeding the 2MB payload limit.

## Scope
- `src/github/graphql.ts`
- `src/github/graphql.test.ts`

## Approach
Single public method createCommit() that auto-chunks additions into ≤2MB batches. Sequential commits when chunking, each using previous commit's OID. Deletions in first chunk only. REST fallback for >1.5MB files is out of scope (TODO).

## Tasks
- [ ] `src/github/graphql.ts` — GitHubGraphQL class with chunking
- [ ] `src/github/graphql.test.ts` — single batch, multi-batch, deletions-only, errors
- [ ] All checks pass (lint, type-check, test, build)

## Risks
- Files >1.5MB need REST fallback (separate issue, TODO comment for now)
- Sequential commits during chunking create noisy history (acceptable for MVP)

## Out of Scope
- REST Git Data API fallback for large files
- Retry on HEAD mismatch (SyncEngine responsibility)

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
