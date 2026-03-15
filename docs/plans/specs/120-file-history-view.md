# 120 — File history view via Commits API

**Issue:** #120
**Date:** 2026-03-15
**Status:** APPROVED
**Branch:** feat/120-file-history-view

## Objective

Show commit history for a specific file via GitHub Commits API. User triggers a command — a modal opens listing commits that touched the active file, with pagination.

## API

`GET /repos/{owner}/{repo}/commits?path={repoPath}&sha={branch}&per_page=20&page=N`

Response array:
```json
[{
  "sha": "abc123...",
  "commit": {
    "message": "vault sync: 3 file(s)",
    "author": { "name": "John", "date": "2026-03-15T10:00:00Z" }
  },
  "html_url": "https://github.com/owner/repo/commit/abc123"
}]
```

## Scope

| File | Change |
|------|--------|
| `src/types.ts` | `FileCommitInfo` interface |
| `src/github/client.ts` | `listFileCommits(path, branch, perPage, page)` method |
| `src/ui/file-history-modal.ts` | **New** — `FileHistoryModal` with commit list + pagination |
| `src/main.ts` | Command "Show file history" + `showFileHistory()` |
| `src/github/client.test.ts` | Unit tests for listFileCommits |
| `src/ui/file-history-modal.test.ts` | Modal unit tests |
| `src/main.test.ts` | Command registration test |
| `tests/e2e/specs/ui.spec.mts` | E2E: command exists |
| `docs/qa/manual-test-cases.md` | QA cases |
| `README.md` | Update features |

## Tasks

- [ ] `src/types.ts` — `FileCommitInfo` interface
- [ ] `src/github/client.ts` — `listFileCommits()` method
- [ ] `src/ui/file-history-modal.ts` — `FileHistoryModal` with commit list + Load more pagination
- [ ] `src/main.ts` — command "Show file history" + `showFileHistory()`
- [ ] Unit tests: client, modal, main
- [ ] E2E test
- [ ] QA cases + README

## UI design

- Title: "File history — {filename}"
- Each commit row:
  - Commit message (first line, truncate 80 chars)
  - Author + relative date ("John, 2 days ago")
  - Click → open commit URL in browser
- Empty history → "No commits found for this file"
- Error → Notice + close modal
- "Load more" button at bottom — fetches next page, appends to list
- Button hidden when API returns fewer than perPage results (end of history)

## Pagination

- First request: `per_page=20&page=1`
- "Load more" button loads `page=N+1`
- When API returns < 20 results → hide button (no more pages)
- New commits appended to existing list in modal

## Risks

- **File not yet pushed** — file exists only locally, no commits. Show "No commits found".
- **syncFolder mapping** — vault path must be converted to repo path via `toRepoPath()`.
- **Rate limits** — 1 REST request per page load. Acceptable.

## Out of Scope

- Diff view (commit content)
- Restore file from specific commit

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
