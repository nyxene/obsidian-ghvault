# 065 — README.md for MVP release

**Issue:** #65
**Branch:** `docs/65-readme`
**Scope:** infra

---

## Goal

Replace stub README with a full project README for public release on GitHub and future Obsidian community plugin listing.

---

## Structure

```
# GHVault
> One-line tagline

## Features (bullet list with key differentiators)

## Screenshots
- Settings tab (docs/screenshots/settings.png)
- Vault with status bar idle (docs/screenshots/vault-idle.png)

## Installation
- Manual (download release → .obsidian/plugins)
- Future: Obsidian community plugins

## Setup
1. Create GitHub PAT (fine-grained, repo scope)
2. Open plugin settings
3. Fill token, owner, repo
4. Test connection
5. Sync

## Usage
- Ribbon icon / command palette / hotkey
- Status bar states: idle, syncing..., error
- Sync folder for subfolder sync

## How it works
- Brief architecture: pull (REST) → diff → push (GraphQL)
- No git CLI, mobile-compatible
- Conflict detection

## Security
- Token storage warning
- Fine-grained PAT recommendation
- What GHVault excludes (.obsidian, .trash, ghvault.log)

## Development
- npm install / build / test / lint
- Tech stack summary

## License
- MIT
```

---

## Screenshots

Three screenshots captured via E2E infrastructure (`tests/e2e/specs/screenshots.spec.mts`):

| File | Shows |
|------|-------|
| `docs/screenshots/settings.png` | Settings tab with all fields, token warning banner |
| `docs/screenshots/vault-idle.png` | Vault view with "GHVault: idle" in status bar |
| `docs/screenshots/vault-syncing.png` | Vault view with "GHVault: syncing..." in status bar |

Only settings + vault-idle will be used in README (syncing is too similar to idle for static docs).

---

## Steps

### 1. Write README.md

Create `README.md` at project root with the structure above.

### 2. Add .gitignore entry for screenshot spec

The `screenshots.spec.mts` is a utility, not a test. Add it to wdio exclude or keep it — it's harmless since it just takes screenshots.

### 3. Verify all gates

- `npm run lint` — clean
- `npm run type-check` — clean
- `npm test` — 363 unit tests pass
- `npm run build` — succeeds

---

## Files Created/Changed

| File | Change |
|------|--------|
| `README.md` | New — full project README |
| `docs/screenshots/settings.png` | New — settings tab screenshot |
| `docs/screenshots/vault-idle.png` | New — vault with idle status |
| `docs/screenshots/vault-syncing.png` | New — vault with syncing status |
| `tests/e2e/specs/screenshots.spec.mts` | New — screenshot capture utility |

No changes to `src/` files.

---

## Notes

- README is English-only (per CLAUDE.md language rules)
- Screenshots are real Obsidian 1.12.4 captures, not mockups
- Keep README concise — detailed docs stay in `docs/private/`
