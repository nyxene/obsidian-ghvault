# 186 — Diff View for Conflicts

**Issue:** #186
**Date:** 2026-03-22
**Status:** APPROVED
**Branch:** `feat/186-diff-view-conflicts`

---

## Objective

Add inline unified diff view to the conflict resolution modal. When the user clicks on a conflicted file, show a color-coded diff of local vs remote content. Currently the modal only shows file path and change type — the user has no way to see what actually changed before deciding.

---

## Background

### Current conflict modal

```
┌─────────────────────────────────────────┐
│ Resolve conflicts (2 files)             │
├─────────┬──────┬────────┬───────────────┤
│ File    │Local │Remote  │Action         │
├─────────┼──────┼────────┼───────────────┤
│ note.md │modify│modify  │[Local][Remote]│
│ todo.md │modify│delete  │[Local][Remote]│
├─────────┴──────┴────────┴───────────────┤
│                    [Skip All] [Resolve] │
└─────────────────────────────────────────┘
```

### Proposed UX

Click on a file row → unified diff expands below it:

```
┌─────────────────────────────────────────┐
│ ▼ note.md │modify│modify│[Local][Remote]│
├─────────────────────────────────────────┤
│   # Meeting Notes                       │   (no background)
│ - Action items:                         │   (red background)
│ + Action items (updated):               │   (green background)
│   - Buy groceries                       │   (no background)
│ + - Call dentist                         │   (green background)
├─────────────────────────────────────────┤
│ ▶ todo.md │modify│delete│[Local][Remote]│
└─────────────────────────────────────────┘
```

- **Red background** (`--background-modifier-error`) — removed lines (local version)
- **Green background** (`--background-modifier-success`) — added lines (remote version)
- **No background** — unchanged lines
- Monospace font, max-height with scroll
- Unified diff — one column, works on desktop and mobile

### Constraints

- No external diff libraries — keep bundle small (currently 68kb)
- Must work on mobile (iOS/Android) — single column layout
- Only text files can be diffed — binary files show info message
- Remote content fetched on-demand (only when user clicks to expand)
- Remote content cached in memory — no re-fetch on collapse/expand
- Remote content arrives BASE64-encoded from GitHub API — must decode

---

## Scope

| File | Changes |
|------|---------|
| `src/ui/diff.ts` | New: `computeDiff()` LCS-based line diff algorithm |
| `src/ui/diff.test.ts` | New: unit tests for diff algorithm |
| `src/ui/conflict-modal.ts` | Expandable rows, diff panel, content fetching, caching |
| `src/ui/conflict-modal.test.ts` | Tests for expand/collapse, diff rendering, edge cases |
| `src/types.ts` | Add `ConflictContentProvider` interface |
| `src/sync/engine.ts` | Update `onConflict` callback to include content provider |
| `src/main.ts` | Construct content provider, pass to modal |

---

## Approach

### Simple line-based diff algorithm (`src/ui/diff.ts`)

LCS-based (longest common subsequence):

1. Split both texts by `\n`
2. Build LCS table O(n*m)
3. Backtrack to produce diff output
4. Lines in LCS = unchanged (`same`), lines only in local = removed (`remove`), lines only in remote = added (`add`)

For typical markdown files (<1000 lines) this is instant.

```typescript
export interface DiffLine {
  type: "same" | "add" | "remove";
  text: string;
}

export function computeDiff(localText: string, remoteText: string): DiffLine[];
```

### Content provider interface (`src/types.ts`)

```typescript
export interface ConflictContentProvider {
  getLocalContent(path: string): Promise<string>;
  getRemoteContent(path: string): Promise<string>;
}
```

Passed to `ConflictModal` constructor — not through `onConflict` callback.

### Content provider construction (`main.ts`)

```typescript
const contentProvider: ConflictContentProvider = {
  getLocalContent: (path) => this.app.vault.read(
    this.app.vault.getFileByPath(path)!
  ),
  getRemoteContent: async (path) => {
    const repoPath = toRepoPath(path, this.settings.syncFolder);
    const file = await client.getFileContent(repoPath, this.settings.branch);
    // Decode BASE64 → string
    const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, "")), c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  },
};
```

### Updated `onConflict` signature (`engine.ts`)

```typescript
onConflict?: (
  conflicts: ConflictInfo[],
  contentProvider: ConflictContentProvider,
) => Promise<ConflictDecision[]>;
```

SyncEngine constructs the content provider from its vault + pullEngine:

```typescript
const contentProvider: ConflictContentProvider = {
  getLocalContent: (path) => this.vault.readFile(path),
  getRemoteContent: (path) => this.pullEngine.getRemoteFileContent(branch, path),
};
```

