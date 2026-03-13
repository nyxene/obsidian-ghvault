# Manual Test Cases

Test catalog for manual QA of GHVault. Each test has an ID, priority, and platform scope.

**Priorities:**
- **P0** — Smoke. Must pass every release. Blocks release if failing.
- **P1** — Regression. Should pass every minor/major release.
- **P2** — Edge cases. Required for major releases only.

**Release scope:**
- Patch (0.x.1): P0 only + regression of specific fix
- Minor (0.x.0): P0 + P1 + new feature verification
- Major (x.0.0): P0 + P1 + P2 + all platforms

**Result tracking:** Use `✅ PASS`, `❌ FAIL (#issue)`, `⏭️ SKIP (reason)`.

---

## Group A: First Launch & Settings

### TC-SET-001: Plugin loads with correct defaults
**Priority:** P0
**Platform:** Both
**Preconditions:** Fresh install, no data.json
**Steps:**
1. Install plugin into `.obsidian/plugins/ghvault/`
2. Enable plugin in Obsidian settings
3. Open GHVault settings tab
**Expected:** All fields empty, branch = "main", log level = "info", status bar shows "GHVault: idle"

### TC-SET-002: Test Connection with invalid token
**Priority:** P0
**Platform:** Both
**Preconditions:** Plugin enabled
**Steps:**
1. Enter any string as token, set owner and repo to real values
2. Click "Test" button
**Expected:** Button shows "Failed ✗", then resets to "Test" after 3 seconds

### TC-SET-003: Test Connection with valid PAT
**Priority:** P0
**Platform:** Both
**Preconditions:** Valid fine-grained PAT with Contents: R/W, Metadata: Read
**Steps:**
1. Enter valid token, owner, repo
2. Click "Test" button
**Expected:** Button shows "Connected ✓", notice shows "Connected — owner/repo (public|private)"

### TC-SET-004: Input sanitization
**Priority:** P1
**Platform:** Desktop
**Preconditions:** Settings tab open
**Steps:**
1. Enter `my@owner!name` in owner field
2. Enter `my-repo.v2!@#` in repo field
3. Enter `feature/my-branch!!` in branch field
4. Enter `../../../etc/passwd` in sync folder field
**Expected:** Owner = "myownername", repo = "my-repo.v2", branch = "feature/my-branch", sync folder = "etc/passwd"

---

## Group B: First Sync — Empty Vault → Populated Repo

### TC-FSYNC-001: Pull all files from populated repo
**Priority:** P0
**Platform:** Both
**Preconditions:** Empty vault (only Welcome.md), repo with 5+ markdown files
**Steps:**
1. Configure settings with valid token/owner/repo
2. Click sync
**Expected:** All repo files appear in vault, notice shows pull count

### TC-FSYNC-002: Nested directories created
**Priority:** P0
**Platform:** Both
**Preconditions:** Repo contains files like `docs/notes/deep/file.md`
**Steps:**
1. Sync from empty vault
**Expected:** Full directory structure created in vault, files readable

### TC-FSYNC-003: Excluded patterns respected
**Priority:** P1
**Platform:** Both
**Preconditions:** Repo contains `.obsidian/config`, `.trash/file.md`, `ghvault.log`
**Steps:**
1. Sync from empty vault
**Expected:** None of the excluded files appear in vault

### TC-FSYNC-004: Binary files handled
**Priority:** P1
**Platform:** Both
**Preconditions:** Repo contains a PNG or PDF file
**Steps:**
1. Sync from empty vault
**Expected:** Binary file pulled and readable in vault

---

## Group C: First Sync — Populated Vault → Empty Repo

### TC-FSYNC-005: Push local files to empty repo
**Priority:** P0
**Platform:** Both
**Preconditions:** Vault with 3+ files, empty GitHub repo (has initial commit)
**Steps:**
1. Configure settings, sync
**Expected:** All vault files appear on GitHub as a single commit

### TC-FSYNC-006: Commit is GPG-signed
**Priority:** P1
**Platform:** Desktop
**Preconditions:** Previous test complete
**Steps:**
1. Open the commit on GitHub
**Expected:** "Verified" badge visible (GraphQL commits are auto-signed by GitHub)

---

## Group D: Pull — Remote → Vault

### TC-PULL-001: New remote file pulled
**Priority:** P0
**Platform:** Both
**Preconditions:** Initial sync complete
**Steps:**
1. Create a new file via GitHub web UI
2. Sync in Obsidian
**Expected:** File appears in vault with correct content

### TC-PULL-002: Modified remote file updated
**Priority:** P0
**Platform:** Both
**Preconditions:** File exists in both vault and repo
**Steps:**
1. Edit the file via GitHub web UI
2. Sync in Obsidian
**Expected:** Local file updated to match remote content

