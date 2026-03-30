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

**Group index:**

| Group | Concern | Prefix |
|-------|---------|--------|
| A | Settings & Connection | TC-SET |
| B | First Sync | TC-FSYNC |
| C | Pull (Remote → Local) | TC-PULL |
| D | Push (Local → Remote) | TC-PUSH |
| E | Bidirectional Sync | TC-BIDI |
| F | Conflict Resolution | TC-CONF |
| G | Rename Detection | TC-REN |
| H | File History | TC-HIST |
| I | Sync Folder | TC-SFLD |
| J | Exclude Patterns & Filters | TC-FILT |
| K | Auto-Sync | TC-AUTO |
| L | Remote Pull Check | TC-RPULL |
| M | Crash Recovery | TC-CRASH |
| N | Large & Binary Files | TC-FILE |
| O | Share as Gist | TC-GIST |
| P | Vault Backup | TC-BACKUP |
| Q | Repository Dispatch | TC-DISPATCH |
| R | GitHub Pages Publishing | TC-PAGES |
| S | Sync Status Panel | TC-PANEL |
| T | Performance | TC-PERF |
| U | Guards & Error Handling | TC-GUARD |
| V | Mobile | TC-MOB |
| W | Plugin Lifecycle | TC-LIFE |
| X | Obsidian Compliance | TC-OBSDN |

> Groups Y–Z reserved for future features.

---

## Group A: Settings & Connection

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

## Group B: First Sync

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

### TC-FSYNC-007: First sync uses ZIP for large repo
**Priority:** P1
**Platform:** Both
**Preconditions:** syncFolder empty, remote repo with >5 files, total <100MB
**Steps:**
1. Fresh install, configure settings, sync
**Expected:** Sync completes. All remote files pulled. Debug log shows "ZIP pull started".

### TC-FSYNC-008: ZIP fallback to per-file on error
**Priority:** P1
**Platform:** Both
**Preconditions:** syncFolder empty, >5 remote files
**Steps:**
1. Simulate ZIP download failure (e.g. network drop during download)
**Expected:** Sync still completes via per-file fallback. Warning in log.

### TC-FSYNC-009: Subfolder sync uses per-file (not ZIP)
**Priority:** P1
**Platform:** Both
**Preconditions:** syncFolder = "docs", >5 remote files
**Steps:**
1. Sync
**Expected:** Files pulled individually. No ZIP download attempt.

### TC-FSYNC-010: First sync — identical files on both sides
**Priority:** P0
**Platform:** Both
**Preconditions:** Fresh plugin install (no sync state), vault has `note.md`, repo has `note.md` with same content
**Steps:**
1. Sync
**Expected:** No conflicts. File is cached. No pull or push for `note.md`. Other unique files sync normally.

### TC-FSYNC-011: First sync — different files on both sides
**Priority:** P0
**Platform:** Both
**Preconditions:** Fresh plugin install, vault has `note.md` with "local", repo has `note.md` with "remote"
**Steps:**
1. Sync
**Expected:** `note.md` is a conflict. Conflict strategy applies (skip/local-wins/remote-wins/ask).

### TC-FSYNC-012: First sync — mixed files
**Priority:** P1
**Platform:** Both
**Preconditions:** Fresh plugin install. Vault: `shared.md`, `local-only.md`. Repo: `shared.md` (same content), `remote-only.md`
**Steps:**
1. Sync
**Expected:** `shared.md` cached (no conflict). `local-only.md` pushed. `remote-only.md` pulled.

---

## Group C: Pull (Remote → Local)

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

## Group D: Push (Local → Remote)

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

## Group E: Bidirectional Sync

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

## Group F: Conflict Resolution

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

### TC-CONF-013: Ask strategy — per-hunk accept/reject in diff view
**Priority:** P1
**Platform:** Both
**Preconditions:** Conflict strategy = "Ask", `shared.md` synced
**Steps:**
1. Edit `shared.md` locally: change line 2, keep line 5
2. Edit `shared.md` on GitHub: keep line 2, change line 5
3. Sync — modal appears
4. Click on `shared.md` to expand inline diff view
5. Verify color-coded changes (red = removed, green = added) with line numbers
6. Click "Local" on the first hunk (line 2 change)
7. Click "Remote" on the second hunk (line 5 change)
8. Click "Resolve"
**Expected:** Merged result contains local line 2 and remote line 5. File pushed to GitHub with merged content.

