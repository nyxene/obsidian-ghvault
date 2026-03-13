# 093 — Binary file support (images, PDFs, attachments)

**Issue:** #93
**Branch:** `feat/93-binary-file-support`
**Scope:** sync, github, utils

---

## Goal

Support syncing binary files (images, PDFs, attachments) between vault and GitHub. Currently binary files are detected and rejected — this change makes them first-class citizens in the sync pipeline.

---

## Research Summary

**Current state:**
- `isBinaryContent()` in pull.ts detects binary via null-byte scan → rejects with error
- Vault adapter uses `vault.read()` (string) — binary data lost on read
- Push reads files as UTF-8 string → binary corruption
- Base64 utils (`bytesToBase64` / `base64ToBytes`) already handle arbitrary bytes
- Files >1.5MB silently dropped on push (no REST fallback)
- GitHub REST API returns all file content as base64 (both text and binary)

**Obsidian API for binary:**
- `vault.readBinary(file): Promise<ArrayBuffer>` — read binary content
- `vault.createBinary(path, data: ArrayBuffer): Promise<TFile>` — create binary file
- `vault.modifyBinary(file, data: ArrayBuffer): Promise<void>` — modify binary file
- These are standard Obsidian API methods, available on both desktop and mobile

**GitHub API for binary:**
- REST Contents API: returns `{ content: "<base64>", encoding: "base64" }` — works for files up to 100MB
- GraphQL `createCommitOnBranch`: `additions` accept `{ contents: "<base64>" }` — works for binary, but 2MB total payload limit
- REST Git Data API (blobs): no size limit per blob, `POST /repos/{owner}/{repo}/git/blobs` with `{ content: "<base64>", encoding: "base64" }`

---

## Design

### Binary detection

Keep existing `isBinaryContent()` null-byte detection, but use it to **route** instead of **reject**:
- Binary → use `readBinary()` / `writeBinary()` path
- Text → use existing `read()` / `write()` string path

### Content model

Introduce a union type for file content:

```typescript
interface TextFileContent {
  type: "text";
  content: string;
}

interface BinaryFileContent {
  type: "binary";
  content: ArrayBuffer;
}

type FileContent = TextFileContent | BinaryFileContent;
```

### Hash computation

Both text and binary files need SHA-256 content hashes and Git blob SHAs:
- Text: existing flow (UTF-8 encode → hash)
- Binary: hash raw `ArrayBuffer` directly

`computeHash()` and `computeGitBlobSha()` in `utils/hash.ts` already accept `ArrayBuffer` via Web Crypto — verify and extend if needed.

---

## Implementation Plan

### Step 1: Vault adapter — binary read/write

**File:** `src/sync/vault-adapter.ts`

Add binary-aware methods:

```typescript
async readFileBinary(path: string): Promise<ArrayBuffer> {
  const file = this.vault.getFileByPath(path);
  if (!file) throw new Error(`File not found: ${path}`);
  return this.vault.readBinary(file);
}

async writeFileBinary(path: string, data: ArrayBuffer): Promise<void> {
  const file = this.vault.getFileByPath(path);
  if (file) {
    await this.vault.modifyBinary(file, data);
  } else {
    await this.ensureDirectoryExists(path);
    await this.vault.createBinary(path, data);
  }
}
```

Update `listFiles()` to include binary files:
- Use `vault.readBinary()` for all files, compute hash from raw bytes
- Or: keep `vault.cachedRead()` for text, detect binary via `isBinaryContent()`, switch to `readBinary()`

### Step 2: Base64 utils — ArrayBuffer support

**File:** `src/utils/base64.ts`

Add functions for ArrayBuffer ↔ base64:

```typescript
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bytes = base64ToBytes(base64);
  return bytes.buffer;
}
```

`bytesToBase64()` and `base64ToBytes()` already exist and handle arbitrary bytes.

### Step 3: Pull — binary file support

**File:** `src/sync/pull.ts`

