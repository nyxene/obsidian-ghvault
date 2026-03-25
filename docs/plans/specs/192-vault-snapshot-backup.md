# 192 — Vault Snapshot via Releases API

**Issue:** #192
**Date:** 2026-03-24
**Status:** APPROVED
**Branch:** `feat/192-vault-snapshot-backup`

---

## Objective

One-click vault backup to GitHub Releases. Creates a ZIP archive of all synced files and uploads it as a release asset. Users can view, restore, or delete backups from within Obsidian.

---

## Background

### Why Releases API?

- GitHub Releases support up to 2GB assets
- Releases are visible in GitHub Web UI — user can download manually
- Tagged and timestamped — easy to identify
- No special token scope needed — `Contents: Read/Write` covers it
- ZIP creation via `fflate.zipSync()` — already a dependency

### What gets backed up?

Same files as sync — everything in vault **except**:
- `.obsidian/` — device-specific config
- `.trash/` — Obsidian trash
- `ghvault.log` — plugin log
- Custom exclude patterns
- Files with `ghvault-sync: false` frontmatter

---

## Scope

| File | Changes |
|------|---------|
| `src/github/client.ts` | Add `createRelease()`, `uploadReleaseAsset()`, `listReleases()`, `deleteRelease()`, `downloadReleaseAsset()` |
| `src/github/client.test.ts` | Tests for release methods |
| `src/ui/backup-modal.ts` | New: backup manager modal (list, restore, delete) |
| `src/ui/backup-modal.test.ts` | Tests for backup modal |
| `src/main.ts` | Register commands, ribbon button, backup/restore logic |
| `src/main.test.ts` | Tests for commands and backup flow |
| `src/utils/zip.ts` | Add `createZipFromFiles()` function |
| `src/utils/zip.test.ts` | Tests for ZIP creation |
| `src/types.ts` | Add `BackupRecord` interface |
| `README.md` | Update: backup feature, manual restore instructions |
| `docs/qa/manual-test-cases.md` | New test cases |

---

## Approach

### GitHub Release methods (`client.ts`)

```typescript
async createRelease(options: {
  tagName: string;
  name: string;
  body: string;
}): Promise<{ id: number; htmlUrl: string; uploadUrl: string }>

async uploadReleaseAsset(
  uploadUrl: string,
  filename: string,
  data: ArrayBuffer,
): Promise<{ downloadUrl: string; size: number }>

async listReleases(perPage?: number): Promise<Array<{
  id: number;
  tagName: string;
  name: string;
  createdAt: string;
  htmlUrl: string;
  assets: Array<{ name: string; size: number; downloadUrl: string }>;
}>>

async deleteRelease(releaseId: number): Promise<void>

async downloadReleaseAsset(downloadUrl: string): Promise<ArrayBuffer>
```

### ZIP creation (`utils/zip.ts`)

```typescript
async function createZipFromFiles(
  vault: Vault,
  files: TFile[],
): Promise<{ data: ArrayBuffer; fileCount: number; totalSize: number }>
```

Uses `fflate.zipSync()` — reads all files as binary, builds ZIP in memory.

**Size guard:** If total uncompressed size > 500MB, abort with error notice. Prevents mobile crashes.

### Backup flow

1. User clicks ribbon button or runs command
2. Read all vault files (filtered by excludes)
3. Check total size (<500MB guard)
4. Create ZIP via `zipSync()`
5. `POST /repos/{owner}/{repo}/releases` — create release with tag `backup-YYYY-MM-DD-HHmmss`
6. Upload ZIP as release asset
7. Notice: "Backup created — N files, X MB" + URL copied to clipboard

### Restore flow

1. User opens backup manager → selects a backup → clicks "Restore"
2. Confirmation modal: "This will overwrite all current vault files with the backup from [date]. Continue?"
3. Download ZIP asset from release
4. Extract all files via existing `processZipEntries()`
5. For each file: write to vault (overwrite existing, create missing)
6. Delete files that exist locally but not in backup (optional — ask user)
7. Notice: "Vault restored from backup [date] — N files"