### ConflictModal changes

**Constructor:**
```typescript
constructor(app: App, conflicts: ConflictInfo[], contentProvider: ConflictContentProvider)
```

**Expandable rows:**
1. File row is clickable (cursor: pointer, hover highlight)
2. ▶ / ▼ indicator before file name
3. On click: if collapsed → expand (fetch content if not cached, show diff)
4. On click: if expanded → collapse
5. Accordion: expanding one row collapses the previously expanded

**Diff panel:**
- `<div>` below the file row, full grid width (colspan all 4 columns)
- Each diff line is a `<div>` with monospace font
- `remove` lines: red background, `- ` prefix
- `add` lines: green background, `+ ` prefix
- `same` lines: no background, `  ` prefix (two spaces for alignment)
- Max height: 300px with `overflow-y: auto`
- Padding: 8px

**Loading state:**
- "Loading diff..." text while fetching
- Replaced by diff content or error message

**Content cache:**
- `Map<string, { local: string; remote: string }>` in modal
- Populated on first expand per file
- Reused on subsequent expand (no re-fetch)

### Handling edge cases

| Case | Behavior |
|------|----------|
| modify vs modify | Unified diff with color highlighting |
| create vs create | Same as modify vs modify (both exist) |
| modify vs delete | Local content shown, "Deleted on remote" header |
| delete vs modify | Remote content shown, "Deleted locally" header |
| delete vs delete | "Both versions deleted" message |
| Binary file | "Binary file — cannot display diff" |
| Large file (>100KB) | "File too large for inline diff (>100KB)" |
| Fetch error | "Failed to load: [error message]" |

### Binary detection

Use existing `hasBinaryContent()` from `src/utils/binary.ts` — scans first 8KB for null bytes.

### Styling

All inline styles using `Object.assign(el.style, {...})` — consistent with current modal code. Colors via Obsidian CSS variables:

```
remove: background rgba(var(--background-modifier-error-rgb), 0.2)
add:    background rgba(var(--background-modifier-success-rgb), 0.2)
same:   background transparent
font:   var(--font-monospace)
```

Semi-transparent backgrounds ensure readability in both light and dark themes.

---

## Tasks

- [ ] Create `src/ui/diff.ts` — `computeDiff()` with LCS algorithm
- [ ] Unit tests: same content, insertions, deletions, mixed changes, empty strings, single line
- [ ] Add `ConflictContentProvider` interface to `src/types.ts`
- [ ] Update `SyncEngine.onConflict` callback signature
- [ ] Construct content provider in `SyncEngine.executeSyncCycle()`
- [ ] Update `showConflictModal()` in `main.ts` — pass content provider
- [ ] Update `ConflictModal` constructor — accept content provider
- [ ] Add expandable rows with ▶/▼ indicators
- [ ] Implement diff panel rendering with unified color-coded lines
- [ ] Add content cache in modal (`Map<string, { local, remote }>`)
- [ ] Handle loading state ("Loading diff...")
- [ ] Handle binary files (detect via `hasBinaryContent()`)
- [ ] Handle large files (>100KB cap)
- [ ] Handle delete scenarios (modify vs delete, delete vs modify)
- [ ] Handle fetch errors gracefully
- [ ] Unit tests: expand/collapse, loading state, cached content
- [ ] Unit tests: binary file, large file, delete scenarios, fetch error
- [ ] Update E2E test expectations (modal now has expandable rows)

---

## Edge Cases

- User clicks "Keep Local" before diff loads → decision still works (diff is informational only)
- User closes modal while diff is loading → promise resolved as skip, no crash
- Multiple rapid expand/collapse clicks → latest state wins, loading cancelled
- Remote content fetch fails (network) → error message shown, decision not blocked
- Empty file (0 bytes) → empty diff panel
- File with only whitespace changes → diff shows whitespace differences
- Very long lines → `word-break: break-all` in monospace container

---

## Risks

| Risk | Mitigation |
|------|-----------|
| LCS too slow for large files | Cap at 100KB, show message |
| Bundle size increase | ~50-100 lines of code, <0.5kb minified |
| Content fetch latency | On-demand + cache, loading indicator |
| Dark/light theme colors | Semi-transparent backgrounds via CSS variables |

---

## Out of Scope

- Side-by-side (two-column) diff layout
- Word-level diff highlighting within lines
- Three-way merge (base + local + remote)
- Inline editing in diff view
- Syntax highlighting in diff panel

---

*Mobilis in Mobili*
