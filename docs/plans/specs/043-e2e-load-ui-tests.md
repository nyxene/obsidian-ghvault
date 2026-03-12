# 043 — E2E load & UI interaction test suite (Phase 3)

**Issue:** #85
**Branch:** `test/85-e2e-load-ui-tests`
**Scope:** infra

---

## Goal

Add E2E tests for UI interactions (ribbon icon, command palette, status bar, notices) and sync guards (no settings, concurrent sync, cooldown). Also add a load test verifying sync with 50+ files.

---

## Approach

Tests exercise real Obsidian UI elements and plugin lifecycle. Mock injection is the same as Phase 2. Notice detection uses DOM observation — Obsidian renders notices as `.notice` elements inside `.notice-container`.

**Notice tracking pattern:**
```typescript
// Start collecting notices via MutationObserver
await browser.execute(() => {
  (window as any).__ghvaultNotices = [];
  const container = document.body;
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLElement && node.classList.contains("notice")) {
          (window as any).__ghvaultNotices.push(node.textContent || "");
        }
      }
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  (window as any).__ghvaultNoticeObserver = observer;
});

// Read collected notices
const notices: string[] = await browser.execute(() => {
  return (window as any).__ghvaultNotices || [];
});

// Cleanup
await browser.execute(() => {
  (window as any).__ghvaultNoticeObserver?.disconnect();
  delete (window as any).__ghvaultNotices;
  delete (window as any).__ghvaultNoticeObserver;
});
```

**Status bar selector:** `.mod-status-bar .status-bar-item` — filter by text content starting with "GHVault:".

---

## Test File

**File:** `tests/e2e/specs/ui.spec.mts`

### Helpers

```typescript
// Start MutationObserver for notice tracking
async function startNoticeCollector(): Promise<void>

// Get collected notices, optionally filter by prefix
async function getNotices(prefix?: string): Promise<string[]>

// Stop observer and clean up
async function stopNoticeCollector(): Promise<void>

// Get status bar text for GHVault
async function getStatusBarText(): Promise<string>

// Configure plugin with valid settings and reload (reuses pattern from sync tests)
async function setupSyncEngine(): Promise<void>

// Inject mock client/graphql that returns empty remote (no changes)
async function injectEmptyMocks(): Promise<void>

// Inject mock client/graphql with N files for load testing
async function injectMockWithFiles(count: number): Promise<void>

// Reset plugin to empty settings
async function resetPluginSettings(): Promise<void>

// Clean vault files
async function cleanVaultFiles(): Promise<void>
```

### Test Groups

#### Group 1: Status Bar (3 tests)

```
describe("status bar")
  before: setupSyncEngine + injectEmptyMocks

  it("shows 'GHVault: idle' on plugin load")
    → getStatusBarText() === "GHVault: idle"

  it("transitions to 'syncing...' during sync")
    → inject slow mock (adds 500ms delay to getRef)
    → trigger sync via command
    → immediately read status bar → "GHVault: syncing..."
    → wait for sync to finish
    → getStatusBarText() === "GHVault: idle"

  it("shows 'GHVault: error' after failed sync")
    → inject mock that throws Error from getRef
    → trigger sync
    → wait for completion
    → getStatusBarText() === "GHVault: error"
```

#### Group 2: Ribbon Icon & Command (3 tests)

```
describe("ribbon icon & command")
  before: setupSyncEngine + injectEmptyMocks + startNoticeCollector

  it("ribbon icon triggers sync")
    → click ribbon icon: browser.$('.side-dock-ribbon-action[aria-label="GHVault: Sync now"]')
    → wait for notice
    → getNotices("GHVault:") contains "Already up to date"

  it("command palette triggers sync")
    → browser.executeObsidianCommand("ghvault:ghvault-sync")
    → wait for notice
    → getNotices("GHVault:") contains "Already up to date"

  it("successful sync shows pull/push counts in notice")
    → inject mock with 2 remote files
    → trigger sync via command
    → getNotices("GHVault:") contains "Synced — 2 pulled, 0 pushed"
```

#### Group 3: Sync Guards (3 tests)