### Backup manager modal (`backup-modal.ts`)

```
┌─ Vault Backups ──────────────────────────┐
│                                          │
│ 📦 backup-2026-03-24-1430               │
│    Mar 24, 2026 14:30 — 47 files, 2.3MB │
│    [Copy URL] [Restore] [Delete]         │
│                                          │
│ 📦 backup-2026-03-23-0900               │
│    Mar 23, 2026 09:00 — 45 files, 2.1MB │
│    [Copy URL] [Restore] [Delete]         │
│                                          │
│                            [Close]       │
└──────────────────────────────────────────┘
```

- Lists releases with tag prefix `backup-`
- Shows date, file count, compressed size
- Buttons: Copy URL (release page), Restore, Delete

### Restore confirmation

```
┌─ Restore Backup ─────────────────────────┐
│                                          │
│ ⚠️ This will overwrite all current vault │
│ files with the backup from:              │
│                                          │
│   Mar 24, 2026 14:30 (47 files, 2.3MB)  │
│                                          │
│ Current files not in backup will be kept.│
│                                          │
│              [Cancel]  [Restore]         │
└──────────────────────────────────────────┘
```

### Tag naming

`backup-YYYY-MM-DD-HHmmss` (UTC) — e.g., `backup-2026-03-24-143022`

Ensures uniqueness and sortability.

### Commands and ribbon

- Ribbon: `archive` icon → "GHVault: Backup vault"
- Command: `ghvault-backup-vault` → create backup
- Command: `ghvault-manage-backups` → open manager
- Ribbon: `history` icon → "GHVault: Manage backups"

---

## Tasks

- [ ] Add `BackupRecord` interface to `types.ts`
- [ ] Add `createRelease()` to `GitHubClient`
- [ ] Add `uploadReleaseAsset()` to `GitHubClient`
- [ ] Add `listReleases()` to `GitHubClient`
- [ ] Add `deleteRelease()` to `GitHubClient`
- [ ] Add `downloadReleaseAsset()` to `GitHubClient`
- [ ] Unit tests for all release methods
- [ ] Add `createZipFromFiles()` to `utils/zip.ts`
- [ ] Unit tests for ZIP creation
- [ ] Create `src/ui/backup-modal.ts` — backup manager
- [ ] Unit tests for backup modal
- [ ] Register backup/manage commands in `main.ts`
- [ ] Add ribbon buttons for backup and manage
- [ ] Implement backup flow (ZIP → release → upload)
- [ ] Implement restore flow (download → extract → write)
- [ ] Restore confirmation dialog
- [ ] Size guard (500MB)
- [ ] Update README: backup feature + manual restore
- [ ] Manual QA test cases
- [ ] E2E tests for backup commands

---

## Edge Cases

- Empty vault → create backup with 0 files (valid empty ZIP)
- Vault >500MB → abort with notice "Vault too large for backup (max 500MB)"
- Upload fails mid-stream → release created but no asset; delete orphan release
- Restore with file not in vault → create new file
- Restore over existing file → overwrite
- Restore on mobile → same flow (requestUrl handles binary)
- Multiple rapid backup clicks → disable button during backup
- Release tag already exists (unlikely with timestamp) → append counter
- Network error during restore → partial state; show error with count of restored files
- Release deleted from GitHub Web UI → listReleases returns updated list

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Large vault ZIP exhausts memory | 500MB size guard; abort before ZIP creation |
| Upload timeout for large files | 30s timeout may be too short; consider 120s for uploads |
| Restore overwrites user work | Confirmation dialog with clear warning |
| Mobile memory limits | Same 500MB guard; fflate is memory-efficient |

---

## Out of Scope

- Selective restore (diff-based, file picker) — vNext
- Automatic scheduled backups
- Backup retention policy (auto-delete old)
- Incremental backups (only changed files)
- Backup encryption

---

*Mobilis in Mobili*