---

## Group G: Rename Detection

### TC-REN-001: Local rename detected
**Priority:** P1
**Platform:** Both
**Preconditions:** `notes/old-name.md` synced
**Steps:**
1. Rename `old-name.md` → `new-name.md` in vault
2. Sync
**Expected:** Notice shows "1 renamed". Push contains delete(old) + addition(new).

### TC-REN-002: Remote rename detected
**Priority:** P1
**Platform:** Both
**Preconditions:** `doc.md` synced
**Steps:**
1. Rename `doc.md` → `renamed-doc.md` on GitHub
2. Sync
**Expected:** Local file renamed. Notice shows "1 renamed".

### TC-REN-003: Rename + different content is NOT a rename
**Priority:** P1
**Platform:** Both
**Preconditions:** `file.md` synced
**Steps:**
1. Delete `file.md`, create `newfile.md` with different content
2. Sync
**Expected:** Treated as separate delete + create. Notice shows pushed/pulled counts, no "renamed".

---

## Group H: File History

### TC-HIST-001: File history shows commits for synced file
**Priority:** P1
**Platform:** Both
**Preconditions:** `note.md` synced with at least 1 push
**Steps:**
1. Open `note.md`
2. Run command "Show file history"
**Expected:** Modal opens with commit list. Each entry shows message, author, date. Click opens GitHub.

### TC-HIST-002: File history — no commits
**Priority:** P1
**Platform:** Both
**Preconditions:** New file never pushed
**Steps:**
1. Create `brand-new.md`, open it
2. Run command "Show file history"
**Expected:** Modal shows "No commits found for this file"

### TC-HIST-003: File history — Load more
**Priority:** P1
**Platform:** Both
**Preconditions:** File with >20 commits
**Steps:**
1. Open file, run "Show file history"
2. Scroll to bottom, click "Load more"
**Expected:** Next 20 commits appended. Button hidden when no more.

---

## Group I: Sync Folder

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

## Group J: Exclude Patterns & Filters

### TC-FILT-001: Custom exclude pattern prevents sync
**Priority:** P1
**Platform:** Both
**Preconditions:** Settings → Exclude patterns = "drafts/**"
**Steps:**
1. Create `drafts/note.md` in vault
2. Sync
**Expected:** `drafts/note.md` is NOT pushed to GitHub.

### TC-FILT-002: Custom exclude pattern with extension
**Priority:** P1
**Platform:** Both
**Preconditions:** Settings → Exclude patterns = "*.pdf"
**Steps:**
1. Create `report.pdf` in vault
2. Sync
**Expected:** `report.pdf` is NOT pushed. Other files sync normally.

### TC-FILT-003: Hardcoded excludes still work with custom patterns
**Priority:** P1
**Platform:** Both
**Preconditions:** Settings → Exclude patterns = "drafts/**"
**Steps:**
1. Sync
**Expected:** `.obsidian/`, `.trash/`, `ghvault.log` still excluded. `drafts/` also excluded.

### TC-FILT-004: Frontmatter ghvault-sync: false excludes file
**Priority:** P1
**Platform:** Both
**Preconditions:** Initial sync complete
**Steps:**
1. Create `private-note.md` with frontmatter `ghvault-sync: false`
2. Sync
**Expected:** `private-note.md` is NOT pushed to GitHub. Other files sync normally.

### TC-FILT-005: Removing ghvault-sync: false re-includes file
**Priority:** P1
**Platform:** Both
**Preconditions:** `private-note.md` with `ghvault-sync: false` exists, not on GitHub
**Steps:**
1. Remove the `ghvault-sync: false` line from frontmatter
2. Sync
**Expected:** File is now pushed to GitHub.

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

## Group L: Remote Pull Check

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

### TC-RPULL-004: No sync when remote unchanged (ETag caching)
**Priority:** P1
**Platform:** Both
**Preconditions:** Auto-sync enabled, pull interval = 30s, vault and repo in sync
**Steps:**
1. Wait 2+ minutes without any changes
2. Check log file (debug level)
**Expected:** No sync triggered. Log shows periodic ref checks returning 304 Not Modified (ETag cache hit — free, no rate limit cost).

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

## Group M: Crash Recovery

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

## Group N: Large & Binary Files

