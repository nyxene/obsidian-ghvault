import { beforeEach, describe, expect, it, vi } from "vitest";

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
	checked: boolean;
	name: string;
	type: string;
	value: string;
	placeholder: string;
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
		checked: false,
		name: "",
		type: "",
		value: "",
		placeholder: "",
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

import { GistModal } from "./gist-modal";

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

function click(el: MockElement): void {
	for (const handler of el.listeners.click ?? []) {
		handler();
	}
}

function mockClient(overrides: Record<string, unknown> = {}): {
	createGist: ReturnType<typeof vi.fn>;
	updateGist: ReturnType<typeof vi.fn>;
} {
	return {
		createGist: vi.fn().mockResolvedValue({ id: "g1", htmlUrl: "https://gist.github.com/g1" }),
		updateGist: vi.fn().mockResolvedValue({ id: "g1", htmlUrl: "https://gist.github.com/g1" }),
		...overrides,
	} as ReturnType<typeof mockClient>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GistModal", () => {
	beforeEach(() => {
		noticeLog.length = 0;
		// Mock clipboard
		Object.defineProperty(globalThis, "navigator", {
			value: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
			writable: true,
			configurable: true,
		});
	});

	it("renders 'Share as Gist' title for new gist", () => {
		const client = mockClient();
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
		);
		modal.onOpen();

		const heading = findByText(modal.contentEl as unknown as MockElement, "Share as Gist");
		expect(heading).toBeDefined();
	});

	it("renders 'Update Gist' title for existing gist", () => {
		const client = mockClient();
		const existingGist = {
			gistId: "g1",
			htmlUrl: "https://gist.github.com/g1",
			isPublic: false,
			vaultPath: "notes/test.md",
			description: "existing",
			createdAt: 1000,
			updatedAt: 2000,
		};
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
			existingGist,
		);
		modal.onOpen();

		const heading = findByText(modal.contentEl as unknown as MockElement, "Update Gist");
		expect(heading).toBeDefined();
	});

	it("renders file info with path", () => {
		const client = mockClient();
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
		);
		modal.onOpen();

		const pathEl = findByText(modal.contentEl as unknown as MockElement, "notes/test.md");
		expect(pathEl).toBeDefined();
	});

	it("renders visibility radio for new gist", () => {
		const client = mockClient();
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
		);
		modal.onOpen();

		const visGroup = findByCls(
			modal.contentEl as unknown as MockElement,
			"ghvault-gist-visibility",
		);
		expect(visGroup).toHaveLength(1);

		const secretText = findByText(modal.contentEl as unknown as MockElement, "Secret");
		const publicText = findByText(modal.contentEl as unknown as MockElement, "Public");
		expect(secretText).toBeDefined();
		expect(publicText).toBeDefined();
	});

	it("does not render visibility radio for update mode", () => {
		const client = mockClient();
		const existingGist = {
			gistId: "g1",
			htmlUrl: "https://gist.github.com/g1",
			isPublic: false,
			vaultPath: "notes/test.md",
			description: "desc",
			createdAt: 1000,
			updatedAt: 2000,
		};
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
			existingGist,
		);
		modal.onOpen();

		const visGroup = findByCls(
			modal.contentEl as unknown as MockElement,
			"ghvault-gist-visibility",
		);
		expect(visGroup).toHaveLength(0);
	});

	it("renders description input", () => {
		const client = mockClient();
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
		);
		modal.onOpen();

		const descGroup = findByCls(
			modal.contentEl as unknown as MockElement,
			"ghvault-gist-description",
		);
		expect(descGroup).toHaveLength(1);
	});

	it("share button calls createGist with correct params", async () => {
		const client = mockClient();
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
		);
		modal.onOpen();

		const promise = modal.waitForResult();

		// Find and click Share button
		const shareBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta");
		expect(shareBtn).toHaveLength(1);
		expect(shareBtn[0].text).toBe("Share");

		// Trigger click
		await Promise.all((shareBtn[0].listeners.click ?? []).map((handler) => handler()));

		expect(client.createGist).toHaveBeenCalledWith({
			filename: "test.md",
			content: "# Hello",
			description: "test.md",
			isPublic: false,
		});

		const result = await promise;
		expect(result).not.toBeNull();
		expect(result?.record.gistId).toBe("g1");
		expect(result?.record.htmlUrl).toBe("https://gist.github.com/g1");
	});

	it("update mode calls updateGist", async () => {
		const client = mockClient();
		const existingGist = {
			gistId: "existing-id",
			htmlUrl: "https://gist.github.com/existing-id",
			isPublic: true,
			vaultPath: "notes/test.md",
			description: "old desc",
			createdAt: 1000,
			updatedAt: 2000,
		};
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Updated",
			client as never,
			existingGist,
		);
		modal.onOpen();

		const promise = modal.waitForResult();

		const updateBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta");
		expect(updateBtn[0].text).toBe("Update");

		await Promise.all((updateBtn[0].listeners.click ?? []).map((handler) => handler()));

		expect(client.updateGist).toHaveBeenCalledWith("existing-id", {
			filename: "test.md",
			content: "# Updated",
			description: "old desc",
		});

		const result = await promise;
		expect(result).not.toBeNull();
		expect(result?.record.gistId).toBe("g1");
	});

	it("cancel resolves with null", async () => {
		const client = mockClient();
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
		);
		modal.onOpen();

		const promise = modal.waitForResult();

		// Find Cancel button (non mod-cta button in footer)
		const footer = findByCls(modal.contentEl as unknown as MockElement, "ghvault-gist-footer");
		expect(footer).toHaveLength(1);
		const cancelBtn = footer[0].children[0]; // first button is Cancel
		expect(cancelBtn.text).toBe("Cancel");
		click(cancelBtn);

		const result = await promise;
		expect(result).toBeNull();
	});

	it("onClose resolves with null if not already resolved", async () => {
		const client = mockClient();
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
		);
		modal.onOpen();

		const promise = modal.waitForResult();
		modal.onClose();

		const result = await promise;
		expect(result).toBeNull();
	});

	it("403 error shows scope message", async () => {
		const client = mockClient({
			createGist: vi.fn().mockRejectedValue(new Error("403 Forbidden")),
		});
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
		);
		modal.onOpen();

		const shareBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta");
		await Promise.all((shareBtn[0].listeners.click ?? []).map((handler) => handler()));

		const scopeNotice = noticeLog.find((n) => n.message.includes("gist scope"));
		expect(scopeNotice).toBeDefined();
	});

	it("share with Public radio selected passes isPublic: true", async () => {
		const client = mockClient();
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
		);
		modal.onOpen();

		const promise = modal.waitForResult();

		// Find visibility group and trigger "Public" radio change
		const visGroup = findByCls(
			modal.contentEl as unknown as MockElement,
			"ghvault-gist-visibility",
		);
		expect(visGroup).toHaveLength(1);
		// The radio inputs are nested: visGroup > label > input
		// publicLabel is the 3rd child (after "Visibility:" label and secretLabel)
		const publicLabel = visGroup[0].children[2];
		const publicRadio = publicLabel.children[0];
		// Trigger change event on public radio
		for (const handler of publicRadio.listeners.change ?? []) {
			handler();
		}

		// Click Share
		const shareBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta");
		await Promise.all((shareBtn[0].listeners.click ?? []).map((handler) => handler()));

		expect(client.createGist).toHaveBeenCalledWith({
			filename: "test.md",
			content: "# Hello",
			description: "test.md",
			isPublic: true,
		});

		const result = await promise;
		expect(result).not.toBeNull();
		expect(result?.record.isPublic).toBe(true);
	});

	it("clipboard failure does not crash and shows URL in notice", async () => {
		Object.defineProperty(globalThis, "navigator", {
			value: { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } },
			writable: true,
			configurable: true,
		});

		const client = mockClient();
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
		);
		modal.onOpen();

		const promise = modal.waitForResult();
		const shareBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta");
		await Promise.all((shareBtn[0].listeners.click ?? []).map((handler) => handler()));
		await promise;

		// Should show URL in notice instead of "copied to clipboard"
		const urlNotice = noticeLog.find((n) => n.message.includes("gist.github.com/g1"));
		expect(urlNotice).toBeDefined();
	});

	it("non-403 error shows generic failure message", async () => {
		const client = mockClient({
			createGist: vi.fn().mockRejectedValue(new Error("Server error")),
		});
		const modal = new GistModal(
			{} as never,
			"notes/test.md",
			"test.md",
			"# Hello",
			client as never,
		);
		modal.onOpen();

		const shareBtn = findByCls(modal.contentEl as unknown as MockElement, "mod-cta");
		await Promise.all((shareBtn[0].listeners.click ?? []).map((handler) => handler()));

		const failNotice = noticeLog.find((n) => n.message.includes("Failed to share"));
		expect(failNotice).toBeDefined();
		expect(failNotice?.message).toContain("Server error");
	});
});
