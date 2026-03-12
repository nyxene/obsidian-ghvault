# 040 — E2E feasibility spike with wdio-obsidian-service

**Issue:** #79
**Branch:** `test/79-e2e-feasibility-spike`
**Scope:** infra

---

## Goal

Verify that `wdio-obsidian-service` works for GHVault E2E testing. Install the framework, create a minimal test vault, write 1 smoke test, confirm it runs.

---

## Steps

### 1. Install dependencies

```bash
npm install --save-dev @wdio/cli @wdio/local-runner @wdio/mocha-framework \
  @wdio/spec-reporter wdio-obsidian-service wdio-obsidian-reporter \
  expect @wdio/globals
```

### 2. Create wdio config

**File:** `wdio.conf.mts`

```typescript
import { ObsidianCapabilityOptions } from "wdio-obsidian-service";

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./tests/e2e/specs/**/*.spec.mts"],
  maxInstances: 1,
  capabilities: [{
    "wdio:obsidianOptions": {
      appVersion: "latest",
      installerVersion: "latest",
      plugins: ["."],
      vault: "./tests/e2e/vaults/basic",
    } satisfies ObsidianCapabilityOptions,
  }],
  framework: "mocha",
  mochaOpts: { timeout: 60000, ui: "bdd" },
  reporters: ["obsidian"],
  services: ["obsidian"],
  waitforTimeout: 5000,
  waitforInterval: 250,
};
```

### 3. Create test vault

**Dir:** `tests/e2e/vaults/basic/`

Minimal vault with one note:

```
tests/e2e/vaults/basic/
  Welcome.md          # "# Welcome\nTest vault for E2E."
```

No `.obsidian/` folder — wdio-obsidian-service creates it automatically.

### 4. Write smoke test

**File:** `tests/e2e/specs/smoke.spec.mts`

```typescript
import { browser } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

describe("GHVault plugin smoke test", () => {
  it("plugin is loaded and active", async () => {
    const loaded = await browser.executeObsidian(({ app }) => {
      return app.plugins.plugins["ghvault"] !== undefined;
    });
    expect(loaded).toBe(true);
  });

  it("plugin has default settings", async () => {
    const settings = await browser.executeObsidian(({ app }) => {
      const plugin = app.plugins.plugins["ghvault"];
      return plugin?.settings;
    });
    expect(settings).toBeDefined();
    expect(settings.branch).toBe("main");
    expect(settings.githubToken).toBe("");
  });

  it("settings tab is registered", async () => {
    const hasTab = await browser.executeObsidian(({ app }) => {
      const tabs = app.setting.pluginTabs;
      return tabs.some((t: any) => t.id === "ghvault");
    });
    expect(hasTab).toBe(true);
  });
});
```

### 5. Add npm script

**File:** `package.json` — add to scripts:

```json
"test:e2e": "wdio run wdio.conf.mts"
```

### 6. TypeScript config for E2E

**File:** `tests/e2e/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["@wdio/globals/types", "wdio-obsidian-service"]
  },
  "include": ["specs/**/*.mts"]
}
```

### 7. Update .gitignore

Add wdio logs/artifacts:

```
# E2E test artifacts
wdio-logs/
```

---

## Files Created/Changed

| File | Change |
|------|--------|
| `package.json` | Add devDependencies + `test:e2e` script |
| `wdio.conf.mts` | WebdriverIO config |
| `tests/e2e/tsconfig.json` | TS config for E2E tests |
| `tests/e2e/specs/smoke.spec.mts` | Smoke test (3 assertions) |
| `tests/e2e/vaults/basic/Welcome.md` | Test vault content |
| `.gitignore` | Add wdio-logs/ |

---

## Verification

```bash
npm run build                # Plugin must be built first
npm run test:e2e             # Launches Obsidian, runs smoke test
```

**Expected:** Obsidian opens, loads plugin, 3 tests pass, Obsidian closes.

**If fails:** Document what failed and why — that's the point of a feasibility spike.

---

## Notes

- wdio-obsidian-service auto-downloads Obsidian on first run (~500MB)
- Tests require a display (macOS/Linux with GUI, or Xvfb)
- First run will be slow (download + cache), subsequent runs fast
- The `executeObsidian` API replaces raw `eval` — type-safe, supports complex return values