### TC-FILE-001: Pull PNG image from repo
**Priority:** P0
**Platform:** Both
**Preconditions:** Repo contains a PNG image (e.g., `screenshot.png`)
**Steps:**
1. Sync from empty vault
**Expected:** Image file appears in vault, opens correctly in Obsidian

### TC-FILE-002: Push local image to repo
**Priority:** P0
**Platform:** Both
**Preconditions:** Initial sync complete
**Steps:**
1. Add a PNG or JPEG image to vault
2. Sync
**Expected:** Image appears on GitHub, binary content intact (not corrupted)

### TC-FILE-003: Modify binary file remotely and pull
**Priority:** P1
**Platform:** Both
**Preconditions:** Image exists in both vault and repo
**Steps:**
1. Replace the image on GitHub (upload new version via web UI)
2. Sync in Obsidian
**Expected:** Local image updated to match remote version

### TC-FILE-004: PDF file round-trip
**Priority:** P1
**Platform:** Both
**Steps:**
1. Add a PDF file to vault
2. Sync (push)
3. Modify the PDF on GitHub
4. Sync again (pull)
**Expected:** PDF pushed and pulled correctly, readable after round-trip

### TC-FILE-005: Mixed sync — text and binary files together
**Priority:** P1
**Platform:** Both
**Preconditions:** Repo has both .md and .png files
**Steps:**
1. Add a new .md file and a new .png file locally
2. Add a new .md file and a new .png file on GitHub
3. Sync
**Expected:** All 4 files synced correctly in both directions

### TC-FILE-006: Binary file with null bytes in first 8KB
**Priority:** P2
**Platform:** Desktop
**Steps:**
1. Add a file that contains null bytes (e.g., compiled binary, .zip archive)
2. Sync
**Expected:** File detected as binary, pushed with correct encoding, pullable

### TC-FILE-007: File ~2MB synced via REST fallback
**Priority:** P1
**Platform:** Desktop
**Steps:**
1. Add a ~2MB markdown file to vault
2. Sync
**Expected:** File pushed successfully (uses REST blob fallback, not GraphQL)

### TC-FILE-008: File >50MB skipped
**Priority:** P2
**Platform:** Desktop
**Steps:**
1. Add a >50MB file to vault
2. Sync
**Expected:** File skipped, no crash, other files sync normally

---

## Group O: Share as Gist

### TC-GIST-001: Share note as secret gist via ribbon
**Priority:** P1
**Platform:** Both
**Preconditions:** Configured plugin with Gists (Read/Write) account permission on PAT
**Steps:**
1. Open a .md file in the editor
2. Click the "Share as Gist" ribbon icon (share icon)
3. Leave visibility as "Secret" (default)
4. Optionally edit description
5. Click "Share"
**Expected:** Notice "Gist URL copied to clipboard". URL is a valid gist.github.com link. Gist is secret (unlisted).

### TC-GIST-002: Share note as public gist
**Priority:** P1
**Platform:** Both
**Preconditions:** Same as TC-GIST-001
**Steps:**
1. Open a .md file
2. Click ribbon "Share as Gist"
3. Select "Public" radio button
4. Click "Share"
**Expected:** Gist created as public. URL copied to clipboard. Gist visible at gist.github.com.

### TC-GIST-003: Share via context menu (right-click)
**Priority:** P1
**Platform:** Desktop
**Steps:**
1. Right-click on a .md file in the file explorer
2. Select "Share as Gist"
**Expected:** Gist modal opens with correct file name and path.

### TC-GIST-004: Share via command palette
**Priority:** P1
**Platform:** Both
**Steps:**
1. Open a .md file
2. Open command palette (Ctrl/Cmd+P)
3. Search "GHVault: Share note as Gist"
4. Execute command
**Expected:** Gist modal opens.

### TC-GIST-005: Share not available for non-md files
**Priority:** P1
**Platform:** Both
**Steps:**
1. Open a non-markdown file (image, PDF, etc.) or have no file open
2. Click ribbon "Share as Gist"
**Expected:** Notice "Open a markdown file to share as Gist". No modal opens.

### TC-GIST-006: Share with missing gist scope
**Priority:** P0
**Platform:** Both
**Preconditions:** PAT without Gists permission
**Steps:**
1. Open a .md file
2. Share as Gist
**Expected:** Notice "Token missing gist scope. Add 'gists' permission to your PAT." No gist created.

