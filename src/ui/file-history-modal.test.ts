import { describe, expect, it, vi } from "vitest";
import type { FileCommitInfo } from "../types";

// ---------------------------------------------------------------------------
// Minimal DOM mock for Modal contentEl
// ---------------------------------------------------------------------------

interface MockEl {
	tag: string;
	text?: string;
	cls?: string;
	children: MockEl[];
	style: Record<string, string>;
	disabled: boolean;
	listeners: Record<string, (() => void)[]>;
	createEl(tag: string, opts?: { text?: string; cls?: string }): MockEl;
	querySelector(sel: string): MockEl | null;
	querySelectorAll(sel: string): MockEl[];
	addEventListener(event: string, handler: () => void): void;
	setText(text: string): void;
	empty(): void;
	addClass(cls: string): void;
}

function createMockEl(tag = "div", opts?: { text?: string; cls?: string }): MockEl {
	const el: MockEl = {
		tag,
		text: opts?.text,
		cls: opts?.cls,
		children: [],
		style: {},
		disabled: false,
		listeners: {},
		createEl(childTag: string, childOpts?: { text?: string; cls?: string }): MockEl {
			const child = createMockEl(childTag, childOpts);
			this.children.push(child);
			return child;
		},
		querySelector(sel: string): MockEl | null {
			return findByCls(this, sel.replace(".", ""));
		},
		querySelectorAll(sel: string): MockEl[] {
			return findAllByCls(this, sel.replace(".", ""));
		},
		addEventListener(event: string, handler: () => void): void {
			if (!this.listeners[event]) this.listeners[event] = [];
			this.listeners[event].push(handler);
		},
		setText(text: string): void {
			this.text = text;
		},
		empty(): void {
			this.children = [];
		},
		addClass(): void {},
	};
	return el;
}

function findByCls(root: MockEl, cls: string): MockEl | null {
	if (root.cls === cls) return root;
	for (const child of root.children) {
		const found = findByCls(child, cls);
		if (found) return found;
	}
	return null;
}

function findAllByCls(root: MockEl, cls: string): MockEl[] {
	const results: MockEl[] = [];
	if (root.cls === cls) results.push(root);
	for (const child of root.children) {
		results.push(...findAllByCls(child, cls));
	}
	return results;
}

function findByText(root: MockEl, text: string): MockEl | null {
	if (root.text?.includes(text)) return root;
	for (const child of root.children) {
		const found = findByText(child, text);
		if (found) return found;
	}
	return null;
}

vi.mock("obsidian", () => ({
	Modal: class MockModal {
		app: unknown;
		contentEl: MockEl;
		constructor(app: unknown) {
			this.app = app;
			this.contentEl = createMockEl();
		}
		open(): void {}
		close(): void {}
	},
}));

import type { FileHistoryProvider } from "./file-history-modal";
import { FileHistoryModal } from "./file-history-modal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const twoCommits: FileCommitInfo[] = [
	{
		sha: "abc123",
		message: "vault sync: 1 file(s)",
		authorName: "John",
		date: new Date(Date.now() - 3600000).toISOString(),
		htmlUrl: "https://github.com/test/repo/commit/abc123",
	},
	{
		sha: "def456",
		message:
			"initial commit with a very long message that should be truncated at eighty characters limit boundary here",
		authorName: "Jane",
		date: new Date(Date.now() - 86400000 * 3).toISOString(),
		htmlUrl: "https://github.com/test/repo/commit/def456",
	},
];

