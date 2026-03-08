# GitHub REST client and rate limiter

**Issue:** #5
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** feat/5-github-rest-client

## Objective
Create a low-level GitHub REST API wrapper via requestUrl() and a rate limit tracker.

## Scope
- `src/github/rate-limit.ts` + tests
- `src/github/client.ts` + tests

## Approach
RateLimiter parses x-ratelimit-* headers, tracks REST and GraphQL limits separately. GitHubClient wraps all REST endpoints needed for pull/first-sync, maps HTTP errors to typed error classes.

## Tasks
- [ ] `src/github/rate-limit.ts` + `src/github/rate-limit.test.ts`
- [ ] `src/github/client.ts` + `src/github/client.test.ts`
- [ ] All checks pass (lint, type-check, test, build)

## Risks
- requestUrl() needs to be mocked in tests
- Binary content header: application/vnd.github.raw (not raw+json)

## Out of Scope
- GraphQL mutations (separate issue)

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
