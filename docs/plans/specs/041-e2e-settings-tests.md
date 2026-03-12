# 041 — E2E settings test suite (Phase 1)

**Issue:** #81
**Branch:** `test/81-e2e-settings-tests`
**Scope:** infra

---

## Goal

Add E2E tests covering the full settings tab lifecycle: persistence across reload, input sanitization, sync folder validation, test connection button states, syncEngine creation/teardown, and log level dropdown.

---

## Approach

All tests run inside real Obsidian via `wdio-obsidian-service`. Two interaction modes:

1. **Programmatic** — `browser.executeObsidian()` to read/write `plugin.settings` and call `plugin.saveSettings()`. Used for state verification and setup.
2. **UI** — WebdriverIO selectors to interact with settings tab elements (`input`, `select`, `button`). Used to test the actual UI behavior.

Settings tab must be opened via Obsidian command or programmatic navigation before UI interaction tests.

---

## Test File

**File:** `tests/e2e/specs/settings.spec.mts`

### Test Groups

#### Group 1: Settings Persistence

```
describe("settings persistence")
  it("saves settings programmatically and persists after reload")
    → set owner, repo, branch via executeObsidian
    → call plugin.saveSettings()
    → browser.reloadObsidian()
    → verify settings retained

  it("resets to defaults after plugin disable/enable cycle")
    → set settings, save
    → obsidianPage.disablePlugin("ghvault")
    → delete data.json via executeObsidian (app.vault.adapter.remove)
    → obsidianPage.enablePlugin("ghvault")
    → verify defaults restored
```

#### Group 2: SyncEngine Lifecycle

```
describe("syncEngine lifecycle")
  it("syncEngine is null when required fields are empty")
    → verify plugin.syncEngine === null (fresh state)

  it("syncEngine is created when token + owner + repo are set")
    → set githubToken, owner, repo via executeObsidian
    → trigger onSave callback (plugin.saveSettings + engine rebuild)
    → verify plugin.syncEngine !== null

  it("syncEngine is destroyed when token is cleared")
    → clear githubToken
    → trigger onSave
    → verify plugin.syncEngine === null
```

#### Group 3: Input Sanitization (programmatic)

Test sanitization by writing to settings and reading back:

```
describe("input sanitization")
  it("sanitizes owner: removes special chars")
    → set owner to "my@owner!name" via plugin
    → apply sanitizeSlug → expect "myownername"

  it("sanitizes repo: removes special chars, keeps dots/dashes")
    → set repo to "my-repo.v2!@#" → expect "my-repo.v2"

  it("sanitizes branch: allows forward slashes")
    → set branch to "feature/my-branch!!" → expect "feature/my-branch"

  it("sanitizes syncFolder: strips traversal")
    → set syncFolder to "../../../etc/passwd" → expect "etc/passwd"

  it("sanitizes syncFolder: normalizes double slashes")
    → set syncFolder to "docs//vault///notes" → expect "docs/vault/notes"
```

#### Group 4: Settings UI Interaction

Open settings tab and interact with real UI elements:

```
describe("settings UI")
  before: open settings tab programmatically

  it("settings tab has all expected fields")
    → verify 6 setting items present (token, owner, repo, branch, syncFolder, logLevel)
    → verify test connection button exists

  it("token input is password type")
    → find input with placeholder "ghp_..."
    → verify input.type === "password"

  it("token warning banner is visible")
    → find .ghvault-token-warning element
    → verify contains "stored unencrypted"

  it("log level dropdown has 4 options")
    → find select element
    → verify options: debug, info, warn, error
    → verify default selected = "info"

  it("test connection shows 'Fill settings first' when fields empty")
    → click Test button
    → verify button text becomes "Fill settings first"
    → wait 2.5s, verify button text resets to "Test"
```

---

## Steps

### 1. Create settings spec file

Create `tests/e2e/specs/settings.spec.mts` with all test groups above.

### 2. Helper: open settings tab

Create a helper to open the plugin settings tab programmatically:

```typescript
async function openPluginSettings(): Promise<void> {
  await browser.executeObsidian(({ app }) => {
    const setting = (app as any).setting;
    setting.open();
    setting.openTabById("ghvault");
  });
  // Wait for tab to render
  await browser.pause(500);
}
```

### 3. Helper: reset plugin to defaults

```typescript
async function resetPluginSettings(): Promise<void> {
  await browser.executeObsidian(async ({ plugins }) => {
    const plugin = plugins.ghvault as any;
    plugin.settings = {
      githubToken: "",
      owner: "",
      repo: "",
      branch: "main",
      syncFolder: "",
      logLevel: "info",
    };
    await plugin.saveSettings();
  });
}
```

### 4. Verify all gates pass

- `npm run test:e2e` — all E2E tests pass
- `npm test` — 363 unit tests still pass
- `npm run lint` — clean
- `npm run type-check` — clean
- `npm run build` — succeeds

---

## Files Created/Changed

| File | Change |
|------|--------|
| `tests/e2e/specs/settings.spec.mts` | New — settings E2E test suite |

No changes to `src/` files. No config changes needed (wdio already configured from Phase 0).

---

## Risks

- **Settings tab DOM selectors** may be fragile if Obsidian changes its settings panel structure. Use semantic selectors where possible (placeholder text, element type) rather than CSS class names.
- **Reload timing** — `browser.reloadObsidian()` may need extra wait time for plugin to fully initialize.
- **Test isolation** — each test group should clean up settings via `resetPluginSettings()` in `afterEach` or `after` hooks.

---

## Verification

```bash
npm run build
npm run test:e2e     # All settings + smoke tests pass
npm test             # Unit tests unaffected
```
