# 042 — E2E bidirectional sync test suite (Phase 2)

**Issue:** #83
**Branch:** `test/83-e2e-sync-tests`
**Scope:** infra

---

## Goal

Add E2E tests for bidirectional sync with mocked GitHub API. Tests run in real Obsidian, use real vault I/O, but intercept HTTP calls.

---

## Approach

The SyncEngine is fully wired up when plugin has valid settings. We inject mock GitHub client/graphql into the engine's internal pull/push engines via `executeObsidian`, then call `engine.sync()` and verify real vault state.

**Why E2E for sync (vs unit integration tests we already have)?**
- Unit tests mock the vault adapter — E2E uses real Obsidian Vault API
- Real file creation, path resolution, parent directory handling
- Real `plugin.loadData()`/`plugin.saveData()` persistence
- Real plugin lifecycle (settings → engine rebuild → sync → state save)

**Mock injection pattern:**
```typescript
await browser.executeObsidian(async ({ plugins }) => {
  const plugin = plugins.ghvault as any;
  const engine = plugin.syncEngine;
  // Replace client methods on pull engine
  engine.pullEngine.client = { getRef, getCommit, getTree, getFileContent };
  // Replace graphql on push engine
  engine.pushEngine.graphql = { createCommit };
});
```

---

## Test File

**File:** `tests/e2e/specs/sync.spec.mts`

### Helpers

```typescript
// Configure plugin with test settings and rebuild engine
async function setupSyncEngine(): Promise<void>

// Inject mock GitHub client into pullEngine
async function injectMockClient(remoteFiles, headSha): Promise<void>

// Inject mock GraphQL into pushEngine
async function injectMockGraphQL(oid): Promise<void>

// Pre-populate sync state cache
async function setSyncState(state): Promise<void>

// Read sync state from plugin storage
async function getSyncState(): Promise<SyncState>

// Run sync and return result
async function runSync(): Promise<SyncResult>

// Clean up vault files (except Welcome.md)
async function cleanVaultFiles(): Promise<void>
```

### Test Groups

#### Group 1: Pull — Remote to Vault (4 tests)

```
describe("pull: remote → vault")
  before: setupSyncEngine + injectMockClient + injectMockGraphQL

  it("creates new files from remote in vault")
    → mock remote: ["notes/hello.md", "readme.md"]
    → runSync()
    → obsidianPage.read("notes/hello.md") === "Hello World"
    → obsidianPage.read("readme.md") === "# README"
    → result.pull.created contains both files

  it("modifies existing file from remote")
    → obsidianPage.write("doc.md", "old content")
    → setSyncState with cache entry (old remoteSha)
    → mock remote: doc.md with new sha/content
    → runSync()
    → obsidianPage.read("doc.md") === "new content"
    → result.pull.modified contains "doc.md"

  it("deletes local file removed from remote")
    → obsidianPage.write("deleted.md", "will be deleted")
    → setSyncState with cache entry for deleted.md
    → mock remote: empty tree
    → runSync()
    → vault file should not exist
    → result.pull.deleted contains "deleted.md"

  it("creates parent directories for nested files")
    → mock remote: ["deep/nested/path/file.md"]
    → runSync()
    → obsidianPage.read("deep/nested/path/file.md") === content
```

#### Group 2: Push — Vault to Remote (3 tests)

```
describe("push: vault → remote")
  before: setupSyncEngine + injectMockClient([]) + injectMockGraphQL

  it("pushes new local file to remote")
    → obsidianPage.write("local-new.md", "new stuff")
    → runSync()
    → result.push.pushed contains "local-new.md"
    → verify graphql.createCommit was called (check via flag)

  it("pushes modified local file")
    → obsidianPage.write("doc.md", "modified locally")
    → setSyncState with cache entry (old localContentHash)
    → mock remote: doc.md with same sha as cache
    → runSync()
    → result.push.pushed contains "doc.md"

  it("pushes local deletion")
    → setSyncState with cache entry for "gone.md"
    → mock remote: "gone.md" in tree (same sha as cache)
    → don't create file in vault
    → runSync()
    → result.push.pushed contains "gone.md" (as deletion)
```

#### Group 3: Bidirectional — Pull + Push in Same Cycle (2 tests)

