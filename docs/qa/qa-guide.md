# QA Guide

How to build, sideload, and test GHVault.

## Building locally

```bash
npm install
npm run build
```

Output: `main.js`, `manifest.json`, `styles.css` in project root.

## Sideloading (desktop)

1. Create a test vault (do NOT use your real notes)
2. Create `.obsidian/plugins/ghvault/` inside the vault
3. Copy `main.js`, `manifest.json`, `styles.css` into it
4. Open Obsidian Settings → Community Plugins → Enable "GHVault"

## Sideloading (mobile)

1. Build on desktop (`npm run build`)
2. Copy `main.js` + `manifest.json` + `styles.css` to your mobile vault's `.obsidian/plugins/ghvault/` folder (via iCloud, Google Drive, or manual transfer)
3. Restart Obsidian on mobile
4. Enable the plugin in Settings → Community Plugins

## Test vault setup

- Create a **private** test GitHub repo
- Create a **fine-grained PAT** with these permissions:
  - Contents: Read and write
  - Metadata: Read
- Add a few markdown files to the repo for pull testing
- Use a dedicated test vault — never your real notes

## Running tests

| Command | What it does |
|---------|-------------|
| `npm test` | Unit tests (vitest) |
| `npm run test:coverage` | Unit tests with coverage report |
| `npm run test:e2e` | E2E tests (wdio + Obsidian, desktop only) |
| `npm run check:obsidian` | Obsidian community plugin compliance |
| `npm run lint` | Biome lint |
| `npm run type-check` | TypeScript strict check |

## Manual testing

Follow the test catalog in [manual-test-cases.md](manual-test-cases.md).

### Priorities

- **P0 (smoke)**: Must pass every release. 21 tests.
- **P1 (regression)**: Must pass for minor/major releases. 16 tests.
- **P2 (edge cases)**: Must pass for major releases only. 3 tests.

### Result tracking

Mark each test case with:

- `✅ PASS` — test passed
- `❌ FAIL (#issue)` — test failed, link to bug issue
- `⏭️ SKIP (reason)` — test skipped with justification

### Creating a QA tracking issue

For each release, create a GitHub issue from the [release QA template](../../.github/ISSUE_TEMPLATE/release-qa.md). Copy relevant test cases from the manual test catalog.

## Reporting bugs

If you find a bug during QA:

1. Create a separate GitHub issue with reproduction steps
2. Reference the QA tracking issue
3. Mark the test case as `❌ FAIL (#issue-number)` in the QA issue
