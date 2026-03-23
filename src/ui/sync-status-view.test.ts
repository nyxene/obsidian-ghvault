import { describe, expect, it, vi } from "vitest";
import type { ConflictInfo, SHACacheEntry } from "../types";

// ---------------------------------------------------------------------------
// Mock element for DOM operations used by SyncStatusView
// ---------------------------------------------------------------------------

interface MockEl {
	tag: string;
	text: string;
	cls: string;
	classes: Set<string>;
	children: MockEl[];
	style: Record<string, string>;
	listeners: Record<string, Array<() => void>>;
	createEl(tag: string, opts?: { text?: string; cls?: string }): MockEl;
	addEventListener(event: string, handler: () => void): void;
	addClass(cls: string): void;
	setText(text: string): void;
	empty(): void;
}

function createMockEl(tag = "div", opts?: { text?: string; cls?: string }): MockEl {
	const el: MockEl = {
		tag,
		text: opts?.text ?? "",
		cls: opts?.cls ?? "",
		classes: new Set(opts?.cls ? [opts.cls] : []),
		children: [],
		style: {},
		listeners: {},
		createEl(childTag: string, childOpts?: { text?: string; cls?: string }): MockEl {
			const child = createMockEl(childTag, childOpts);
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
		setText(text: string): void {
			this.text = text;
		},
		empty(): void {
			this.children = [];
			this.text = "";
		},
	};
	return el;
}

function findAllByClass(root: MockEl, cls: string): MockEl[] {
	const results: MockEl[] = [];
	for (const child of root.children) {
		if (child.cls === cls || child.classes.has(cls)) results.push(child);
		results.push(...findAllByClass(child, cls));
	}
	return results;
}

function findByClass(root: MockEl, cls: string): MockEl | undefined {
	return findAllByClass(root, cls)[0];
}

function collectAllText(root: MockEl): string {
	let result = root.text;
	for (const child of root.children) {
		result += collectAllText(child);
	}
	return result;
}

vi.mock("obsidian", () => ({
	ItemView: class {
		contentEl = createMockEl();
		addAction() {}
	},
	setIcon: vi.fn(),
}));

import { buildSyncStatusData, SyncStatusView } from "./sync-status-view";

function makeCache(paths: string[]): Record<string, SHACacheEntry> {
	const cache: Record<string, SHACacheEntry> = {};
	for (const path of paths) {
		cache[path] = {
			remoteSha: `sha-${path}`,
			localContentHash: `hash-${path}`,
			lastSyncedAt: 1000,
			size: 100,
			isBinary: false,
		};
	}
	return cache;
}

describe("buildSyncStatusData", () => {
	it("classifies synced files (in cache, not pending, not conflict)", () => {
		const cache = makeCache(["a.md", "b.md"]);
		const result = buildSyncStatusData(cache, ["a.md", "b.md"], new Map(), [], 1000);
		expect(result.synced).toEqual(["a.md", "b.md"]);
		expect(result.pending).toHaveLength(0);
		expect(result.conflicts).toHaveLength(0);
		expect(result.untracked).toHaveLength(0);
	});

	it("classifies untracked files (not in cache)", () => {
		const result = buildSyncStatusData({}, ["new-file.md"], new Map(), [], 1000);
		expect(result.untracked).toEqual(["new-file.md"]);
		expect(result.synced).toHaveLength(0);
	});

	it("classifies pending files", () => {
		const cache = makeCache(["doc.md"]);
		const pending = new Map<string, "create" | "modify" | "delete">([["doc.md", "modify"]]);
		const result = buildSyncStatusData(cache, ["doc.md"], pending, [], 1000);
		expect(result.pending).toEqual([{ path: "doc.md", type: "modify" }]);
		expect(result.synced).toHaveLength(0);
	});

	it("classifies conflict files", () => {
		const cache = makeCache(["conflict.md"]);
		const conflicts: ConflictInfo[] = [
			{ path: "conflict.md", localChange: "modify", remoteChange: "modify" },
		];
		const result = buildSyncStatusData(cache, ["conflict.md"], new Map(), conflicts, 1000);
		expect(result.conflicts).toHaveLength(1);
		expect(result.synced).toHaveLength(0);
	});

	it("excludes files in excludedPaths", () => {
		const cache = makeCache(["visible.md"]);
		const result = buildSyncStatusData(
			cache,
			["visible.md", ".obsidian/config"],
			new Map(),
			[],
			1000,
			new Set([".obsidian/config"]),
		);
		expect(result.synced).toEqual(["visible.md"]);
		expect(result.untracked).toHaveLength(0);
	});

	it("sorts all arrays alphabetically", () => {
		const cache = makeCache(["z.md", "a.md", "m.md"]);
		const result = buildSyncStatusData(cache, ["z.md", "a.md", "m.md"], new Map(), [], 1000);
		expect(result.synced).toEqual(["a.md", "m.md", "z.md"]);
	});

	it("conflict files excluded from pending list", () => {
		const cache = makeCache(["file.md"]);
		const pending = new Map<string, "create" | "modify" | "delete">([["file.md", "modify"]]);
		const conflicts: ConflictInfo[] = [
			{ path: "file.md", localChange: "modify", remoteChange: "modify" },
		];
		const result = buildSyncStatusData(cache, ["file.md"], pending, conflicts, 1000);
		// File is in conflicts, not in pending
		expect(result.conflicts).toHaveLength(1);
		expect(result.pending).toHaveLength(0);
	});

	it("preserves lastSyncedAt", () => {
		const result = buildSyncStatusData({}, [], new Map(), [], 12345);
		expect(result.lastSyncedAt).toBe(12345);
	});

	it("handles empty vault", () => {
		const result = buildSyncStatusData({}, [], new Map(), [], 0);
		expect(result.synced).toHaveLength(0);
		expect(result.pending).toHaveLength(0);
		expect(result.conflicts).toHaveLength(0);
		expect(result.untracked).toHaveLength(0);
		expect(result.lastSyncedAt).toBe(0);
	});

	it("handles mixed statuses", () => {
		const cache = makeCache(["synced.md", "conflict.md"]);
		const pending = new Map<string, "create" | "modify" | "delete">([["pending.md", "create"]]);
		const conflicts: ConflictInfo[] = [
			{ path: "conflict.md", localChange: "modify", remoteChange: "modify" },
		];
		const result = buildSyncStatusData(
			cache,
			["synced.md", "conflict.md", "pending.md", "new.md"],
			pending,
			conflicts,
			1000,
		);
		expect(result.synced).toEqual(["synced.md"]);
		expect(result.pending).toEqual([{ path: "pending.md", type: "create" }]);
		expect(result.conflicts).toHaveLength(1);
		expect(result.untracked).toEqual(["new.md"]);
	});
});

// ---------------------------------------------------------------------------
// SyncStatusView tests
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: test helper for accessing view internals
type AnyView = any;

function createView(): SyncStatusView {
	const leaf = {};
	return new SyncStatusView(leaf as AnyView);
}

function getContentEl(view: SyncStatusView): MockEl {
	return (view as AnyView).contentEl as MockEl;
}

describe("SyncStatusView", () => {
	describe("onOpen", () => {
		it("renders content into contentEl", async () => {
			const view = createView();
			await view.onOpen();

			const contentEl = getContentEl(view);
			// Should have the ghvault-sync-status class
			expect(contentEl.classes.has("ghvault-sync-status")).toBe(true);
		});
	});

	describe("render with null data (not configured)", () => {
		it("shows configure message when data is null", async () => {
			const view = createView();
			await view.onOpen();

			const contentEl = getContentEl(view);
			const emptyEl = findByClass(contentEl, "ghvault-status-empty");
			expect(emptyEl).toBeDefined();
			expect(emptyEl?.text).toBe("Configure GHVault settings to see sync status.");
		});
	});

	describe("render with empty data", () => {
		it("shows 'No files' message when all arrays are empty", async () => {
			const view = createView();
			await view.onOpen();
			view.refresh({
				synced: [],
				pending: [],
				conflicts: [],
				untracked: [],
				lastSyncedAt: 0,
			});

			const contentEl = getContentEl(view);
			const emptyEl = findByClass(contentEl, "ghvault-status-empty");
			expect(emptyEl).toBeDefined();
			expect(emptyEl?.text).toBe("No files in vault.");
		});
	});

	describe("render with conflicts, pending, and synced data", () => {
		it("renders conflicts section", () => {
			const view = createView();
			view.refresh({
				synced: [],
				pending: [],
				conflicts: [{ path: "conflict.md", localChange: "modify", remoteChange: "modify" }],
				untracked: [],
				lastSyncedAt: 1000,
			});

			const contentEl = getContentEl(view);
			const allText = collectAllText(contentEl);
			expect(allText).toContain("CONFLICTS (1)");
			expect(allText).toContain("conflict.md");
		});

		it("renders pending section", () => {
			const view = createView();
			view.refresh({
				synced: [],
				pending: [{ path: "pending.md", type: "modify" }],
				conflicts: [],
				untracked: [],
				lastSyncedAt: 1000,
			});

			const contentEl = getContentEl(view);
			const allText = collectAllText(contentEl);
			expect(allText).toContain("PENDING (1)");
			expect(allText).toContain("pending.md");
		});

		it("renders synced section", () => {
			const view = createView();
			view.refresh({
				synced: ["synced-a.md", "synced-b.md"],
				pending: [],
				conflicts: [],
				untracked: [],
				lastSyncedAt: 1000,
			});

			const contentEl = getContentEl(view);
			const allText = collectAllText(contentEl);
			expect(allText).toContain("SYNCED (2)");
			expect(allText).toContain("synced-a.md");
			expect(allText).toContain("synced-b.md");
		});

		it("renders untracked section", () => {
			const view = createView();
			view.refresh({
				synced: [],
				pending: [],
				conflicts: [],
				untracked: ["new.md"],
				lastSyncedAt: 1000,
			});

			const contentEl = getContentEl(view);
			const allText = collectAllText(contentEl);
			expect(allText).toContain("UNTRACKED (1)");
			expect(allText).toContain("new.md");
		});

		it("renders last synced header when lastSyncedAt > 0", () => {
			const view = createView();
			view.refresh({
				synced: ["a.md"],
				pending: [],
				conflicts: [],
				untracked: [],
				lastSyncedAt: new Date(2026, 0, 15, 14, 30).getTime(),
			});

			const contentEl = getContentEl(view);
			const header = findByClass(contentEl, "ghvault-status-header");
			expect(header).toBeDefined();
			expect(header?.text).toContain("Last synced:");
		});
	});

	describe("synced section collapse/expand", () => {
		it("shows only 5 files when collapsed with more than 5 synced", () => {
			const view = createView();
			const synced = Array.from({ length: 10 }, (_, i) => `file-${String(i).padStart(2, "0")}.md`);
			view.refresh({
				synced,
				pending: [],
				conflicts: [],
				untracked: [],
				lastSyncedAt: 1000,
			});

			const contentEl = getContentEl(view);
			const sections = findAllByClass(contentEl, "ghvault-status-section");
			// The synced section should exist
			expect(sections.length).toBeGreaterThan(0);
			const syncedSection = sections[sections.length - 1];
			const items = findAllByClass(syncedSection, "ghvault-status-file");
			expect(items).toHaveLength(5);

			// Should have expander
			const expander = findByClass(syncedSection, "ghvault-status-expander");
			expect(expander).toBeDefined();
			expect(expander?.text).toContain("Show all 10 files");
		});

		it("shows all files after expand click", () => {
			const view = createView();
			const synced = Array.from({ length: 10 }, (_, i) => `file-${String(i).padStart(2, "0")}.md`);
			view.refresh({
				synced,
				pending: [],
				conflicts: [],
				untracked: [],
				lastSyncedAt: 1000,
			});

			const contentEl = getContentEl(view);
			let sections = findAllByClass(contentEl, "ghvault-status-section");
			const syncedSection = sections[sections.length - 1];
			const expander = findByClass(syncedSection, "ghvault-status-expander");
			expect(expander).toBeDefined();

			// Simulate click on expander
			expander?.listeners.click?.[0]?.();

			// After expand, re-read contentEl (render was called again)
			sections = findAllByClass(contentEl, "ghvault-status-section");
			const newSyncedSection = sections[sections.length - 1];
			const items = findAllByClass(newSyncedSection, "ghvault-status-file");
			expect(items).toHaveLength(10);
		});
	});

	describe("setCallbacks", () => {
		it("stores callbacks", () => {
			const view = createView();
			const onSync = vi.fn();
			const onFileClick = vi.fn();
			view.setCallbacks(onSync, onFileClick);

			// Access private fields to verify storage
			expect((view as AnyView).onSyncClick).toBe(onSync);
			expect((view as AnyView).onFileClick).toBe(onFileClick);
		});
	});

	describe("getViewType and getDisplayText", () => {
		it("returns correct view type", () => {
			const view = createView();
			expect(view.getViewType()).toBe("ghvault-sync-status");
		});

		it("returns correct display text", () => {
			const view = createView();
			expect(view.getDisplayText()).toBe("GHVault: Sync Status");
		});

		it("returns correct icon", () => {
			const view = createView();
			expect(view.getIcon()).toBe("layers");
		});
	});

	describe("onClose", () => {
		it("empties contentEl", async () => {
			const view = createView();
			view.refresh({
				synced: ["a.md"],
				pending: [],
				conflicts: [],
				untracked: [],
				lastSyncedAt: 1000,
			});
			await view.onClose();

			const contentEl = getContentEl(view);
			expect(contentEl.children).toHaveLength(0);
		});
	});

	describe("file click callback", () => {
		it("calls onFileClick when file item is clicked", () => {
			const onFileClick = vi.fn();
			const view = createView();
			view.setCallbacks(vi.fn(), onFileClick);

			view.refresh({
				synced: ["clicked.md"],
				pending: [],
				conflicts: [],
				untracked: [],
				lastSyncedAt: 1000,
			});

			const contentEl = getContentEl(view);
			const fileItems = findAllByClass(contentEl, "ghvault-status-file");
			expect(fileItems.length).toBeGreaterThan(0);

			// Simulate click
			fileItems[0].listeners.click?.[0]?.();
			expect(onFileClick).toHaveBeenCalledWith("clicked.md");
		});
	});

	describe("pending file type icons", () => {
		it("renders pending items with correct type suffix", () => {
			const view = createView();
			view.refresh({
				synced: [],
				pending: [
					{ path: "new.md", type: "create" },
					{ path: "changed.md", type: "modify" },
					{ path: "removed.md", type: "delete" },
				],
				conflicts: [],
				untracked: [],
				lastSyncedAt: 1000,
			});

			const contentEl = getContentEl(view);
			const allText = collectAllText(contentEl);
			expect(allText).toContain("PENDING (3)");
			expect(allText).toContain("create");
			expect(allText).toContain("modify");
			expect(allText).toContain("delete");
		});
	});
});
