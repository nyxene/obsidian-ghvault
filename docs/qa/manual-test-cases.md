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
**Expected:** All fields empty, branch = "main", auto-sync = off, debounce = 10, log level = "info", status bar shows "GHVault: idle"

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

### TC-CONF-003: Local-wins resolves by pushing local version
**Priority:** P0
**Platform:** Both
**Preconditions:** Conflict strategy = "Local wins", `shared.md` synced
**Steps:**
1. Edit `shared.md` in vault
2. Edit `shared.md` via GitHub web UI
3. Sync
**Expected:** Local version pushed to GitHub, remote overwritten. Notice shows "1 resolved (local wins)"

### TC-CONF-004: Remote-wins resolves by pulling remote version
**Priority:** P0
**Platform:** Both
**Preconditions:** Conflict strategy = "Remote wins", `shared.md` synced
**Steps:**
1. Edit `shared.md` in vault
2. Edit `shared.md` via GitHub web UI
3. Sync
**Expected:** Remote version pulled to vault, local overwritten. Notice shows "1 resolved (remote wins)"

### TC-CONF-005: Skip strategy preserves current behavior
**Priority:** P1
**Platform:** Both
**Preconditions:** Conflict strategy = "Skip" (default), `shared.md` synced
**Steps:**
1. Edit `shared.md` in both vault and GitHub
2. Sync
**Expected:** File skipped on both sides, Notice shows "1 conflict"

### TC-CONF-006: Strategy change takes effect on next sync
**Priority:** P1
**Platform:** Both
**Preconditions:** Conflict strategy = "Skip"
**Steps:**
1. Create a conflict (edit file in both vault and GitHub)
2. Sync — file should be skipped
3. Change strategy to "Local wins" in settings
4. Sync again
**Expected:** Second sync resolves conflict with local-wins strategy

### TC-CONF-007: Local-wins with delete conflict
**Priority:** P1
**Platform:** Both
**Preconditions:** Conflict strategy = "Local wins", `shared.md` synced
**Steps:**
1. Delete `shared.md` on GitHub
2. Edit `shared.md` in vault
3. Sync
**Expected:** Local version pushed (re-created on GitHub)

### TC-CONF-008: Remote-wins with delete conflict
**Priority:** P1
**Platform:** Both
**Preconditions:** Conflict strategy = "Remote wins", `shared.md` synced
**Steps:**
1. Delete `shared.md` on GitHub
2. Edit `shared.md` in vault
3. Sync
**Expected:** Local file deleted (matches remote state)

### TC-CONF-009: Ask strategy — resolve per-file
**Priority:** P0
**Platform:** Both
**Preconditions:** Conflict strategy = "Ask", two files synced (`a.md`, `b.md`)
**Steps:**
1. Edit both files locally and remotely
2. Sync
3. Modal appears listing both conflicts
4. Choose "Keep Local" for `a.md`, "Keep Remote" for `b.md`
5. Click "Resolve"
**Expected:** `a.md` = local version pushed to GitHub, `b.md` = remote version pulled to vault. Notice shows "2 resolved (per-file)"

### TC-CONF-010: Ask strategy — Skip All
**Priority:** P0
**Platform:** Both
**Preconditions:** Conflict strategy = "Ask", one file synced
**Steps:**
1. Create a conflict
2. Sync — modal appears
3. Click "Skip All"
**Expected:** Both sides untouched. Notice shows "1 conflict"

### TC-CONF-011: Ask strategy — close modal without choosing
**Priority:** P1
**Platform:** Both
**Preconditions:** Conflict strategy = "Ask"
**Steps:**
1. Create a conflict
2. Sync — modal appears
3. Close modal (Escape or X)
**Expected:** Same as Skip All — both sides untouched

### TC-CONF-012: Settings dropdown shows 4 strategies
**Priority:** P1
**Platform:** Both
**Steps:**
1. Open GHVault settings
2. Click "Conflict strategy" dropdown
**Expected:** Four options: Skip, Local wins, Remote wins, Ask

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

## Group K: Auto-Sync

### TC-AUTO-001: Auto-sync triggers after file edit
**Priority:** P0
**Platform:** Both
**Preconditions:** Auto-sync enabled, debounce = 5s, initial sync complete
**Steps:**
1. Edit a markdown file in vault
2. Wait 5+ seconds without making changes
**Expected:** Sync runs automatically, status bar shows "syncing..." then "idle", file appears on GitHub