### TC-GIST-007: Share file >1MB
**Priority:** P2
**Platform:** Both
**Steps:**
1. Create a .md file larger than 1MB
2. Try to share as Gist
**Expected:** Notice "File too large for Gist (max 1MB)". No modal opens.

### TC-GIST-008: Manage gists — view shared gists
**Priority:** P1
**Platform:** Both
**Preconditions:** At least one gist previously shared
**Steps:**
1. Click ribbon "Manage shared gists" (list icon)
**Expected:** Manager modal opens showing all shared gists with file paths, descriptions, visibility badges, and action buttons.

### TC-GIST-009: Manage gists — copy URL
**Priority:** P1
**Platform:** Both
**Steps:**
1. Open Manage shared gists
2. Click "Copy URL" on an entry
**Expected:** URL copied to clipboard. Notice confirms.

### TC-GIST-010: Manage gists — update content
**Priority:** P1
**Platform:** Both
**Steps:**
1. Edit the local file that was previously shared
2. Open Manage shared gists
3. Click "Update" on the entry
**Expected:** Gist content updated on GitHub. Notice "Gist updated". Timestamp refreshes in modal.

### TC-GIST-011: Manage gists — delete gist
**Priority:** P1
**Platform:** Both
**Steps:**
1. Open Manage shared gists
2. Click "Delete" on an entry
**Expected:** Gist deleted from GitHub. Entry removed from manager. Notice "Gist deleted".

### TC-GIST-012: Manage gists — empty state
**Priority:** P2
**Platform:** Both
**Steps:**
1. Open Manage shared gists with no gists shared
**Expected:** Shows "No gists shared yet." message.

### TC-GIST-013: Update existing gist (re-share same file)
**Priority:** P1
**Platform:** Both
**Steps:**
1. Share a file as Gist
2. Edit the file
3. Share the same file again via ribbon/command
**Expected:** Modal shows "Update Gist" title. Clicking "Update" refreshes the existing gist (same URL), not creates a new one.

---

## Group P: Vault Backup

### TC-BACKUP-001: Backup vault via ribbon
**Priority:** P0
**Platform:** Both
**Preconditions:** Configured plugin with Contents: R/W permission on PAT
**Steps:**
1. Click the "Backup vault" ribbon icon (archive icon)
2. Wait for backup to complete
**Expected:** Notice "Backup created (N files) — URL copied to clipboard". Release visible on GitHub Releases page with tag `backup-YYYY-MM-DD-HHmmss`.

### TC-BACKUP-002: Backup vault via command palette
**Priority:** P1
**Platform:** Both
**Steps:**
1. Open command palette (Ctrl/Cmd+P)
2. Search "GHVault: Backup vault"
3. Execute command
**Expected:** Same as TC-BACKUP-001.

### TC-BACKUP-003: Backup without settings configured
**Priority:** P0
**Platform:** Both
**Preconditions:** Token, owner, or repo is empty
**Steps:**
1. Click "Backup vault" ribbon icon
**Expected:** Notice: "Configure settings first (token, owner, repo)"

### TC-BACKUP-004: Manage backups — view list
**Priority:** P1
**Platform:** Both
**Preconditions:** At least one vault backup exists
**Steps:**
1. Click "Manage backups" ribbon icon (history icon)
**Expected:** Modal opens showing list of backups with tag name, date, size. Each entry has [Copy URL], [Restore], [Delete] buttons.

### TC-BACKUP-005: Manage backups — empty state
**Priority:** P1
**Platform:** Both
**Preconditions:** No backup releases exist
**Steps:**
1. Click "Manage backups" ribbon icon
**Expected:** Modal opens showing "No backups yet." message.

### TC-BACKUP-006: Restore from backup
**Priority:** P0
**Platform:** Both
**Preconditions:** At least one vault backup exists
**Steps:**
1. Open Manage backups
2. Click "Restore" on a backup entry
3. Confirmation dialog appears: "This will overwrite all current vault files. Continue?"
4. Click "Restore"
**Expected:** All files from the backup ZIP are written to vault. Notice: "Restored N files from backup".

### TC-BACKUP-007: Delete backup
**Priority:** P1
**Platform:** Both
**Preconditions:** At least one vault backup exists
**Steps:**
1. Open Manage backups
2. Click "Delete" on a backup entry
**Expected:** Release deleted from GitHub. Entry removed from list. Notice: "Backup deleted".

