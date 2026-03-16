# 122 — ZIP download optimization for full-repo sync

**Issue:** #122
**Date:** 2026-03-16
**Status:** APPROVED
**Branch:** feat/122-zip-download-optimization

## Objective

When syncFolder is empty (syncing entire repo), use GitHub's zipball endpoint instead of per-file Contents API downloads. Reduces API calls from N+1 to 2 (getTree + zipball).

## When to use ZIP

| Condition | Pull strategy |
|-----------|---------------|
| `syncFolder !== ""` | Per-file (ZIP contains entire repo) |
| `downloads.length <= 5` | Per-file (ZIP overhead not justified) |
| `totalDownloadSize > 100MB` | Per-file (memory safety) |
| `syncFolder === ""` AND `downloads.length > 5` AND `size <= 100MB` | ZIP |

## API

`GET /repos/{owner}/{repo}/zipball/{ref}` → 302 redirect → ZIP binary.

ZIP structure: `{owner}-{repo}-{shortsha}/path/to/file.md` — all files under one root directory.

## Approach

### GitHubClient.downloadZipball(ref)

Returns `ArrayBuffer`. Uses `requestUrl()` which follows redirects automatically.

### parseZipEntries(buffer, callback)

Using `fflate` library. Entry-by-entry processing — extract one file, pass to callback, release memory, next file. NOT loading all entries into a Map.

```typescript
async function processZipEntries(
  zipBuffer: ArrayBuffer,
  onEntry: (path: string, data: Uint8Array) => Promise<void>,
): Promise<void>
```

### PullEngine changes

After computing download list, check conditions:
1. `syncFolder === ""`
2. `downloads.length > 5`
3. `totalDownloadSize <= 100MB` (sum of tree entry sizes)

If all met → ZIP path:
1. Download zipball
2. Process entries: strip root dir prefix, skip excluded patterns, match against download list
3. For each matching entry: SHA integrity check, write to vault, update cache
4. If ZIP download/parse fails → log warning, fallback to per-file

### Safety

- **Size threshold**: 100MB max for ZIP strategy
- **Entry-by-entry**: no full Map in memory
- **Fallback**: any ZIP error → per-file download
- **Progress**: logger.info for download start/complete

## Scope

| File | Change |
|------|--------|
| `package.json` | Add `fflate` dependency |
| `src/github/client.ts` | `downloadZipball(ref)` method |
| `src/utils/zip.ts` | **New** — `processZipEntries()` using fflate |
| `src/sync/pull.ts` | ZIP pull path with threshold + fallback |
| Tests | client, zip, pull, integration, E2E |
| `docs/qa/manual-test-cases.md` | QA cases |
| `README.md` | Update API usage / performance section |

## Tasks

- [ ] Add `fflate` dependency
- [ ] `src/github/client.ts` — `downloadZipball(ref)`
- [ ] `src/utils/zip.ts` — `processZipEntries()` with fflate
- [ ] `src/sync/pull.ts` — ZIP pull path with threshold, size check, fallback
- [ ] Unit tests: client, zip parser, pull
- [ ] Integration tests
- [ ] E2E test
- [ ] QA cases + README

## Risks

- **Memory**: mitigated by 100MB size limit + entry-by-entry processing
- **ZIP root dir**: GitHub adds `{owner}-{repo}-{shortsha}/` prefix — strip first path segment
- **fflate bundle size**: ~8kb gzipped, acceptable
- **Binary files**: extracted as raw bytes, same handling as per-file pull

## Out of Scope

- Streaming ZIP extraction (entry-by-entry is sufficient)
- ZIP for subfolder sync (API doesn't support it)
- Caching ZIP across syncs
- Progress bar UI (logger only)

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
