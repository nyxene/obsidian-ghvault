# test-vault for local plugin development

**Issue:** #24
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** feat/24-test-vault

## Objective
Local test vault for manual plugin testing with hot reload support.

## Scope
- `.gitignore` — add test-vault/
- `esbuild.config.mjs` — dev mode outputs to test-vault, watch mode, copies manifest.json
- `test-vault/` — gitignored, created by `npm run dev`

## Usage
1. `npm run dev` — starts watch mode, outputs to test-vault
2. Open `test-vault/` as vault in Obsidian
3. Install Hot Reload plugin (Community Plugins) for auto-reload
4. Edit source → plugin reloads automatically

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
