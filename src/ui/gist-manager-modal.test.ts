import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GistRecord } from "../types";

// ---------------------------------------------------------------------------
// Mock Obsidian Modal + Notice
// ---------------------------------------------------------------------------

interface MockElement {
	tag: string;
	text?: string;
	textContent: string;
	cls?: string;
	children: MockElement[];
	listeners: Record<string, ((...args: unknown[]) => void)[]>;
	classes: Set<string>;
	disabled: boolean;
	style: Record<string, string>;
	createEl(tag: string, opts?: { text?: string; cls?: string }): MockElement;
	addEventListener(event: string, handler: (...args: unknown[]) => void): void;
	addClass(cls: string): void;
	setText(text: string): void;
	empty(): void;
}

function createMockElement(tag: string, opts?: { text?: string; cls?: string }): MockElement {
	const el: MockElement = {
		tag,
		text: opts?.text,
		textContent: opts?.text ?? "",
		cls: opts?.cls,
		children: [],
		listeners: {},
		classes: new Set(opts?.cls ? [opts.cls] : []),
		disabled: false,
		style: {},
		createEl(childTag: string, childOpts?: { text?: string; cls?: string }): MockElement {
			const child = createMockElement(childTag, childOpts);
			this.children.push(child);
			return child;
		},
		addEventListener(event: string, handler: (...args: unknown[]) => void): void {
			if (!this.listeners[event]) this.listeners[event] = [];
			this.listeners[event].push(handler);
		},
		addClass(cls: string): void {
			this.classes.add(cls);
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
	};
	return el;
}

interface NoticeRecord {
	message: string;
}

const noticeLog: NoticeRecord[] = [];

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
	Notice: class MockNotice {
		message: string;
		constructor(message: string) {
			this.message = message;
			noticeLog.push({ message });
		}
	},
}));

