# 180 — ETag Conditional Requests on Polling

**Issue:** #180
**Date:** 2026-03-22
**Status:** APPROVED
**Branch:** `feat/180-etag-conditional-requests`

---

## Objective

Use HTTP ETag / `If-None-Match` headers on the pull-check polling request (`getRef`) to get 304 Not Modified responses when the remote branch hasn't changed. GitHub does not count 304 responses against the REST rate limit, making poll checks essentially free when no changes occur.

---

## Background

### Current behavior

`pullCheckTick()` calls `getRef(branch)` on every tick (default 300s, adaptive backoff up to ×8). Each call costs 1 REST API call from the 5000/hour budget. With min interval 30s = 120 calls/hour = 2.4% of the budget. In practice, with backoff, much less — but still unnecessary when nothing changed.

### GitHub API ETag behavior

- Every GET response includes an `ETag` header (e.g., `"abc123"`)
- Sending `If-None-Match: "abc123"` on the next request → **304 Not Modified** if unchanged
- 304 responses **do not** count against the rate limit (confirmed in GitHub docs)
- 304 responses return no body, only headers

### Obsidian `requestUrl` behavior with 304

Obsidian's `requestUrl` throws an error for non-2xx status codes (including 304). The error object has a `status` property. We need to catch this and handle 304 as a special case, not a real error.

---

## Scope

| File | Changes |
|------|---------|
| `src/github/client.ts` | Add ETag cache, `If-None-Match` header, 304 handling in `request()` method; new `getRefConditional()` method |
| `src/github/client.test.ts` | Tests for ETag caching, 304 handling, cache miss/invalidation |
| `src/main.ts` | Use `getRefConditional()` in `pullCheckTick()` |
| `src/main.test.ts` | Update pull check tests to use new method |

---

## Approach

### ETag cache

In-memory `Map<string, { etag: string; data: T }>` inside `GitHubClient`:

```typescript
private readonly etagCache = new Map<string, { etag: string; data: unknown }>();
```

- Key: request URL path (e.g., `/repos/owner/repo/git/ref/heads/main`)
- Value: last ETag + last parsed JSON response
- No persistence needed — rebuilt naturally on plugin reload
- No TTL — ETag validity is determined by the server

### Modified `request()` flow

1. Check `etagCache` for the URL path
2. If cached → add `If-None-Match: "<etag>"` to request headers
3. Execute request
4. If **304**: return cached data, update rate limiter from headers (304 still has rate limit headers)
5. If **200**: store new ETag + data in cache, return data
6. If **error**: throw as before (remove `handleRequestError` for 304 from the error path)

### Catching 304 in Obsidian's requestUrl

`requestUrl` throws for 304. We catch it and check `status`:

```typescript
try {
  response = await requestWithTimeout({ ... });
} catch (error: unknown) {
  const status = (error as { status?: number }).status;
  if (status === 304 && cached) {
    // Update rate limiter from error headers (304 still sends them)
    const headers = (error as { headers?: Record<string, string> }).headers;
    if (headers) this.rateLimiter.updateFromHeaders(headers);
    return cached.data as T;
  }
  throw this.handleRequestError(error, path);
}
```

### New `getRefConditional()` method

Not strictly needed — the ETag logic lives in `request()` and works transparently for all GET calls. However, adding a dedicated method makes the intent explicit in `pullCheckTick()` and allows for future optimization (e.g., returning a `{ changed: boolean; ref: GitHubRef }` result).

**Decision: no separate method.** ETag caching is transparent inside `request()`. All GET requests automatically benefit. `pullCheckTick()` continues calling `getRef()` unchanged.

### What about other GET requests?

ETag caching is generic in `request()`, so `getTree()`, `getFileContent()`, `getCommit()`, etc. also benefit. But in practice:
- `getRef()` is the only repeatedly-polled endpoint → biggest savings
- Other GET calls happen once per sync cycle with different params → cache hit unlikely
- No downside to caching them — cache entries are tiny and get evicted naturally

### Cache size

Bounded naturally: one entry per unique URL path. In practice, very few entries (getRef → 1, maybe getRepoInfo → 1). No eviction policy needed.

---

## Tasks

- [ ] Add `etagCache` field to `GitHubClient`
- [ ] Modify `request()` — send `If-None-Match` when cached, handle 304 response
- [ ] Handle Obsidian `requestUrl` throwing on 304 — catch, check status, return cached data
- [ ] Update rate limiter from 304 response headers
- [ ] Unit tests: first request → no `If-None-Match`, response cached with ETag
- [ ] Unit tests: second request → sends `If-None-Match`, 304 → returns cached data
- [ ] Unit tests: second request → sends `If-None-Match`, 200 (changed) → updates cache
- [ ] Unit tests: rate limiter updated on 304
- [ ] Unit tests: non-304 error still throws correctly
- [ ] Unit tests: cache miss (different URL) → normal request
- [ ] Verify `pullCheckTick()` works unchanged (integration-level in main.test.ts)

---

## Edge Cases

- First request (no cache) → normal GET, store ETag + response
- 304 with updated rate limit headers → rate limiter updated, cached data returned
- ETag not present in response headers → skip caching for that request
- Server returns 200 with new ETag after a period of 304s → cache updated
- Plugin reload → cache empty, first request rebuilds it
- Different branches polled → separate cache entries (different URL paths)
- `requestUrl` throws 304 without headers → return cached data, skip rate limiter update

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Obsidian `requestUrl` 304 behavior changes | Defensive: only treat as 304 when both `status === 304` and cache exists |
| Stale cache data | ETag is server-validated — if server says 304, data is guaranteed unchanged |
| Memory growth | Bounded by unique URL paths (< 10 in practice), no concern |

---

## Out of Scope

- `Last-Modified` / `If-Modified-Since` (ETag is more precise and sufficient)
- Conditional requests for POST/PUT/PATCH operations
- Cache persistence across plugin reloads
- ETag for GraphQL requests (GitHub GraphQL doesn't support conditional requests)

---

*Mobilis in Mobili*
