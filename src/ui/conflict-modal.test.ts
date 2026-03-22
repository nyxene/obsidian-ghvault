import { describe, expect, it, vi } from "vitest";
import type { ConflictContentProvider, ConflictInfo } from "../types";

// ---------------------------------------------------------------------------
// Mock Obsidian Modal
// ---------------------------------------------------------------------------

interface MockElement {
	tag: string;
	text?: string;
	textContent: string;
	cls?: string;
	children: MockElement[];
	parent: MockElement | null;
	nextSibling: MockElement | null;
	listeners: Record<string, (() => void)[]>;
	classes: Set<string>;
	disabled: boolean;
	style: Record<string, string>;
	createEl(tag: string, opts?: { text?: string; cls?: string }): MockElement;
	addEventListener(event: string, handler: () => void): void;
	addClass(cls: string): void;
	removeClass(cls: string): void;
	setText(text: string): void;
	empty(): void;
	after(el: MockElement): void;
	remove(): void;
	querySelectorAll(selector: string): MockElement[];
	querySelector(selector: string): MockElement | null;
	closest(selector: string): MockElement | null;
}

function matchesSelector(el: MockElement, selector: string): boolean {
	// Simple selector matching for class selectors and tag selectors
	if (selector.startsWith(".")) {
		const cls = selector.slice(1);
		return el.classes.has(cls) || el.cls === cls;
	}
	// Handle "span:nth-child(2)" style selectors
	const nthMatch = selector.match(/^(\w+):nth-child\((\d+)\)$/);
	if (nthMatch) {
		const [, tagName, nStr] = nthMatch;
		if (el.tag !== tagName) return false;
		const n = Number.parseInt(nStr, 10);
		if (!el.parent) return false;
		const sameTagChildren = el.parent.children.filter((c) => c.tag === tagName);
		return sameTagChildren.indexOf(el) === n - 1;
	}
	// Plain tag selector
	if (/^\w+$/.test(selector)) {
		return el.tag === selector;
	}
	return false;
}

function querySelectorAllDeep(root: MockElement, selector: string): MockElement[] {
	const results: MockElement[] = [];
	for (const child of root.children) {
		if (matchesSelector(child, selector)) results.push(child);
		results.push(...querySelectorAllDeep(child, selector));
	}
	return results;
}

function createMockElement(tag: string, opts?: { text?: string; cls?: string }): MockElement {
	const el: MockElement = {
		tag,
		text: opts?.text,
		textContent: opts?.text ?? "",
		cls: opts?.cls,
		children: [],
		parent: null,
		nextSibling: null,
		listeners: {},
		classes: new Set(opts?.cls ? [opts.cls] : []),
		disabled: false,
		style: {},
		createEl(childTag: string, childOpts?: { text?: string; cls?: string }): MockElement {
			const child = createMockElement(childTag, childOpts);
			child.parent = this as MockElement;
			// Update sibling links
			if (this.children.length > 0) {
				this.children[this.children.length - 1].nextSibling = child;
			}
			this.children.push(child);
			return child;
		},
		addEventListener(event: string, handler: () => void): void {
			if (!this.listeners[event]) this.listeners[event] = [];
			this.listeners[event].push(handler);
		},
		addClass(cls: string): void {
			this.classes.add(cls);
		},
		removeClass(cls: string): void {
			this.classes.delete(cls);
		},
		setText(text: string): void {
			this.text = text;
			this.textContent = text;
		},
		empty(): void {
			this.children = [];
			this.text = undefined;
			this.textContent = "";
		},
		after(newEl: MockElement): void {
			const p = this.parent;
			if (!p) return;
			// Remove from current parent first (move semantics)
			if (newEl.parent) {
				const oldIdx = newEl.parent.children.indexOf(newEl);
				if (oldIdx !== -1) newEl.parent.children.splice(oldIdx, 1);
			}
			const idx = p.children.indexOf(this as MockElement);
			if (idx === -1) return;
			newEl.parent = p;
			p.children.splice(idx + 1, 0, newEl);
			// Update sibling links
			(this as MockElement).nextSibling = newEl;
			newEl.nextSibling = p.children[idx + 2] ?? null;
		},
		remove(): void {
			const p = this.parent;
			if (!p) return;
			const idx = p.children.indexOf(this as MockElement);
			if (idx !== -1) {
				p.children.splice(idx, 1);
				// Update sibling links
				if (idx > 0) {
					p.children[idx - 1].nextSibling = p.children[idx] ?? null;
				}
			}
			this.parent = null;
		},
		querySelectorAll(selector: string): MockElement[] {
			return querySelectorAllDeep(this as MockElement, selector);
		},
		querySelector(selector: string): MockElement | null {
			const results = querySelectorAllDeep(this as MockElement, selector);
			return results[0] ?? null;
		},
		closest(selector: string): MockElement | null {
			let current: MockElement | null = this as MockElement;
			while (current) {
				if (matchesSelector(current, selector)) return current;
				current = current.parent;
			}
			return null;
		},
	};
	return el;
}