```
describe("sync guards")
  before: startNoticeCollector

  it("shows 'Configure settings first' when no engine")
    → resetPluginSettings + reload
    → trigger sync via command
    → getNotices("GHVault:") contains "Configure settings first"

  it("shows 'Sync already in progress' on concurrent attempt")
    → setupSyncEngine
    → inject slow mock (1000ms delay)
    → trigger sync via command (don't await)
    → immediately trigger sync again via command
    → getNotices("GHVault:") contains "Sync already in progress"

  it("shows 'Please wait before syncing again' on cooldown")
    → setupSyncEngine + injectEmptyMocks
    → trigger sync → wait for completion
    → immediately trigger sync again
    → getNotices("GHVault:") contains "Please wait before syncing again"
```

#### Group 4: Notice Content (2 tests)

```
describe("notice content")
  before: setupSyncEngine + startNoticeCollector

  it("error notice redacts token from message")
    → inject mock that throws Error containing "ghp_testtoken123456"
    → trigger sync
    → notice should contain "[REDACTED]", NOT contain "ghp_testtoken"

  it("'Already up to date' when no changes")
    → injectEmptyMocks (remote matches cache)
    → trigger sync
    → getNotices("GHVault:") contains "Already up to date"
```

#### Group 5: Load Test (2 tests)

```
describe("load test: 50+ files")
  before: setupSyncEngine

  it("pulls 50 remote files into vault")
    → injectMockWithFiles(50) — generates files like "load/file-001.md" ... "load/file-050.md"
    → trigger sync
    → verify all 50 files exist in vault via obsidianPage.read()
    → result.pull.created.length === 50

  it("pushes 50 local files to remote")
    → clean vault + inject empty remote mock
    → write 50 files to vault: obsidianPage.write("push/file-001.md", ...)
    → trigger sync
    → verify graphql.createCommit was called
    → result.push.pushed.length === 50
```

---

## Steps

### 1. Create ui spec file

Create `tests/e2e/specs/ui.spec.mts` with all helper functions and test groups.

### 2. Notice detection

Use MutationObserver on `document.body` to capture `.notice` elements. Obsidian creates notices as top-level children of the notice container. The observer must be started BEFORE the action that triggers the notice.

### 3. Status bar detection

Query all `.status-bar-item` elements inside the status bar, find the one whose text starts with "GHVault:".

### 4. Ribbon icon click

Select via aria-label: `[aria-label="GHVault: Sync now"]`. The icon is in `.side-dock-ribbon-action`.

### 5. Command execution

Use `browser.executeObsidianCommand("ghvault:ghvault-sync")` — the full command ID is `ghvault:ghvault-sync` (plugin ID prefix + command ID).

### 6. Load test mock generation

Generate N files with deterministic content and pre-computed git blob SHAs (using Web Crypto inside executeObsidian, same pattern as Phase 2).

### 7. Verify all gates

- `npm run test:e2e` — all E2E tests pass
- `npm test` — unit tests pass
- `npm run lint` — clean
- `npm run type-check` — clean
- `npm run build` — succeeds

---

## Files Created/Changed

| File | Change |
|------|--------|
| `tests/e2e/specs/ui.spec.mts` | New — UI interaction, guards, and load E2E test suite |

No changes to `src/` files.

---

## Risks

- **Notice DOM structure** — Obsidian's notice container class/structure may vary across versions. If `.notice` class isn't found, fall back to checking text content of all new DOM nodes.
- **Status bar timing** — "syncing..." state may be too brief to capture. Slow mock (artificial delay) needed to reliably observe intermediate state.
- **Command ID format** — Could be `ghvault:ghvault-sync` or just `ghvault-sync`. Need to verify in runtime. The `executeObsidianCommand` API may need the full ID with plugin prefix.
- **Load test duration** — 50 files with mock injection may be slow. Keep content small (one-liner per file) to avoid timeouts.
- **MutationObserver cleanup** — Must disconnect observer in afterEach to prevent memory leaks and cross-test contamination.

---

## Notes

- Total E2E tests after Phase 3: 35 (Phase 0-2) + 13 (Phase 3) = 48
- No network calls, no GitHub PAT needed
- Phase 3 completes the E2E test infrastructure for MVP