function createMockProvider(commits: FileCommitInfo[] = twoCommits): FileHistoryProvider {
	return { listFileCommits: vi.fn().mockResolvedValue(commits) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FileHistoryModal", () => {
	it("renders heading with filename", async () => {
		const modal = new FileHistoryModal({} as never, "docs/note.md", "main", createMockProvider());
		await modal.onOpen();

		const heading = findByText(modal.contentEl as unknown as MockEl, "note.md");
		expect(heading).not.toBeNull();
	});

	it("renders commit rows", async () => {
		const modal = new FileHistoryModal({} as never, "file.md", "main", createMockProvider());
		await modal.onOpen();

		const rows = findAllByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-row");
		expect(rows).toHaveLength(2);
	});

	it("truncates long commit messages", async () => {
		const modal = new FileHistoryModal({} as never, "file.md", "main", createMockProvider());
		await modal.onOpen();

		const rows = findAllByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-row");
		const secondRow = rows[1];
		const msgDiv = secondRow.children[0];
		expect(msgDiv.text?.length).toBeLessThanOrEqual(80);
		expect(msgDiv.text).toContain("...");
	});

	it("shows author and relative date", async () => {
		const modal = new FileHistoryModal({} as never, "file.md", "main", createMockProvider());
		await modal.onOpen();

		const rows = findAllByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-row");
		const meta = rows[0].children[1];
		expect(meta.text).toContain("John");
		expect(meta.text).toContain("ago");
	});

	it("shows empty message when no commits", async () => {
		const modal = new FileHistoryModal({} as never, "file.md", "main", createMockProvider([]));
		await modal.onOpen();

		const empty = findByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-empty");
		expect(empty).not.toBeNull();
		expect(empty?.text).toContain("No commits found");
	});

	it("hides Load more when fewer than page size results", async () => {
		const modal = new FileHistoryModal({} as never, "file.md", "main", createMockProvider());
		await modal.onOpen();

		const footer = findByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-footer");
		const btn = footer?.children[0];
		expect(btn?.style.display).toBe("none");
	});

	it("shows Load more when page is full", async () => {
		const fullPage = Array.from({ length: 20 }, (_, i) => ({
			sha: `sha-${i}`,
			message: `commit ${i}`,
			authorName: "User",
			date: new Date().toISOString(),
			htmlUrl: `https://github.com/test/repo/commit/sha-${i}`,
		}));
		const modal = new FileHistoryModal(
			{} as never,
			"file.md",
			"main",
			createMockProvider(fullPage),
		);
		await modal.onOpen();

		const footer = findByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-footer");
		const btn = footer?.children[0];
		expect(btn?.style.display).not.toBe("none");
	});

	it("calls provider with correct path and branch", async () => {
		const provider = createMockProvider();
		const modal = new FileHistoryModal({} as never, "docs/note.md", "develop", provider);
		await modal.onOpen();

		expect(provider.listFileCommits).toHaveBeenCalledWith("docs/note.md", "develop", 20, 1);
	});

	it("shows error message when provider throws", async () => {
		const provider: FileHistoryProvider = {
			listFileCommits: vi.fn().mockRejectedValue(new Error("Network error")),
		};
		const modal = new FileHistoryModal({} as never, "file.md", "main", provider);
		await modal.onOpen();

		const error = findByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-error");
		expect(error).not.toBeNull();
		expect(error?.text).toContain("Network error");
	});

	it("does not open non-github URLs on row click", async () => {
		const mockOpen = vi.fn();
		globalThis.window = { open: mockOpen } as unknown as Window & typeof globalThis;

		const maliciousCommit: FileCommitInfo[] = [
			{
				sha: "abc",
				message: "commit",
				authorName: "User",
				date: new Date().toISOString(),
				htmlUrl: "https://evil.com/phishing",
			},
		];
		const modal = new FileHistoryModal(
			{} as never,
			"f.md",
			"main",
			createMockProvider(maliciousCommit),
		);
		await modal.onOpen();

		const row = findAllByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-row")[0];
		for (const handler of row.listeners.click ?? []) {
			handler();
		}

		expect(mockOpen).not.toHaveBeenCalled();
	});

	it("opens valid github URLs on row click", async () => {
		const mockOpen = vi.fn();
		globalThis.window = { open: mockOpen } as unknown as Window & typeof globalThis;

		const modal = new FileHistoryModal({} as never, "f.md", "main", createMockProvider());
		await modal.onOpen();

		const row = findAllByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-row")[0];
		for (const handler of row.listeners.click ?? []) {
			handler();
		}

		expect(mockOpen).toHaveBeenCalledWith("https://github.com/test/repo/commit/abc123", "_blank");
	});

	it("Load more fetches next page and appends commits", async () => {
		let callCount = 0;
		const provider: FileHistoryProvider = {
			listFileCommits: vi.fn().mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					return Array.from({ length: 20 }, (_, i) => ({
						sha: `sha-${i}`,
						message: `commit ${i}`,
						authorName: "User",
						date: new Date().toISOString(),
						htmlUrl: `https://github.com/test/repo/commit/sha-${i}`,
					}));
				}
				return [
					{
						sha: "sha-last",
						message: "last commit",
						authorName: "User",
						date: new Date().toISOString(),
						htmlUrl: "https://github.com/test/repo/commit/sha-last",
					},
				];
			}),
		};

		const modal = new FileHistoryModal({} as never, "file.md", "main", provider);
		await modal.onOpen();

		// First page: 20 commits
		let rows = findAllByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-row");
		expect(rows).toHaveLength(20);

		// Load more button should be visible
		const footer = findByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-footer");
		const loadBtn = footer?.children[0];
		expect(loadBtn?.style.display).not.toBe("none");

		// Simulate Load more click
		for (const handler of loadBtn?.listeners.click ?? []) {
			await (handler as () => Promise<void>)();
		}

		// Should now have 21 commits
		rows = findAllByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-row");
		expect(rows).toHaveLength(21);

		// Button should be hidden (last page had < 20)
		expect(loadBtn?.style.display).toBe("none");

		// Provider called with page 1, then page 2
		expect(provider.listFileCommits).toHaveBeenCalledWith("file.md", "main", 20, 1);
		expect(provider.listFileCommits).toHaveBeenCalledWith("file.md", "main", 20, 2);
	});

	it("does not fetch when hasMore is false", async () => {
		const provider = createMockProvider([]); // empty → hasMore = false
		const modal = new FileHistoryModal({} as never, "file.md", "main", provider);
		await modal.onOpen();

		// Try to load more — should be no-op
		const footer = findByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-footer");
		const loadBtn = footer?.children[0];
		if (loadBtn?.listeners.click) {
			for (const handler of loadBtn.listeners.click) {
				await (handler as () => Promise<void>)();
			}
		}

		// Only 1 call (initial)
		expect(provider.listFileCommits).toHaveBeenCalledTimes(1);
	});

	describe("formatRelativeDate year path", () => {
		it("shows year-based format for date >1 year ago", async () => {
			const commit: FileCommitInfo[] = [
				{
					sha: "old1",
					message: "ancient commit",
					authorName: "Alice",
					date: new Date(Date.now() - 86400000 * 400).toISOString(), // ~13 months ago
					htmlUrl: "https://github.com/test/repo/commit/old1",
				},
			];
			const modal = new FileHistoryModal({} as never, "f.md", "main", createMockProvider(commit));
			await modal.onOpen();

			const rows = findAllByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-row");
			const meta = rows[0].children[1];
			expect(meta.text).toContain("1y ago");
		});

		it("shows year-based format for date exactly 1 year ago", async () => {
			const commit: FileCommitInfo[] = [
				{
					sha: "old2",
					message: "one year commit",
					authorName: "Bob",
					date: new Date(Date.now() - 86400000 * 365).toISOString(), // exactly 12 months
					htmlUrl: "https://github.com/test/repo/commit/old2",
				},
			];
			const modal = new FileHistoryModal({} as never, "f.md", "main", createMockProvider(commit));
			await modal.onOpen();

			const rows = findAllByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-row");
			const meta = rows[0].children[1];
			expect(meta.text).toContain("1y ago");
		});

		it("shows multi-year format for date >2 years ago", async () => {
			const commit: FileCommitInfo[] = [
				{
					sha: "old3",
					message: "very old commit",
					authorName: "Carol",
					date: new Date(Date.now() - 86400000 * 800).toISOString(), // ~26 months ago
					htmlUrl: "https://github.com/test/repo/commit/old3",
				},
			];
			const modal = new FileHistoryModal({} as never, "f.md", "main", createMockProvider(commit));
			await modal.onOpen();

			const rows = findAllByCls(modal.contentEl as unknown as MockEl, "ghvault-file-history-row");
			const meta = rows[0].children[1];
			expect(meta.text).toContain("2y ago");
		});
	});
});