### TC-AUTO-002: Debounce resets on rapid edits
**Priority:** P0
**Platform:** Both
**Preconditions:** Auto-sync enabled, debounce = 10s
**Steps:**
1. Edit file A
2. Wait 5 seconds
3. Edit file B
4. Wait 5 seconds
5. Edit file C
6. Wait 10+ seconds
**Expected:** Only one sync happens (after 10s of quiet), all 3 files pushed in one commit

### TC-AUTO-003: File create/delete/rename triggers auto-sync
**Priority:** P1
**Platform:** Both
**Preconditions:** Auto-sync enabled, debounce = 5s
**Steps:**
1. Create a new file, wait 5s → sync runs
2. Delete a file, wait 5s → sync runs
3. Rename a file, wait 5s → sync runs
**Expected:** Each operation triggers a sync after debounce period

### TC-AUTO-004: Events during sync are not lost
**Priority:** P0
**Platform:** Both
**Preconditions:** Auto-sync enabled, debounce = 5s, a large file (~2MB) in repo for slow sync
**Steps:**
1. Trigger sync (e.g., edit a file, wait for debounce)
2. While sync is running (status bar shows "syncing..."), edit another file
3. Wait for first sync to complete + debounce period
**Expected:** A second sync runs automatically after the first completes, pushing the file edited during sync

### TC-AUTO-005: Excluded paths do not trigger auto-sync
**Priority:** P1
**Platform:** Both
**Preconditions:** Auto-sync enabled, debounce = 3s
**Steps:**
1. Modify `.obsidian/workspace.json` (e.g., open a different pane)
2. Wait 5 seconds
**Expected:** No sync triggered

### TC-AUTO-006: Auto-sync toggle saves immediately
**Priority:** P1
**Platform:** Both
**Steps:**
1. Open settings, toggle Auto-sync on
2. Close and reopen settings
**Expected:** Toggle shows enabled state

### TC-AUTO-007: Debounce setting validates input
**Priority:** P1
**Platform:** Desktop
**Steps:**
1. Set debounce to "abc" → warning in description, value unchanged
2. Set debounce to "0" → warning "Min 1s", value unchanged
3. Set debounce to "999" → warning "Max 300s", value unchanged
4. Click away (blur) → field restores to last saved value
5. Set debounce to "60" → saves, description shows range info
**Expected:** All validations work as described, no data loss

### TC-AUTO-008: Auto-sync disabled by default
**Priority:** P0
**Platform:** Both
**Preconditions:** Fresh install
**Steps:**
1. Enable plugin, open settings
**Expected:** Auto-sync toggle is off, no vault event listeners active

### TC-AUTO-009: Cooldown respected in auto-sync
**Priority:** P1
**Platform:** Both
**Preconditions:** Auto-sync enabled, debounce = 1s
**Steps:**
1. Edit a file → sync runs after 1s
2. Immediately edit another file → debounce 1s
3. Second sync attempt hits 5s cooldown → skipped silently
4. Wait 5s, edit another file → sync runs
**Expected:** No more than one sync per 5 seconds, no error notices

### TC-AUTO-010: Disable/re-enable auto-sync cleans up listeners
**Priority:** P2
**Platform:** Both
**Steps:**
1. Enable auto-sync, verify it works
2. Disable auto-sync in settings
3. Edit a file, wait — no sync should trigger
4. Re-enable auto-sync
5. Edit a file, wait — sync should trigger
**Expected:** Toggling on/off correctly registers/unregisters vault event listeners

---

## Group P: Remote Pull Check

### TC-RPULL-001: Pull interval setting renders
**Priority:** P0
**Platform:** Desktop
**Steps:**
1. Open GHVault settings
**Expected:** "Remote pull interval" field visible with default value 300, description shows range (30–3600)

### TC-RPULL-002: Pull interval setting validates input
**Priority:** P1
**Platform:** Desktop
**Steps:**
1. Set pull interval to "abc" → warning in description, value unchanged
2. Set pull interval to "10" → warning "Min 30s", value unchanged
3. Set pull interval to "9999" → warning "Max 3600s", value unchanged
4. Click away (blur) → field restores to last saved value
5. Set pull interval to "120" → saves, description shows range info
**Expected:** All validations work as described, no data loss

### TC-RPULL-003: Remote changes auto-detected
**Priority:** P0
**Platform:** Both
**Preconditions:** Auto-sync enabled, pull interval = 30s, initial sync complete
**Steps:**
1. Add a file to the repo via GitHub web UI
2. Wait 30–60 seconds (do NOT manually sync)
**Expected:** File appears in vault automatically, status bar flashes "syncing..." then returns to "idle"