### TC-PULL-003: Deleted remote file removed
**Priority:** P0
**Platform:** Both
**Preconditions:** File exists in both vault and repo
**Steps:**
1. Delete the file via GitHub web UI
2. Sync in Obsidian
**Expected:** File removed from vault

---

## Group E: Push — Vault → Remote

### TC-PUSH-001: New local file pushed
**Priority:** P0
**Platform:** Both
**Preconditions:** Initial sync complete
**Steps:**
1. Create a new markdown file in vault
2. Sync
**Expected:** File appears on GitHub

### TC-PUSH-002: Modified local file pushed
**Priority:** P0
**Platform:** Both
**Preconditions:** File exists in both vault and repo
**Steps:**
1. Edit the file in Obsidian
2. Sync
**Expected:** GitHub file updated with new content

### TC-PUSH-003: Deleted local file removed from remote
**Priority:** P0
**Platform:** Both
**Preconditions:** File exists in both vault and repo
**Steps:**
1. Delete the file in Obsidian
2. Sync
**Expected:** File removed from GitHub

---

## Group F: Bidirectional

### TC-BIDI-001: Pull + push in same cycle
**Priority:** P0
**Platform:** Both
**Preconditions:** Initial sync complete
**Steps:**
1. Add `remote-new.md` via GitHub web UI
2. Add `local-new.md` in vault
3. Sync
**Expected:** Both files exist in both vault and GitHub

### TC-BIDI-002: No changes — idempotent
**Priority:** P1
**Platform:** Both
**Preconditions:** Vault and repo fully synced
**Steps:**
1. Sync again without making any changes
**Expected:** Notice shows "Already up to date", no commits created

---

## Group G: Conflict Detection

### TC-CONF-001: Conflict detected and reported
**Priority:** P0
**Platform:** Both
**Preconditions:** File `shared.md` exists in both vault and repo
**Steps:**
1. Edit `shared.md` in vault (do not sync)
2. Edit `shared.md` via GitHub web UI
3. Sync
**Expected:** Notice mentions conflict, local file unchanged, file not pushed to GitHub

### TC-CONF-002: Non-conflicting files sync alongside conflicts
**Priority:** P1
**Platform:** Both
**Preconditions:** `conflict.md` and `safe.md` exist in both
**Steps:**
1. Edit `conflict.md` in both vault and GitHub
2. Edit `safe.md` only in vault
3. Add `remote-new.md` on GitHub
4. Sync
**Expected:** `conflict.md` skipped, `safe.md` pushed, `remote-new.md` pulled

---

## Group H: Sync Folder

### TC-SFLD-001: Only syncFolder files pulled
**Priority:** P1
**Platform:** Both
**Preconditions:** Set syncFolder = "docs", repo has `docs/note.md` and `root.md`
**Steps:**
1. Sync
**Expected:** `note.md` appears in vault root, `root.md` does not

### TC-SFLD-002: Local files pushed with prefix
**Priority:** P1
**Platform:** Both
**Preconditions:** syncFolder = "docs"
**Steps:**
1. Create `local-note.md` in vault
2. Sync
**Expected:** On GitHub, file appears as `docs/local-note.md`

### TC-SFLD-003: Changing syncFolder clears cache
**Priority:** P1
**Platform:** Desktop
**Steps:**
1. Sync with syncFolder = "" (full repo)
2. Change syncFolder to "docs"
3. Sync again
**Expected:** Only `docs/*` files synced, old full-repo cache cleared

---

## Group I: Guards & Error Handling

### TC-GUARD-001: No settings configured
**Priority:** P0
**Platform:** Both
**Preconditions:** Token, owner, or repo is empty
**Steps:**
1. Click sync
**Expected:** Notice: "Configure settings first (token, owner, repo)"

### TC-GUARD-002: Concurrent sync blocked
**Priority:** P0
**Platform:** Both
**Steps:**
1. Click sync
2. Immediately click sync again while first is running
**Expected:** Notice: "Sync already in progress"

### TC-GUARD-003: Cooldown enforced
**Priority:** P1
**Platform:** Both
**Steps:**
1. Sync successfully
2. Click sync again within 5 seconds
**Expected:** Notice: "Please wait before syncing again"

### TC-GUARD-004: Network error with token redaction
**Priority:** P1
**Platform:** Both
**Steps:**
1. Disable WiFi/network
2. Click sync
**Expected:** Error notice shown, no token visible in the message

### TC-GUARD-005: Expired/revoked token
**Priority:** P2
**Platform:** Both
**Steps:**
1. Revoke the PAT on GitHub
2. Click sync
**Expected:** Meaningful error notice (not raw API response), status bar shows "error"

---

## Group J: Large Files