vi.mock("obsidian", () => ({
	Modal: class MockModal {
		app: unknown;
		contentEl: MockElement;
		constructor(app: unknown) {
			this.app = app;
			this.contentEl = createMockElement("div");
		}
		open(): void {}
		close(): void {}
	},
}));

import { ConflictModal } from "./conflict-modal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findByText(root: MockElement, text: string): MockElement | undefined {
	if (root.text === text) return root;
	for (const child of root.children) {
		const found = findByText(child, text);
		if (found) return found;
	}
	return undefined;
}

function findByCls(root: MockElement, cls: string): MockElement[] {
	const results: MockElement[] = [];
	if (root.cls === cls || root.classes.has(cls)) results.push(root);
	for (const child of root.children) {
		results.push(...findByCls(child, cls));
	}
	return results;
}

function click(el: MockElement): void {
	for (const handler of el.listeners.click ?? []) {
		handler();
	}
}

const twoConflicts: ConflictInfo[] = [
	{ path: "a.md", localChange: "modify", remoteChange: "modify" },
	{ path: "b.md", localChange: "create", remoteChange: "delete" },
];

const mockContentProvider: ConflictContentProvider = {
	getLocalContent: vi.fn().mockResolvedValue("local content"),
	getRemoteContent: vi.fn().mockResolvedValue("remote content"),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConflictModal", () => {
	it("renders heading with file count", () => {
		const modal = new ConflictModal({} as never, twoConflicts, mockContentProvider);
		modal.onOpen();

		const heading = findByText(
			modal.contentEl as unknown as MockElement,
			"Resolve conflicts (2 files)",
		);
		expect(heading).toBeDefined();
	});

	it("renders singular heading for 1 conflict", () => {
		const modal = new ConflictModal({} as never, [twoConflicts[0]], mockContentProvider);
		modal.onOpen();

		const heading = findByText(
			modal.contentEl as unknown as MockElement,
			"Resolve conflicts (1 file)",
		);
		expect(heading).toBeDefined();
	});

	it("renders cells for each conflict", () => {
		const modal = new ConflictModal({} as never, twoConflicts, mockContentProvider);
		modal.onOpen();

		// Each conflict produces 4 grid cells (path, local, remote, action)
		// Plus 4 header cells = 12 total inside the grid container
		const actionCells = findByCls(
			modal.contentEl as unknown as MockElement,
			"ghvault-conflict-actions",
		);
		expect(actionCells).toHaveLength(2);
	});

	it("resolve button is initially disabled", () => {
		const modal = new ConflictModal({} as never, twoConflicts, mockContentProvider);
		modal.onOpen();

		const buttons = findByCls(modal.contentEl as unknown as MockElement, "mod-cta");
		expect(buttons).toHaveLength(1);
		expect(buttons[0].disabled).toBe(true);
	});

	it("resolve button enables when all conflicts have decisions", () => {
		const modal = new ConflictModal({} as never, twoConflicts, mockContentProvider);
		modal.onOpen();

		// Find Keep Local buttons for each conflict
		const keepLocalButtons = findByText(modal.contentEl as unknown as MockElement, "Keep Local");
		expect(keepLocalButtons).toBeDefined();

		// Click Keep Local for both conflicts
		const actionCells = findByCls(
			modal.contentEl as unknown as MockElement,
			"ghvault-conflict-actions",
		);
		expect(actionCells).toHaveLength(2);

		// Each action cell has two buttons: Keep Local and Keep Remote
		click(actionCells[0].children[0]); // Keep Local for a.md
		click(actionCells[1].children[1]); // Keep Remote for b.md

		const resolveBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta");
		expect(resolveBtn[0].disabled).toBe(false);
	});

	it("waitForDecisions resolves with decisions when Resolve is clicked", async () => {
		const modal = new ConflictModal({} as never, twoConflicts, mockContentProvider);
		modal.onOpen();

		const promise = modal.waitForDecisions();

		// Make decisions
		const actionCells = findByCls(
			modal.contentEl as unknown as MockElement,
			"ghvault-conflict-actions",
		);
		click(actionCells[0].children[0]); // Keep Local for a.md
		click(actionCells[1].children[1]); // Keep Remote for b.md

		// Click Resolve
		const resolveBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta")[0];
		click(resolveBtn);

		const decisions = await promise;
		expect(decisions).toEqual([
			{ path: "a.md", resolution: "local" },
			{ path: "b.md", resolution: "remote" },
		]);
	});

	it("waitForDecisions resolves with empty array when Skip All is clicked", async () => {
		const modal = new ConflictModal({} as never, twoConflicts, mockContentProvider);
		modal.onOpen();

		const promise = modal.waitForDecisions();

		const skipBtn = findByText(modal.contentEl as unknown as MockElement, "Skip All");
		expect(skipBtn).toBeDefined();
		click(skipBtn as MockElement);

		const decisions = await promise;
		expect(decisions).toEqual([]);
	});

	it("onClose resolves with empty array if not already resolved", async () => {
		const modal = new ConflictModal({} as never, twoConflicts, mockContentProvider);
		modal.onOpen();

		const promise = modal.waitForDecisions();
		modal.onClose();

		const decisions = await promise;
		expect(decisions).toEqual([]);
	});

	it("switching decision updates selected class", () => {
		const modal = new ConflictModal({} as never, [twoConflicts[0]], mockContentProvider);
		modal.onOpen();

		const actionCells = findByCls(
			modal.contentEl as unknown as MockElement,
			"ghvault-conflict-actions",
		);
		const localBtn = actionCells[0].children[0];
		const remoteBtn = actionCells[0].children[1];

		click(localBtn);
		expect(localBtn.classes.has("ghvault-conflict-selected")).toBe(true);
		expect(remoteBtn.classes.has("ghvault-conflict-selected")).toBe(false);

		click(remoteBtn);
		expect(localBtn.classes.has("ghvault-conflict-selected")).toBe(false);
		expect(remoteBtn.classes.has("ghvault-conflict-selected")).toBe(true);
	});

	it("resolve with partial decisions includes only decided files", async () => {
		const modal = new ConflictModal({} as never, twoConflicts, mockContentProvider);
		modal.onOpen();

		const promise = modal.waitForDecisions();

		// Only decide first conflict, leave second undecided
		const actionCells = findByCls(
			modal.contentEl as unknown as MockElement,
			"ghvault-conflict-actions",
		);
		click(actionCells[0].children[0]); // Keep Local for a.md

		// Resolve button should still be disabled (not all decided)
		const resolveBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta")[0];
		expect(resolveBtn.disabled).toBe(true);

		// Close modal — should resolve with empty (skip)
		modal.onClose();

		const decisions = await promise;
		expect(decisions).toEqual([]);
	});

	it("onClose after resolve does not double-resolve", async () => {
		const modal = new ConflictModal({} as never, [twoConflicts[0]], mockContentProvider);
		modal.onOpen();

		const promise = modal.waitForDecisions();

		// Decide and resolve
		const actionCells = findByCls(
			modal.contentEl as unknown as MockElement,
			"ghvault-conflict-actions",
		);
		click(actionCells[0].children[0]); // Keep Local
		const resolveBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta")[0];
		click(resolveBtn);

		const decisions = await promise;
		expect(decisions).toHaveLength(1);

		// Calling onClose again should be safe (no-op)
		modal.onClose();
	});

	// -----------------------------------------------------------------------
	// Diff view tests
	// -----------------------------------------------------------------------

	describe("diff view", () => {
		function createDiffConflict(): {
			conflict: ConflictInfo;
			provider: ConflictContentProvider;
		} {
			return {
				conflict: { path: "file.md", localChange: "modify", remoteChange: "modify" },
				provider: {
					getLocalContent: vi.fn().mockResolvedValue("line1\nline2\nline3"),
					getRemoteContent: vi.fn().mockResolvedValue("line1\nchanged\nline3"),
				},
			};
		}

		function getIndicator(modal: ConflictModal): MockElement {
			const pathCell = findByCls(
				modal.contentEl as unknown as MockElement,
				"ghvault-conflict-path",
			)[0];
			return pathCell.children[0]; // first span is the indicator
		}

		async function expandDiff(modal: ConflictModal): Promise<void> {
			const pathCell = findByCls(
				modal.contentEl as unknown as MockElement,
				"ghvault-conflict-path",
			)[0];
			click(pathCell);
			// Wait for async content loading
			await vi.waitFor(() => {
				const panels = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
				if (panels.length === 0) throw new Error("no panel yet");
				// Wait until the panel has real content (not "Loading diff...")
				if (panels[0].text === "Loading diff...") throw new Error("still loading");
			});
		}

		it("toggleDiff expands and shows diff panel with loading then content", async () => {
			const { conflict, provider } = createDiffConflict();
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			// Expand diff
			await expandDiff(modal);

			// Panel should exist
			const panels = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
			expect(panels).toHaveLength(1);

			// Indicator should be "down"
			const indicator = getIndicator(modal);
			expect(indicator.textContent).toBe("▼ ");

			// Panel should have hunk content
			const hunks = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-hunk");
			expect(hunks.length).toBeGreaterThanOrEqual(1);
		});

		it("toggleDiff collapse removes panel", async () => {
			const { conflict, provider } = createDiffConflict();
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			await expandDiff(modal);

			// Collapse by clicking again
			const pathCell = findByCls(
				modal.contentEl as unknown as MockElement,
				"ghvault-conflict-path",
			)[0];
			click(pathCell);

			const panels = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
			expect(panels).toHaveLength(0);

			// Indicator should be "right"
			const indicator = getIndicator(modal);
			expect(indicator.textContent).toBe("▶ ");
		});

		it("renderDiffContent shows diff lines with hunks", async () => {
			const { conflict, provider } = createDiffConflict();
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			await expandDiff(modal);

			// Should have hunk containers with diff lines
			const hunks = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-hunk");
			expect(hunks.length).toBeGreaterThanOrEqual(1);

			// Should have hunk header with @@ line range
			const headers = findByCls(
				modal.contentEl as unknown as MockElement,
				"ghvault-diff-hunk-header",
			);
			expect(headers.length).toBeGreaterThanOrEqual(1);

			// Should have per-hunk Local/Remote buttons
			const hunkBtns = findByCls(modal.contentEl as unknown as MockElement, "ghvault-hunk-btn");
			expect(hunkBtns.length).toBeGreaterThanOrEqual(2); // At least one pair
		});

		it("renderDiffContent shows 'Deleted locally' for delete conflicts", async () => {
			const conflict: ConflictInfo = {
				path: "deleted.md",
				localChange: "delete",
				remoteChange: "modify",
			};
			const provider: ConflictContentProvider = {
				getLocalContent: vi.fn().mockResolvedValue(""),
				getRemoteContent: vi.fn().mockResolvedValue("remote text here"),
			};
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			await expandDiff(modal);

			// Should show "Deleted locally" info message
			const panel = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel")[0];
			const infoMsg = findByText(panel, "Deleted locally — remote content:");
			expect(infoMsg).toBeDefined();
		});

		it("renderDiffContent shows 'Deleted on remote' for remote delete conflicts", async () => {
			const conflict: ConflictInfo = {
				path: "remote-del.md",
				localChange: "modify",
				remoteChange: "delete",
			};
			const provider: ConflictContentProvider = {
				getLocalContent: vi.fn().mockResolvedValue("local text here"),
				getRemoteContent: vi.fn().mockResolvedValue(""),
			};
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			await expandDiff(modal);

			const panel = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel")[0];
			const infoMsg = findByText(panel, "Deleted on remote — local content:");
			expect(infoMsg).toBeDefined();
		});

		it("renderDiffContent shows 'Both versions deleted' for double delete", async () => {
			const conflict: ConflictInfo = {
				path: "both-del.md",
				localChange: "delete",
				remoteChange: "delete",
			};
			const provider: ConflictContentProvider = {
				getLocalContent: vi.fn().mockResolvedValue(""),
				getRemoteContent: vi.fn().mockResolvedValue(""),
			};
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			const pathCell = findByCls(
				modal.contentEl as unknown as MockElement,
				"ghvault-conflict-path",
			)[0];
			click(pathCell);
			// No async wait needed — "both deleted" is handled synchronously
			await vi.waitFor(() => {
				const panels = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
				if (panels.length === 0) throw new Error("no panel yet");
			});

			const panel = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel")[0];
			expect(panel.textContent).toBe("Both versions deleted — no diff available.");
		});

		it("renderDiffContent shows error message when content fetch fails", async () => {
			const conflict: ConflictInfo = {
				path: "error.md",
				localChange: "modify",
				remoteChange: "modify",
			};
			const provider: ConflictContentProvider = {
				getLocalContent: vi.fn().mockRejectedValue(new Error("Network error")),
				getRemoteContent: vi.fn().mockResolvedValue("remote"),
			};
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			const pathCell = findByCls(
				modal.contentEl as unknown as MockElement,
				"ghvault-conflict-path",
			)[0];
			click(pathCell);
			await vi.waitFor(() => {
				const panels = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
				if (panels.length === 0) throw new Error("no panel yet");
				if (panels[0].textContent === "Loading diff...") throw new Error("still loading");
			});

			const panel = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel")[0];
			expect(panel.textContent).toContain("Failed to load:");
			expect(panel.textContent).toContain("Network error");
		});

		it("renderDiffContent shows 'Binary file' for binary content", async () => {
			// Content with null byte triggers binary detection
			const binaryContent = "hello\x00world";
			const conflict: ConflictInfo = {
				path: "img.bin",
				localChange: "modify",
				remoteChange: "modify",
			};
			const provider: ConflictContentProvider = {
				getLocalContent: vi.fn().mockResolvedValue(binaryContent),
				getRemoteContent: vi.fn().mockResolvedValue("remote"),
			};
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			await expandDiff(modal);

			const panel = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel")[0];
			expect(panel.textContent).toBe("Binary file — cannot display diff.");
		});

		it("renderDiffContent shows 'File too large' for >100KB", async () => {
			const largeContent = "x".repeat(101 * 1024);
			const conflict: ConflictInfo = {
				path: "large.md",
				localChange: "modify",
				remoteChange: "modify",
			};
			const provider: ConflictContentProvider = {
				getLocalContent: vi.fn().mockResolvedValue(largeContent),
				getRemoteContent: vi.fn().mockResolvedValue("remote"),
			};
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			await expandDiff(modal);

			const panel = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel")[0];
			expect(panel.textContent).toBe("File too large for inline diff (>100KB).");
		});

		it("renderDiffContent shows 'Files are identical' when no changes", async () => {
			const conflict: ConflictInfo = {
				path: "same.md",
				localChange: "modify",
				remoteChange: "modify",
			};
			const provider: ConflictContentProvider = {
				getLocalContent: vi.fn().mockResolvedValue("same content"),
				getRemoteContent: vi.fn().mockResolvedValue("same content"),
			};
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			await expandDiff(modal);

			const panel = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel")[0];
			expect(panel.textContent).toBe("Files are identical.");
		});

		it("setHunkDecision sets resolution to merged", async () => {
			const { conflict, provider } = createDiffConflict();
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			await expandDiff(modal);

			// Find hunk buttons and click "Local" for first hunk
			const hunkBtns = findByCls(modal.contentEl as unknown as MockElement, "ghvault-hunk-btn");
			// Click "Local" button (first of each pair)
			click(hunkBtns[0]);

			// Now resolve — the decision should be "merged"
			const promise = modal.waitForDecisions();
			const resolveBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta")[0];
			click(resolveBtn);
			const decisions = await promise;

			expect(decisions).toHaveLength(1);
			expect(decisions[0].resolution).toBe("merged");
			expect(decisions[0].mergedContent).toBeDefined();
		});

		it("buildAndResolve produces merged content from per-hunk decisions", async () => {
			const conflict: ConflictInfo = {
				path: "merge.md",
				localChange: "modify",
				remoteChange: "modify",
			};
			const provider: ConflictContentProvider = {
				getLocalContent: vi.fn().mockResolvedValue("line1\nlocal2\nline3"),
				getRemoteContent: vi.fn().mockResolvedValue("line1\nremote2\nline3"),
			};
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			await expandDiff(modal);

			// Select "Remote" for the hunk
			const hunkBtns = findByCls(modal.contentEl as unknown as MockElement, "ghvault-hunk-btn");
			// Second button of each pair is "Remote"
			click(hunkBtns[1]);

			const promise = modal.waitForDecisions();
			const resolveBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta")[0];
			click(resolveBtn);
			const decisions = await promise;

			expect(decisions).toHaveLength(1);
			expect(decisions[0].resolution).toBe("merged");
			// Merged content should include remote changes
			expect(decisions[0].mergedContent).toContain("remote2");
			expect(decisions[0].mergedContent).not.toContain("local2");
		});

		it("content is cached (second expand does not re-fetch)", async () => {
			const { conflict, provider } = createDiffConflict();
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			// Expand
			await expandDiff(modal);
			expect(provider.getLocalContent).toHaveBeenCalledTimes(1);
			expect(provider.getRemoteContent).toHaveBeenCalledTimes(1);

			// Collapse
			const pathCell = findByCls(
				modal.contentEl as unknown as MockElement,
				"ghvault-conflict-path",
			)[0];
			click(pathCell);

			// Expand again
			await expandDiff(modal);

			// Should NOT have fetched again (cached)
			expect(provider.getLocalContent).toHaveBeenCalledTimes(1);
			expect(provider.getRemoteContent).toHaveBeenCalledTimes(1);
		});

		it("accordion: expanding second file collapses first and uses findIndicator", async () => {
			const conflicts: ConflictInfo[] = [
				{ path: "a.md", localChange: "modify", remoteChange: "modify" },
				{ path: "b.md", localChange: "modify", remoteChange: "modify" },
			];
			const provider: ConflictContentProvider = {
				getLocalContent: vi.fn().mockResolvedValue("local"),
				getRemoteContent: vi.fn().mockResolvedValue("remote"),
			};
			const modal = new ConflictModal({} as never, conflicts, provider);
			modal.onOpen();

			// Expand first file
			const pathCells = findByCls(
				modal.contentEl as unknown as MockElement,
				"ghvault-conflict-path",
			);
			click(pathCells[0]);
			await vi.waitFor(() => {
				const panels = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
				if (panels.length === 0) throw new Error("no panel");
				if (panels[0].textContent === "Loading diff...") throw new Error("loading");
			});

			let panels = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
			expect(panels).toHaveLength(1);

			// First indicator should be down
			expect(pathCells[0].children[0].textContent).toBe("▼ ");

			// Expand second file — first should collapse
			click(pathCells[1]);
			await vi.waitFor(() => {
				const p = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
				if (p.length === 0) throw new Error("no panel");
				if (p[0].textContent === "Loading diff...") throw new Error("loading");
			});

			panels = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
			expect(panels).toHaveLength(1);

			// First indicator should be back to right, second should be down
			expect(pathCells[0].children[0].textContent).toBe("▶ ");
			expect(pathCells[1].children[0].textContent).toBe("▼ ");
		});

		it("buildAndResolve works when diffCache is empty (fallback computation)", async () => {
			const conflict: ConflictInfo = {
				path: "no-cache.md",
				localChange: "modify",
				remoteChange: "modify",
			};
			const provider: ConflictContentProvider = {
				getLocalContent: vi.fn().mockResolvedValue("line1\nold\nline3"),
				getRemoteContent: vi.fn().mockResolvedValue("line1\nnew\nline3"),
			};
			const modal = new ConflictModal({} as never, [conflict], provider);
			modal.onOpen();

			// Expand to populate content cache (but we'll clear diff cache)
			await expandDiff(modal);

			// Clear diff cache to force fallback in buildAndResolve
			// biome-ignore lint/suspicious/noExplicitAny: access private for testing
			(modal as any).diffCache.clear();

			// Set hunk decision without re-expanding (simulates edge case)
			const hunkBtns = findByCls(modal.contentEl as unknown as MockElement, "ghvault-hunk-btn");
			click(hunkBtns[1]); // Remote

			const promise = modal.waitForDecisions();
			const resolveBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta")[0];
			click(resolveBtn);
			const decisions = await promise;

			expect(decisions).toHaveLength(1);
			expect(decisions[0].resolution).toBe("merged");
			expect(decisions[0].mergedContent).toContain("new");
		});

		it("collapseDiff handles missing indicator gracefully (findIndicator returns null)", async () => {
			const conflicts: ConflictInfo[] = [
				{ path: "a.md", localChange: "modify", remoteChange: "modify" },
				{ path: "nonexistent-path.md", localChange: "modify", remoteChange: "modify" },
			];
			const provider: ConflictContentProvider = {
				getLocalContent: vi.fn().mockResolvedValue("local"),
				getRemoteContent: vi.fn().mockResolvedValue("remote"),
			};
			const modal = new ConflictModal({} as never, conflicts, provider);
			modal.onOpen();

			// Expand first file
			const pathCells = findByCls(
				modal.contentEl as unknown as MockElement,
				"ghvault-conflict-path",
			);
			click(pathCells[0]);
			await vi.waitFor(() => {
				const panels = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
				if (panels.length === 0) throw new Error("no panel");
				if (panels[0].textContent === "Loading diff...") throw new Error("loading");
			});

			// Manually set expandedPath to a path that doesn't match any DOM element
			// biome-ignore lint/suspicious/noExplicitAny: access private for testing
			(modal as any).expandedPath = "ghost-path.md";

			// Expanding second file should try to collapse "ghost-path.md"
			// findIndicator returns null — should not crash
			click(pathCells[1]);
			await vi.waitFor(() => {
				const panels = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
				if (panels.length === 0) throw new Error("no panel");
				if (panels[0].textContent === "Loading diff...") throw new Error("loading");
			});

			// Should have expanded second file without crashing
			const panels = findByCls(modal.contentEl as unknown as MockElement, "ghvault-diff-panel");
			expect(panels.length).toBeGreaterThanOrEqual(1);
		});
	});
});
