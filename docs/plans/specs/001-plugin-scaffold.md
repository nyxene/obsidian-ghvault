# Plugin Scaffold

**Issue:** #1
**Date:** 2026-03-08
**Status:** APPROVED
**Branch:** feat/1-plugin-scaffold

## Objective
Set up the complete Obsidian plugin project scaffold: build pipeline, linting, testing, CI, and release-please. After completion the plugin compiles, loads in Obsidian, and all CI gates pass.

## Scope
Project root config files + `src/main.ts` (minimal Plugin class).

## Approach
Standard Obsidian plugin scaffold with esbuild bundler, Biome linter/formatter, vitest for testing, GitHub Actions for CI, and release-please for automated releases.

## Tasks

### 1. Package & Config
- [ ] `package.json` — dependencies, scripts (build, dev, lint, format, type-check, test)
- [ ] `tsconfig.json` — strict, ES2020, Obsidian-compatible module resolution
- [ ] `esbuild.config.mjs` — bundle src/main.ts → main.js (CommonJS, external: obsidian)
- [ ] `manifest.json` — id: ghvault, minAppVersion, version: 0.0.0 (release-please manages)
- [ ] `styles.css` — empty (required by Obsidian)
- [ ] `biome.json` — lint + format rules (noExplicitAny, noConsole, noUnusedVariables, named exports)

### 2. Source
- [ ] `src/main.ts` — minimal Plugin class (onload/onunload)

### 3. Git Hooks & Commit Lint
- [ ] Husky — pre-commit hook
- [ ] lint-staged — biome check --write on staged files
- [ ] commitlint — conventional commits enforcement

### 4. CI (GitHub Actions)
- [ ] `.github/workflows/ci.yml` — on PR to main: lint → type-check → test → build
  - Job names MUST match ruleset status checks: Lint & Format, Type Check, Tests, Build

### 5. Release
- [ ] `.github/workflows/release.yml` — release-please action on push to main
- [ ] `.release-please-manifest.json` — version tracking
- [ ] `release-please-config.json` — plugin type, bump manifest.json + package.json

## Risks
- release-please must update both manifest.json (Obsidian) and package.json — needs extra-files config
- versions.json (Obsidian community plugins) not needed yet

## Out of Scope
- Plugin logic (settings, GitHub client, sync engine)
- Obsidian community plugin submission

---
*Approved by: the Aronnax*
*Mobilis in Mobili*