### TC-LARGE-001: File ~2MB synced via fallback
**Priority:** P1
**Platform:** Desktop
**Steps:**
1. Add a ~2MB markdown file to vault
2. Sync
**Expected:** File pushed successfully (uses REST blob fallback, not GraphQL)

### TC-LARGE-002: File >50MB skipped
**Priority:** P2
**Platform:** Desktop
**Steps:**
1. Add a >50MB file to vault
2. Sync
**Expected:** File skipped, no crash, other files sync normally

---

## Group K: Mobile-Specific

### TC-MOB-001: Settings tab renders on mobile
**Priority:** P0
**Platform:** Mobile
**Steps:**
1. Install plugin on iOS or Android
2. Open settings
**Expected:** All fields visible and functional

### TC-MOB-002: Sync works on mobile
**Priority:** P0
**Platform:** Mobile
**Preconditions:** Valid settings configured
**Steps:**
1. Sync from mobile
**Expected:** Files pulled/pushed correctly

### TC-MOB-003: Create and push from mobile
**Priority:** P1
**Platform:** Mobile
**Steps:**
1. Create a new note on mobile
2. Sync
**Expected:** File appears on GitHub

### TC-MOB-004: Background/foreground resilience
**Priority:** P1
**Platform:** Mobile
**Steps:**
1. Start a sync
2. Switch to another app
3. Return to Obsidian
**Expected:** No crash, status bar shows correct state

### TC-MOB-005: Slow network behavior
**Priority:** P2
**Platform:** Mobile
**Steps:**
1. Use throttled network (e.g., airplane mode toggle during sync)
**Expected:** Error notice shown, no crash, can retry after

---

## Group L: Plugin Lifecycle

### TC-LIFE-001: Disable/enable preserves settings
**Priority:** P1
**Platform:** Both
**Steps:**
1. Configure settings and sync
2. Disable plugin
3. Re-enable plugin
**Expected:** Settings preserved, sync engine rebuilt, status bar shows "idle"

### TC-LIFE-002: Clean reinstall restores defaults
**Priority:** P1
**Platform:** Both
**Steps:**
1. Disable plugin
2. Delete `data.json` from `.obsidian/plugins/ghvault/`
3. Re-enable plugin
**Expected:** All settings reset to defaults

---

## Group M: Obsidian Community Plugin Compliance

### TC-OBSDN-001: No innerHTML/outerHTML
**Priority:** P0
**Platform:** N/A (code audit)
**Steps:**
1. Run `npm run check:obsidian`
**Expected:** "No innerHTML/outerHTML" — PASS

### TC-OBSDN-002: No fetch() calls
**Priority:** P0
**Platform:** N/A (code audit)
**Steps:**
1. Run `npm run check:obsidian`
**Expected:** "No fetch() calls" — PASS

### TC-OBSDN-003: No Node.js imports
**Priority:** P0
**Platform:** N/A (code audit)
**Steps:**
1. Run `npm run check:obsidian`
**Expected:** "No Node.js imports" — PASS

---

## Group N: Binary File Support

### TC-BIN-001: Pull PNG image from repo
**Priority:** P0
**Platform:** Both
**Preconditions:** Repo contains a PNG image (e.g., `screenshot.png`)
**Steps:**
1. Sync from empty vault
**Expected:** Image file appears in vault, opens correctly in Obsidian

### TC-BIN-002: Push local image to repo
**Priority:** P0
**Platform:** Both
**Preconditions:** Initial sync complete
**Steps:**
1. Add a PNG or JPEG image to vault
2. Sync
**Expected:** Image appears on GitHub, binary content intact (not corrupted)

### TC-BIN-003: Modify binary file remotely and pull
**Priority:** P1
**Platform:** Both
**Preconditions:** Image exists in both vault and repo
**Steps:**
1. Replace the image on GitHub (upload new version via web UI)
2. Sync in Obsidian
**Expected:** Local image updated to match remote version

### TC-BIN-004: PDF file round-trip
**Priority:** P1
**Platform:** Both
**Steps:**
1. Add a PDF file to vault
2. Sync (push)
3. Modify the PDF on GitHub
4. Sync again (pull)
**Expected:** PDF pushed and pulled correctly, readable after round-trip

### TC-BIN-005: Mixed sync — text and binary files together
**Priority:** P1
**Platform:** Both
**Preconditions:** Repo has both .md and .png files
**Steps:**
1. Add a new .md file and a new .png file locally
2. Add a new .md file and a new .png file on GitHub
3. Sync
**Expected:** All 4 files synced correctly in both directions

### TC-BIN-006: Binary file with null bytes in first 8KB
**Priority:** P2
**Platform:** Desktop
**Steps:**
1. Add a file that contains null bytes (e.g., compiled binary, .zip archive)
2. Sync
**Expected:** File detected as binary, pushed with correct encoding, pullable