### TC-RPULL-004: No sync when remote unchanged
**Priority:** P1
**Platform:** Both
**Preconditions:** Auto-sync enabled, pull interval = 30s, vault and repo in sync
**Steps:**
1. Wait 2+ minutes without any changes
2. Check log file (debug level)
**Expected:** No sync triggered, log shows periodic ref checks without sync actions

### TC-RPULL-005: Backoff when idle
**Priority:** P1
**Platform:** Both
**Preconditions:** Auto-sync enabled, pull interval = 60s, log level = debug
**Steps:**
1. Wait 5+ minutes without local or remote changes
2. Check log for ref check intervals
**Expected:** Intervals increase: ~60s, ~120s, ~240s, capping at ~480s (8× base)

### TC-RPULL-006: Backoff resets on remote change
**Priority:** P1
**Platform:** Both
**Preconditions:** Auto-sync enabled, pull interval = 60s, log level = debug, idle for 5+ min (interval backed off)
**Steps:**
1. Add a file on GitHub via web UI
2. Wait for pull check to detect and sync it
3. Check log for next interval
**Expected:** Interval resets to base (60s) after detecting remote change

### TC-RPULL-007: Pull check skipped during active sync
**Priority:** P2
**Platform:** Both
**Preconditions:** Auto-sync enabled, pull interval = 30s
**Steps:**
1. Edit a local file to trigger auto-sync
2. During sync (status = "syncing..."), observe pull check behavior in logs
**Expected:** Pull check skipped while sync is in progress, resumes after

### TC-RPULL-008: Pull check respects rate limits
**Priority:** P2
**Platform:** Both
**Steps:**
1. Exhaust REST rate limit (or simulate low remaining via many rapid syncs)
2. Observe pull check behavior in debug logs
**Expected:** Pull check skipped with "rate limit low" log message, no API call made

### TC-RPULL-009: Disabling auto-sync stops pull check
**Priority:** P0
**Platform:** Both
**Preconditions:** Auto-sync enabled, pull check active
**Steps:**
1. Toggle auto-sync off in settings
2. Add a file on GitHub
3. Wait 2+ minutes
**Expected:** No automatic sync, remote change not pulled until manual sync

---

## Group Q: Crash Recovery

### TC-CRASH-001: Pending changes survive restart
**Priority:** P0
**Platform:** Both
**Preconditions:** Auto-sync enabled, debounce = 30s
**Steps:**
1. Edit a file in vault
2. Before debounce fires (within 30s), force-quit Obsidian
3. Reopen Obsidian
**Expected:** Plugin restores pending changes, triggers sync after debounce, file pushed to GitHub. Log shows "Restored pending changes from previous session"

### TC-CRASH-002: No restore when autoSync is disabled
**Priority:** P1
**Platform:** Both
**Preconditions:** Auto-sync disabled
**Steps:**
1. Manually sync, then edit a file
2. Force-quit and reopen Obsidian
**Expected:** No automatic sync on startup, pending changes remain in storage until autoSync is re-enabled

### TC-CRASH-003: Empty pending buffer causes no action
**Priority:** P1
**Platform:** Both
**Preconditions:** Auto-sync enabled, vault fully synced
**Steps:**
1. Restart Obsidian normally (no pending changes)
**Expected:** No restore log message, no sync triggered on startup

### TC-CRASH-004: Stale pending changes are handled gracefully
**Priority:** P1
**Platform:** Both
**Preconditions:** Auto-sync enabled
**Steps:**
1. Edit a file, force-quit before sync
2. From another device, sync the same file to GitHub
3. Reopen Obsidian
**Expected:** Restore triggers sync; SHA comparison detects file already synced; no duplicate push or conflict

### TC-CRASH-005: Successful sync clears persisted buffer
**Priority:** P0
**Platform:** Both
**Preconditions:** Auto-sync enabled, debounce = 5s
**Steps:**
1. Edit a file, wait for sync to complete
2. Check data.json → pendingChanges should be empty `{}`
3. Force-quit and reopen Obsidian
**Expected:** No restore on startup (buffer was cleared after successful sync)

---

## Group L: Mobile-Specific

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

## Group M: Plugin Lifecycle

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

## Group N: Obsidian Community Plugin Compliance

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

## Group O: Binary File Support

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