```
describe("bidirectional: pull + push in same cycle")
  it("pulls remote file AND pushes local file")
    → obsidianPage.write("local-only.md", "local content")
    → mock remote: ["remote-only.md"]
    → runSync()
    → obsidianPage.read("remote-only.md") === remote content
    → result.push.pushed contains "local-only.md"

  it("second sync detects no changes (idempotent)")
    → After first sync, runSync() again
    → result.pull = empty, result.push = null
```

#### Group 4: Conflict Detection (2 tests)

```
describe("conflict detection")
  it("detects conflict and skips file in both directions")
    → obsidianPage.write("conflict.md", "local version")
    → setSyncState with cache entry (old hashes)
    → mock remote: conflict.md with different sha
    → runSync()
    → result.conflicts has "conflict.md"
    → obsidianPage.read("conflict.md") === "local version" (unchanged)

  it("syncs non-conflicting files while skipping conflicts")
    → obsidianPage.write("conflict.md", "local") + write("safe.md", "local safe")
    → mock remote: conflict.md (changed) + remote-safe.md (new)
    → runSync()
    → conflict.md in result.conflicts
    → remote-safe.md pulled to vault
    → safe.md pushed
```

#### Group 5: SyncFolder Filtering (2 tests)

```
describe("syncFolder filtering")
  before: set syncFolder = "docs" in plugin settings

  it("pulls only files inside syncFolder with remapped paths")
    → mock remote: ["docs/note.md", "docs/sub/deep.md", "root.md"]
    → runSync()
    → obsidianPage.read("note.md") === content
    → obsidianPage.read("sub/deep.md") === content
    → "root.md" not in vault

  it("pushes local files with syncFolder prefix")
    → obsidianPage.write("note.md", "local note")
    → runSync()
    → verify createCommit additions contain path "docs/note.md"
```

#### Group 6: Sync State Persistence (2 tests)

```
describe("sync state persistence")
  it("headOid persists across plugin reload")
    → runSync()
    → record headOid from state
    → browser.reloadObsidian()
    → getSyncState() → headOid matches

  it("cache entries persist and prevent re-download")
    → runSync() first time (pulls file)
    → browser.reloadObsidian()
    → reinject mocks, runSync() second time
    → result.pull.created = empty (file already cached)
```

---

## Steps

### 1. Create sync spec file

Create `tests/e2e/specs/sync.spec.mts` with all helper functions and test groups.

### 2. Mock injection design

The mocks must work inside Obsidian's runtime (no vitest, no vi.fn). Use plain objects with function properties. For tracking calls (e.g., verifying createCommit was called), use a boolean flag stored on the mock object.

```typescript
// Inside executeObsidian:
const mockGraphql = {
  called: false,
  lastArgs: null as any,
  createCommit: async (opts: any) => {
    mockGraphql.called = true;
    mockGraphql.lastArgs = opts;
    return { oid: "mock-oid-123", url: "https://example.com" };
  },
};
```

### 3. Vault cleanup

Use `obsidianPage.resetVault()` or manual cleanup in afterEach to restore vault to initial state (only Welcome.md).

### 4. Verify all gates

- `npm run test:e2e` — all E2E tests pass
- `npm test` — 363 unit tests pass
- `npm run lint` — clean
- `npm run type-check` — clean
- `npm run build` — succeeds

---

## Files Created/Changed

| File | Change |
|------|--------|
| `tests/e2e/specs/sync.spec.mts` | New — bidirectional sync E2E test suite |

No changes to `src/` files.

---

## Risks

- **Private fields** — accessing pullEngine.client / pushEngine.graphql via `as any`. If field names change, tests break. Acceptable for E2E testing.
- **Hash computation** — real `computeHash` / `computeGitBlobSha` run in Obsidian context (Web Crypto API). Mock client must return SHAs that match what the real hash functions produce, or we mock those too.
- **Vault file listing** — `listFiles()` computes content hashes. After mock injection, the hash computation is real. Tests must account for this.
- **resetVault timing** — may need extra pause after vault reset for Obsidian to index files.

---

## Notes

- Total E2E tests after Phase 2: 20 (Phase 0+1) + 15 (Phase 2) = 35
- The mock approach is the same as integration.test.ts but with real vault I/O
- No network calls, no GitHub PAT needed, fast execution