### TC-BACKUP-008: Vault too large for backup
**Priority:** P2
**Platform:** Both
**Preconditions:** Vault total file size exceeds 500MB
**Steps:**
1. Click "Backup vault"
**Expected:** Notice: "Vault too large for backup (NMB, max 500MB)". No release created.

### TC-BACKUP-009: Open backup manager, close, reopen shows backups
**Priority:** P1
**Platform:** Both
**Preconditions:** At least one vault backup exists
**Steps:**
1. Open Manage Backups
2. Verify backup list loads correctly
3. Close the modal
4. Reopen Manage Backups
**Expected:** Backup list loads correctly both times, no errors.

### TC-BACKUP-010: Backup manager handles API error gracefully
**Priority:** P1
**Platform:** Both
**Preconditions:** Invalid or missing GitHub token
**Steps:**
1. Try to open Manage Backups with invalid/missing token
**Expected:** Shows error message with Retry button, not empty list or crash.

### TC-BACKUP-011: ETag caching works for repeated backup list opens
**Priority:** P2
**Platform:** Both
**Preconditions:** At least one vault backup exists
**Steps:**
1. Open Manage Backups
2. Close the modal
3. Open Manage Backups again quickly
**Expected:** Second open uses cached data (fast), no "Unexpected end of JSON" error.

### TC-BACKUP-012: Backup creation shows confirmation with correct size
**Priority:** P1
**Platform:** Both
**Preconditions:** Vault with files of various sizes
**Steps:**
1. Click "Backup vault" with files of various sizes
**Expected:** Confirmation dialog shows correct file count and size (KB for small, MB for large).

---

## Group Q: Repository Dispatch

### TC-DISPATCH-001: Dispatch fires after successful push
**Priority:** P1
**Platform:** Both
**Preconditions:** Token with Contents R/W, repo with a workflow listening for `repository_dispatch: types: [vault-synced]`
**Steps:**
1. Enable "Trigger workflow on push" in settings
2. Set event type to "vault-synced"
3. Create or modify a note
4. Run GHVault: Sync
**Expected:** Push succeeds, no error notice. Repo → Actions tab shows workflow triggered by `repository_dispatch`.

### TC-DISPATCH-002: Dispatch failure does not block sync
**Priority:** P1
**Platform:** Both
**Preconditions:** Dispatch enabled, but token lacks permissions or event type is invalid
**Steps:**
1. Enable dispatch with an event type that has no matching workflow
2. Modify a note and sync
**Expected:** Sync completes successfully. Notice says "Synced — N pulled, N pushed". Log shows "Repository dispatch failed" warning but no error notice.

### TC-DISPATCH-003: Event type field hidden when toggle is off
**Priority:** P2
**Platform:** Both
**Preconditions:** Plugin configured
**Steps:**
1. Open settings → Integrations
2. Verify "Event type" field is hidden when toggle is off
3. Turn on "Trigger workflow on push"
**Expected:** Event type field appears. Default value: "vault-synced".

### TC-DISPATCH-004: Dispatch sends correct payload
**Priority:** P2
**Platform:** Desktop
**Preconditions:** Dispatch enabled, workflow that logs `github.event.client_payload`
**Steps:**
1. Push a file via sync
2. Check workflow run logs for payload
**Expected:** Payload contains `branch`, `pushed` (array of pushed file paths), `deleted` (array), `commitOid` (SHA string).

---

## Group R: GitHub Pages Publishing

### TC-PAGES-001: Publishing settings appear when toggle enabled
**Priority:** P0
**Platform:** Both
**Preconditions:** Plugin configured
**Steps:**
1. Open settings → Publishing
2. Turn on "Publish to GitHub Pages"
**Expected:** SSG dropdown, "Generate workflow" button, and "Enable GitHub Pages" link appear. Dispatch toggle in Integrations is auto-enabled.

### TC-PAGES-002: Generate workflow creates file in repo
**Priority:** P0
**Platform:** Both
**Preconditions:** Publishing enabled, SSG set to Quartz, valid token with Contents R/W
**Steps:**
1. Click "Generate" button
2. Wait for "Done ✓"
3. Check repo on GitHub → `.github/workflows/deploy.yml`
**Expected:** File exists with Quartz build steps, `repository_dispatch` trigger, and `ghvault-publish: false` exclusion step.

