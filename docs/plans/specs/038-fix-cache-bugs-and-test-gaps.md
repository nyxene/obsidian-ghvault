# 038 — Fix cache integrity bugs and test gaps

**Issues:** #71, #72, #73, #74
**Branch:** `fix/71-cache-integrity-and-test-gaps`
**Scope:** sync, utils

---

## Problem

Two cache integrity bugs cause spurious sync operations:

1. **#71 — `localContentHash` empty after pull.** `pull.ts:214` sets `localContentHash: ""` after downloading a file. On next sync, `computeLocalChanges()` compares the local file hash against `""` → always differs → file gets pushed back to GitHub unnecessarily.

2. **#72 — `remoteSha` empty after push.** `push.ts:130` sets `remoteSha: ""` after pushing. Mitigated by `updateCacheFromCommit()` in `engine.ts:110`, but creates fragile coupling. If `updateCacheFromCommit` fails or is skipped, next pull re-downloads everything.

Additionally, test coverage gaps exist for edge cases in pull/push (#73) and user scenarios (#74).

---

## Fix Plan

### Bug #71 — Compute `localContentHash` after pull download

**File:** `src/sync/pull.ts`

In the download handler (line ~209-219), after decoding content and before writing to vault:

```
const content = new TextDecoder().decode(rawBytes);
const contentHash = await computeHash(content);  // ← ADD
await this.vault.writeFile(change.path, content);

const entry: SHACacheEntry = {
    remoteSha: file.sha,
    localContentHash: contentHash,  // ← WAS ""
    ...
};
```

**Import:** `computeHash` from `../utils/hash` (already imports `computeGitBlobSha` from there).

### Bug #72 — Compute `remoteSha` after push

**File:** `src/sync/push.ts`

Before creating the commit, compute git blob SHA for each file being pushed:

```
const bytes = new TextEncoder().encode(content);
const blobSha = await computeGitBlobSha(bytes);
// Store alongside contentHash
contentHashes.set(change.path, { hash, size: contentSize, blobSha });
```

Then in cache update (line ~129-135):

```
this.state.setSHA(path, {
    remoteSha: info?.blobSha ?? "",  // ← WAS always ""
    localContentHash: info?.hash ?? "",
    ...
});
```

**Import:** `computeGitBlobSha` from `../utils/hash`.

**Bonus:** Replace local `encodeToBase64()` with `toBase64()` from `../utils/base64` (identical logic, removes duplication).

### Test fixes — #73

**File:** `src/sync/pull.test.ts` — add:
- Test: pulled file has correct `localContentHash` in cache
- Test: `isBinaryContent()` with null-byte data → skip
- Test: `decodeBase64ToBytes()` with invalid base64 → throw

**File:** `src/sync/push.test.ts` — add:
- Test: pushed file has correct `remoteSha` (git blob SHA) in cache
- Test: `sizeHint` pre-check skips oversized file without reading content

### Test fixes — #74

**File:** `src/sync/integration.test.ts`:
- Remove manual `localContentHash` patch (line ~593) — should work natively now
- Add: network failure mid-pull (one file fails, others succeed, partial result)
- Add: rate limit error propagates through full sync cycle

**File:** `src/sync/pull.test.ts`:
- Add: pull with 0 downloads + only deletes (no HTTP needed)

---

## Files Changed

| File | Change |
|------|--------|
| `src/sync/pull.ts` | Add `computeHash()` call, import |
| `src/sync/push.ts` | Add `computeGitBlobSha()` call, replace local base64 with import |
| `src/sync/pull.test.ts` | 3-4 new tests |
| `src/sync/push.test.ts` | 2 new tests |
| `src/sync/integration.test.ts` | Remove workaround, 2 new tests |

No new files. No changes to types or interfaces.

---

## Verification

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

All four gates must pass.