import { GistManagerModal } from "./gist-manager-modal";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findByText(root: MockElement, text: string): MockElement | undefined {
	if (root.text === text || root.textContent === text) return root;
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

function makeGistRecord(overrides: Partial<GistRecord> = {}): GistRecord {
	return {
		gistId: "g1",
		htmlUrl: "https://gist.github.com/g1",
		isPublic: false,
		vaultPath: "notes/test.md",
		description: "Test gist",
		createdAt: 1000,
		updatedAt: 2000,
		...overrides,
	};
}

function mockClient(overrides: Record<string, unknown> = {}): {
	deleteGist: ReturnType<typeof vi.fn>;
	updateGist: ReturnType<typeof vi.fn>;
} {
	return {
		deleteGist: vi.fn().mockResolvedValue(undefined),
		updateGist: vi.fn().mockResolvedValue({ id: "g1", htmlUrl: "https://gist.github.com/g1" }),
		...overrides,
	} as ReturnType<typeof mockClient>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GistManagerModal", () => {
	beforeEach(() => {
		noticeLog.length = 0;
		Object.defineProperty(globalThis, "navigator", {
			value: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
			writable: true,
			configurable: true,
		});
	});

	it("renders entries from registry", () => {
		const registry: Record<string, GistRecord> = {
			"notes/a.md": makeGistRecord({ vaultPath: "notes/a.md", description: "First" }),
			"notes/b.md": makeGistRecord({
				gistId: "g2",
				vaultPath: "notes/b.md",
				description: "Second",
			}),
		};
		const client = mockClient();
		const modal = new GistManagerModal({} as never, client as never, registry, vi.fn(), vi.fn());
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const heading = findByText(root, "Shared Gists (2)");
		expect(heading).toBeDefined();

		const entries = findByCls(root, "ghvault-gist-entry");
		expect(entries).toHaveLength(2);
	});

	it("empty registry shows 'No gists' message", () => {
		const client = mockClient();
		const modal = new GistManagerModal({} as never, client as never, {}, vi.fn(), vi.fn());
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const heading = findByText(root, "Shared Gists (0)");
		expect(heading).toBeDefined();

		const noGists = findByText(root, "No gists shared yet.");
		expect(noGists).toBeDefined();
	});

	it("delete button removes entry and calls deleteGist", async () => {
		const registry: Record<string, GistRecord> = {
			"notes/a.md": makeGistRecord({ vaultPath: "notes/a.md" }),
		};
		const onRegistryChange = vi.fn();
		const client = mockClient();
		const modal = new GistManagerModal(
			{} as never,
			client as never,
			registry,
			onRegistryChange,
			vi.fn(),
		);
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const deleteBtn = findByText(root, "Delete");
		expect(deleteBtn).toBeDefined();

		await Promise.all((deleteBtn?.listeners.click ?? []).map((handler) => handler()));

		expect(client.deleteGist).toHaveBeenCalledWith("g1");
		expect(onRegistryChange).toHaveBeenCalled();

		// Registry should no longer have the entry
		const updatedRegistry = onRegistryChange.mock.calls[0][0] as Record<string, GistRecord>;
		expect(updatedRegistry["notes/a.md"]).toBeUndefined();

		// Should show notice
		const notice = noticeLog.find((n) => n.message.includes("Gist deleted"));
		expect(notice).toBeDefined();
	});

	it("404 on update removes stale entry from registry", async () => {
		const registry: Record<string, GistRecord> = {
			"notes/stale.md": makeGistRecord({ vaultPath: "notes/stale.md" }),
		};
		const onRegistryChange = vi.fn();
		const readFileContent = vi.fn().mockResolvedValue("file content");
		const client = mockClient({
			updateGist: vi.fn().mockRejectedValue(new Error("404 Not Found")),
		});

		const modal = new GistManagerModal(
			{} as never,
			client as never,
			registry,
			onRegistryChange,
			readFileContent,
		);
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const updateBtn = findByText(root, "Update");
		expect(updateBtn).toBeDefined();

		await Promise.all((updateBtn?.listeners.click ?? []).map((handler) => handler()));

		expect(onRegistryChange).toHaveBeenCalled();
		const updatedRegistry = onRegistryChange.mock.calls[0][0] as Record<string, GistRecord>;
		expect(updatedRegistry["notes/stale.md"]).toBeUndefined();

		const notice = noticeLog.find((n) => n.message.includes("no longer exists"));
		expect(notice).toBeDefined();
	});

	it("copy URL button copies to clipboard", async () => {
		const registry: Record<string, GistRecord> = {
			"notes/a.md": makeGistRecord({
				vaultPath: "notes/a.md",
				htmlUrl: "https://gist.github.com/copy-me",
			}),
		};
		const client = mockClient();
		const modal = new GistManagerModal({} as never, client as never, registry, vi.fn(), vi.fn());
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const copyBtn = findByText(root, "Copy URL");
		expect(copyBtn).toBeDefined();

		await Promise.all((copyBtn?.listeners.click ?? []).map((handler) => handler()));

		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://gist.github.com/copy-me");
	});

	it("successful update calls updateGist and refreshes", async () => {
		const registry: Record<string, GistRecord> = {
			"notes/a.md": makeGistRecord({ vaultPath: "notes/a.md", description: "desc" }),
		};
		const onRegistryChange = vi.fn();
		const readFileContent = vi.fn().mockResolvedValue("updated content");
		const client = mockClient();

		const modal = new GistManagerModal(
			{} as never,
			client as never,
			registry,
			onRegistryChange,
			readFileContent,
		);
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const updateBtn = findByText(root, "Update");
		expect(updateBtn).toBeDefined();

		await Promise.all((updateBtn?.listeners.click ?? []).map((handler) => handler()));

		expect(readFileContent).toHaveBeenCalledWith("notes/a.md");
		expect(client.updateGist).toHaveBeenCalledWith("g1", {
			filename: "a.md",
			content: "updated content",
			description: "desc",
		});
		expect(onRegistryChange).toHaveBeenCalled();

		const notice = noticeLog.find((n) => n.message.includes("Gist updated"));
		expect(notice).toBeDefined();
	});

	it("update rejects file larger than 1MB", async () => {
		const registry: Record<string, GistRecord> = {
			"notes/big.md": makeGistRecord({ vaultPath: "notes/big.md" }),
		};
		const bigContent = "x".repeat(1024 * 1024 + 1);
		const readFileContent = vi.fn().mockResolvedValue(bigContent);
		const client = mockClient();

		const modal = new GistManagerModal(
			{} as never,
			client as never,
			registry,
			vi.fn(),
			readFileContent,
		);
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const updateBtn = findByText(root, "Update");

		await Promise.all((updateBtn?.listeners.click ?? []).map((handler) => handler()));

		expect(client.updateGist).not.toHaveBeenCalled();
		const notice = noticeLog.find((n) => n.message.includes("1MB limit"));
		expect(notice).toBeDefined();
		expect(notice?.message).toContain("Delete this gist");
	});

	it("non-404 update error shows failure notice", async () => {
		const registry: Record<string, GistRecord> = {
			"notes/a.md": makeGistRecord({ vaultPath: "notes/a.md" }),
		};
		const readFileContent = vi.fn().mockResolvedValue("content");
		const client = mockClient({
			updateGist: vi.fn().mockRejectedValue(new Error("Server error")),
		});

		const modal = new GistManagerModal(
			{} as never,
			client as never,
			registry,
			vi.fn(),
			readFileContent,
		);
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const updateBtn = findByText(root, "Update");

		await Promise.all((updateBtn?.listeners.click ?? []).map((handler) => handler()));

		const notice = noticeLog.find((n) => n.message.includes("Update failed"));
		expect(notice).toBeDefined();
		expect(notice?.message).toContain("Server error");
	});

	it("delete error shows failure notice", async () => {
		const registry: Record<string, GistRecord> = {
			"notes/a.md": makeGistRecord({ vaultPath: "notes/a.md" }),
		};
		const client = mockClient({
			deleteGist: vi.fn().mockRejectedValue(new Error("Network error")),
		});

		const modal = new GistManagerModal({} as never, client as never, registry, vi.fn(), vi.fn());
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const deleteBtn = findByText(root, "Delete");

		await Promise.all((deleteBtn?.listeners.click ?? []).map((handler) => handler()));

		const notice = noticeLog.find((n) => n.message.includes("Delete failed"));
		expect(notice).toBeDefined();
	});

	it("onClose empties contentEl", () => {
		const client = mockClient();
		const modal = new GistManagerModal({} as never, client as never, {}, vi.fn(), vi.fn());
		modal.onOpen();
		modal.onClose();

		const root = modal.contentEl as unknown as MockElement;
		expect(root.children).toHaveLength(0);
	});

	it("clipboard failure on copy URL does not crash", async () => {
		Object.defineProperty(globalThis, "navigator", {
			value: { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } },
			writable: true,
			configurable: true,
		});

		const registry: Record<string, GistRecord> = {
			"notes/a.md": makeGistRecord({ vaultPath: "notes/a.md" }),
		};
		const client = mockClient();
		const modal = new GistManagerModal({} as never, client as never, registry, vi.fn(), vi.fn());
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const copyBtn = findByText(root, "Copy URL");
		expect(copyBtn).toBeDefined();

		// Should not throw
		await Promise.all((copyBtn?.listeners.click ?? []).map((handler) => handler()));

		const notice = noticeLog.find((n) => n.message.includes("gist.github.com"));
		expect(notice).toBeDefined();
	});

	it("renders visibility badge for public and secret gists", () => {
		const registry: Record<string, GistRecord> = {
			"notes/public.md": makeGistRecord({
				vaultPath: "notes/public.md",
				isPublic: true,
			}),
			"notes/secret.md": makeGistRecord({
				gistId: "g2",
				vaultPath: "notes/secret.md",
				isPublic: false,
			}),
		};
		const client = mockClient();
		const modal = new GistManagerModal({} as never, client as never, registry, vi.fn(), vi.fn());
		modal.onOpen();

		const root = modal.contentEl as unknown as MockElement;
		const publicLabel = findByText(root, "public");
		const secretLabel = findByText(root, "secret");
		expect(publicLabel).toBeDefined();
		expect(secretLabel).toBeDefined();
	});
});