### TC-PAGES-003: Generate workflow for each SSG
**Priority:** P1
**Platform:** Both
**Preconditions:** Publishing enabled
**Steps:**
1. Select Quartz → Generate → verify workflow mentions `npx quartz build`
2. Select MkDocs → Generate → verify workflow mentions `mkdocs build`
3. Select Hugo → Generate → verify workflow mentions `hugo --minify`
4. Select Jekyll → verify Generate button is hidden
**Expected:** Each SSG produces correct workflow. Jekyll shows no Generate button.

### TC-PAGES-004: Enable GitHub Pages link opens repo settings
**Priority:** P1
**Platform:** Both
**Preconditions:** Publishing enabled, owner and repo configured
**Steps:**
1. Open settings → Publishing → "Enable GitHub Pages"
2. Click "Open repo settings →" link
**Expected:** Browser opens `https://github.com/{owner}/{repo}/settings/pages`. User can manually set Source to "GitHub Actions".

### TC-PAGES-005: Generate workflow overwrites existing file
**Priority:** P1
**Platform:** Both
**Preconditions:** `.github/workflows/deploy.yml` already exists in repo
**Steps:**
1. Change SSG from Quartz to Hugo
2. Click "Generate"
**Expected:** Existing file is overwritten with Hugo template. No 409 conflict error.

### TC-PAGES-006: ghvault-publish: false excludes note from build
**Priority:** P1
**Platform:** Both
**Preconditions:** Pages publishing active, site building successfully
**Steps:**
1. Create a note with `ghvault-publish: false` in frontmatter
2. Sync → wait for workflow to build
3. Check published site
**Expected:** Note content does not appear on the site. File exists in repo but is excluded during build.

### TC-PAGES-007: Full publish flow — edit to live site
**Priority:** P0
**Platform:** Both
**Preconditions:** Pages enabled, workflow generated, dispatch enabled
**Steps:**
1. Create a new note "Hello World"
2. Run GHVault: Sync
3. Wait for Actions workflow to complete
4. Visit the Pages URL
**Expected:** Note appears on the published site within a few minutes.

### TC-PAGES-008: Jekyll uses legacy build (no workflow)
**Priority:** P2
**Platform:** Both
**Preconditions:** Publishing enabled, SSG set to Jekyll
**Steps:**
1. Select Jekyll as SSG
2. Verify Generate button is hidden
3. Click "Enable" for Pages
**Expected:** Pages enabled with `build_type: "legacy"`. GitHub auto-builds with Jekyll. No workflow file needed.

---

## Group S: Sync Status Panel

### TC-PANEL-001: Panel opens from command palette
**Priority:** P1
**Platform:** Both
**Steps:**
1. Open command palette (Ctrl/Cmd+P)
2. Search "GHVault: Show sync status"
3. Execute command
**Expected:** Sidebar panel opens on the right side, showing file status list.

### TC-PANEL-002: Panel shows file categories
**Priority:** P1
**Platform:** Both
**Preconditions:** Vault has synced files, one pending local change, one conflict
**Steps:**
1. Open sync status panel
**Expected:** Files categorized by status: conflicts, pending changes, untracked, synced. Each section shows file count.

### TC-PANEL-003: Panel updates after sync
**Priority:** P1
**Platform:** Both
**Preconditions:** Panel open, one file pending push
**Steps:**
1. Run sync
2. Observe panel
**Expected:** Pending file moves from "pending" to "synced" section after sync completes.

### TC-PANEL-004: Panel shows correct state after conflict
**Priority:** P2
**Platform:** Both
**Preconditions:** Panel open, conflict strategy = "Skip"
**Steps:**
1. Create a conflict (edit same file locally and on GitHub)
2. Sync
3. Observe panel
**Expected:** Conflicted file appears in "conflicts" section.

---

## Group T: Performance

### TC-PERF-001: First sync with 100+ files completes
**Priority:** P1
**Platform:** Both
**Preconditions:** Empty vault, remote repo with 100+ files, syncFolder empty
**Steps:**
1. Sync
**Expected:** All files pulled. No timeout. Debug log shows ZIP or parallel download.

### TC-PERF-002: Push 50+ changed files
**Priority:** P1
**Platform:** Both
**Preconditions:** 50+ local files changed since last sync
**Steps:**
1. Sync
**Expected:** Push completes. If chunked, log shows "Push chunked: N chunks".

---

## Group U: Guards & Error Handling

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

## Group V: Mobile

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

## Group W: Plugin Lifecycle

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

## Group X: Obsidian Compliance

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
