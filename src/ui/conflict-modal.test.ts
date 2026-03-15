import { describe, expect, it, vi } from "vitest";
import type { ConflictInfo } from "../types";

// ---------------------------------------------------------------------------
// Mock Obsidian Modal
// ---------------------------------------------------------------------------

interface MockElement {
	tag: string;
	text?: string;
	cls?: string;
	children: MockElement[];
	listeners: Record<string, (() => void)[]>;
	classes: Set<string>;
	disabled: boolean;
	style: Record<string, string>;
	createEl(tag: string, opts?: { text?: string; cls?: string }): MockElement;
	addEventListener(event: string, handler: () => void): void;
	addClass(cls: string): void;
	removeClass(cls: string): void;
	empty(): void;
}

function createMockElement(tag: string, opts?: { text?: string; cls?: string }): MockElement {
	const el: MockElement = {
		tag,
		text: opts?.text,
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
		empty(): void {
			this.children = [];
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConflictModal", () => {
	it("renders heading with file count", () => {
		const modal = new ConflictModal({} as never, twoConflicts);
		modal.onOpen();

		const heading = findByText(
			modal.contentEl as unknown as MockElement,
			"Resolve conflicts (2 files)",
		);
		expect(heading).toBeDefined();
	});

	it("renders singular heading for 1 conflict", () => {
		const modal = new ConflictModal({} as never, [twoConflicts[0]]);
		modal.onOpen();

		const heading = findByText(
			modal.contentEl as unknown as MockElement,
			"Resolve conflicts (1 file)",
		);
		expect(heading).toBeDefined();
	});

	it("renders cells for each conflict", () => {
		const modal = new ConflictModal({} as never, twoConflicts);
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
		const modal = new ConflictModal({} as never, twoConflicts);
		modal.onOpen();

		const buttons = findByCls(modal.contentEl as unknown as MockElement, "mod-cta");
		expect(buttons).toHaveLength(1);
		expect(buttons[0].disabled).toBe(true);
	});

	it("resolve button enables when all conflicts have decisions", () => {
		const modal = new ConflictModal({} as never, twoConflicts);
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
		const modal = new ConflictModal({} as never, twoConflicts);
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
		const modal = new ConflictModal({} as never, twoConflicts);
		modal.onOpen();

		const promise = modal.waitForDecisions();

		const skipBtn = findByText(modal.contentEl as unknown as MockElement, "Skip All");
		expect(skipBtn).toBeDefined();
		click(skipBtn as MockElement);

		const decisions = await promise;
		expect(decisions).toEqual([]);
	});

	it("onClose resolves with empty array if not already resolved", async () => {
		const modal = new ConflictModal({} as never, twoConflicts);
		modal.onOpen();

		const promise = modal.waitForDecisions();
		modal.onClose();

		const decisions = await promise;
		expect(decisions).toEqual([]);
	});

	it("switching decision updates selected class", () => {
		const modal = new ConflictModal({} as never, [twoConflicts[0]]);
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
});
