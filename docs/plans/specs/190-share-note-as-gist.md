# 190 — Share Note as Gist

**Issue:** #190
**Date:** 2026-03-24
**Status:** APPROVED
**Branch:** `feat/190-share-note-as-gist`

---

## Objective

Share any note as a GitHub Gist with one command. User chooses public/secret, adds optional description, gets URL copied to clipboard. Shared gists are tracked in a registry — user can view, re-copy URL, update content, or delete gists from within Obsidian.

---

## Scope

| File | Changes |
|------|---------|
| `src/github/client.ts` | Add `createGist()`, `deleteGist()`, `updateGist()`, `listGists()` |
| `src/github/client.test.ts` | Tests for gist methods |
| `src/ui/gist-modal.ts` | New: creation modal (public/secret + description) |
| `src/ui/gist-manager-modal.ts` | New: management modal (list, copy URL, update, delete) |
| `src/ui/gist-modal.test.ts` | Tests for creation modal |
| `src/ui/gist-manager-modal.test.ts` | Tests for manager modal |
| `src/main.ts` | Register commands, gist registry storage |
| `src/main.test.ts` | Tests for commands and registry |
| `src/types.ts` | Add `GistRecord` interface |
| `README.md` | Update: token scopes, new commands, features |

---

## Approach

### Gist API methods (`client.ts`)

```typescript
async createGist(options: {
  filename: string;
  content: string;
  description: string;
  isPublic: boolean;
}): Promise<{ id: string; htmlUrl: string }>

async updateGist(gistId: string, options: {
  filename: string;
  content: string;
  description?: string;
}): Promise<{ id: string; htmlUrl: string }>

async deleteGist(gistId: string): Promise<void>
```

All use existing `post<T>()` pattern with same auth, rate limiter, error handling.

### Gist registry (`types.ts` + `main.ts`)

```typescript
interface GistRecord {
  gistId: string;
  htmlUrl: string;
  isPublic: boolean;
  vaultPath: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}
```

Stored in `plugin.saveData()` under `gistRegistry: Record<string, GistRecord>` (key = vaultPath). Persisted alongside settings and sync state.

### Creation modal (`gist-modal.ts`)

```
┌─ Share as Gist ──────────────────────────┐
│                                          │
│ File: notes/meeting.md                   │
│                                          │
│ Visibility:  (●) Secret  ( ) Public      │
│                                          │
│ Description: [Meeting notes 2026-03    ] │
│                                          │
│              [Cancel]  [Share]            │
└──────────────────────────────────────────┘
```

- Default: secret (safer)
- Description pre-filled with file name (editable)
- On Share: create gist → copy URL → show Notice → save to registry

### Manager modal (`gist-manager-modal.ts`)

```
┌─ Shared Gists (3) ──────────────────────┐
│                                          │
│ 🔒 notes/meeting.md                     │
│    Created: 2026-03-24 14:30             │
│    [Copy URL] [Update] [Delete]          │
│                                          │
│ 🌐 projects/roadmap.md                  │
│    Created: 2026-03-23 10:15             │
│    [Copy URL] [Update] [Delete]          │
│                                          │
│ 🔒 journal/today.md                     │
│    Created: 2026-03-24 09:00             │
│    [Copy URL] [Update] [Delete]          │
│                                          │
│                            [Close]       │
└──────────────────────────────────────────┘
```

- Lists all gists from registry
- Copy URL: `navigator.clipboard.writeText(htmlUrl)` + Notice
- Update: re-read file content from vault → `PATCH /gists/{id}` → update registry timestamp
- Delete: `DELETE /gists/{id}` → remove from registry → Notice

### Commands (`main.ts`)

1. `ghvault-share-gist` — "Share note as Gist" (checkCallback: active .md file + githubClient)
2. `ghvault-manage-gists` — "Manage shared gists" (checkCallback: githubClient configured)

### Clipboard

```typescript
try {
  await navigator.clipboard.writeText(htmlUrl);
  new Notice(`GHVault: Gist URL copied to clipboard`);
} catch {
  new Notice(`GHVault: Gist created — ${htmlUrl}`);
}
```

### Error handling

| Error | Behavior |
|-------|----------|
| 401 Unauthorized | "Check your GitHub token" |
| 403 Forbidden | "Token missing gist scope. Add 'gists' permission to your PAT." |
| 404 on update/delete | Remove stale entry from registry, show notice |
| File >1MB | "File too large for Gist (max 1MB)" |
| Binary file | "Binary files cannot be shared as Gist" |
| Network error | Show error in Notice |

### Token scope

Gist operations require `gist` scope on the PAT. Fine-grained tokens support this. If scope is missing, GitHub returns 403 — we detect and show a helpful message.

---

## Tasks

- [ ] Add `GistRecord` interface to `types.ts`
- [ ] Add `createGist()` to `GitHubClient`
- [ ] Add `updateGist()` to `GitHubClient`
- [ ] Add `deleteGist()` to `GitHubClient`
- [ ] Unit tests for all gist client methods
- [ ] Create `src/ui/gist-modal.ts` — creation modal
- [ ] Create `src/ui/gist-manager-modal.ts` — management modal
- [ ] Unit tests for creation modal
- [ ] Unit tests for manager modal
- [ ] Add gist registry storage in `main.ts` (load/save with plugin data)
- [ ] Register `ghvault-share-gist` command
- [ ] Register `ghvault-manage-gists` command
- [ ] Handle clipboard copy with fallback
- [ ] Handle 403 scope error with helpful message
- [ ] Handle file size >1MB guard
- [ ] Handle binary file guard
- [ ] Update README: token scopes, new commands, features
- [ ] E2E test: share gist command available for active file

---

## Edge Cases

- File >1MB → block with notice before API call
- Binary file → block with notice
- Token without gist scope → 403 → helpful message
- Gist already exists for file → offer "Update existing" in creation modal
- File renamed after sharing → registry key stale, gist still accessible via URL
- File deleted after sharing → manager shows entry, update fails gracefully
- Multiple files shared → registry tracks all
- Plugin reload → registry persisted in data.json

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Token scope confusion | Clear 403 error message + README update |
| Public gist by accident | Default to secret, clear radio button labels |
| Registry grows unbounded | Only tracks actively shared gists, delete removes entry |
| Stale registry entries | Update/delete handle 404 gracefully, remove stale entries |

---

## Out of Scope

- Multi-file gists (one note = one gist)
- Gist comments
- Gist starring/forking
- Automatic gist sync (manual share/update only)
- Public → secret conversion (GitHub API limitation)

---

*Mobilis in Mobili*