Change `isBinaryContent()` from reject to route:

```
Before: if (isBinaryContent(rawBytes)) → skip with error
After:  if (isBinaryContent(rawBytes)) → vault.writeFileBinary(path, rawBytes.buffer)
        else → vault.writeFile(path, textDecoder.decode(rawBytes))
```

Hash computation stays the same — `computeGitBlobSha()` already works with `Uint8Array`.

### Step 4: Push — binary file support

**File:** `src/sync/push.ts`

For each file to push:
1. Try `vault.readFile(path)` (string) first
2. Check if content is binary via `isBinaryContent()`
3. If binary: read via `vault.readFileBinary(path)`, encode with `arrayBufferToBase64()`
4. If text: existing string → `toBase64()` flow

Alternative approach (simpler): always read as binary via `readFileBinary()`, detect binary, then decode to string for text files. This avoids double-reading.

### Step 5: Large file REST fallback (>1.5MB)

**File:** `src/github/graphql.ts` or new `src/github/rest-push.ts`

For files exceeding `MAX_GRAPHQL_FILE_SIZE` (1.5MB), use REST Git Data API:

1. Create blob: `POST /repos/{owner}/{repo}/git/blobs` with `{ content, encoding: "base64" }`
2. Create tree: `POST /repos/{owner}/{repo}/git/trees` with blob SHAs
3. Create commit: `POST /repos/{owner}/{repo}/git/commits`
4. Update ref: `PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}`

This is the only way to push files >1.5MB (GraphQL has ~2MB payload limit).

**Decision:** implement in `client.ts` as new methods (`createBlob`, `createTree`, `createCommit`, `updateRef`), then use from `push.ts` as a fallback path.

### Step 6: Comparator — binary hash support

**File:** `src/sync/comparator.ts`

`LocalFileInfo` currently stores `contentHash: string`. This stays the same — hash is always a hex string regardless of text/binary source. No changes needed if hash computation handles both.

### Step 7: Tests

- Unit tests for binary read/write in vault adapter
- Unit tests for `arrayBufferToBase64` / `base64ToArrayBuffer`
- Unit tests for pull with binary content (mock binary response)
- Unit tests for push with binary content
- Unit test for large file REST fallback
- Integration test: binary file round-trip (push → pull → compare)

---

## Files Changed

| File | Change |
|------|--------|
| `src/sync/vault-adapter.ts` | Add `readFileBinary()`, `writeFileBinary()`, update `listFiles()` |
| `src/utils/base64.ts` | Add `arrayBufferToBase64()`, `base64ToArrayBuffer()` |
| `src/sync/pull.ts` | Route binary to `writeFileBinary()` instead of rejecting |
| `src/sync/push.ts` | Read binary files, encode for push |
| `src/github/client.ts` | Add `createBlob()`, `createTree()`, `createCommit()`, `updateRef()` for REST fallback |
| `src/sync/engine.ts` | Wire REST fallback for large files in push path |
| `src/types.ts` | Add `FileContent` type if needed |
| `src/utils/hash.ts` | Verify ArrayBuffer support, extend if needed |

No changes to excluded patterns — binary files are synced, not excluded.

---

## Edge Cases

1. **Empty binary file** — 0 bytes, should sync normally
2. **File that looks binary but is text** (e.g., UTF-16 with BOM containing null bytes) — accepted as binary, works but loses "text" treatment
3. **File >50MB** — existing skip guard, unchanged
4. **File >1.5MB but <50MB** — REST fallback path
5. **Binary file renamed** — treated as delete + create (existing behavior)
6. **Corrupted base64 from GitHub** — existing error handling in `decodeBase64ToBytes()`

---

## Notes

- This is the single biggest UX gap for v0.1.0 — users expect images to sync
- REST Git Data API fallback is needed regardless of binary support (also benefits large text files)
- Mobile compatibility: `vault.readBinary()` / `vault.createBinary()` work on iOS and Android
- No new dependencies required
