import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupRecord } from "../types";

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

import { BackupModal, formatSize } from "./backup-modal";

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

function makeBackupRecord(overrides: Partial<BackupRecord> = {}): BackupRecord {
	return {
		id: 1,
		tagName: "backup-2026-01-01-120000",
		name: "Vault Backup",
		createdAt: "2026-01-01T12:00:00Z",
		htmlUrl: "https://github.com/owner/repo/releases/tag/backup-2026",
		assetName: "vault-backup.zip",
		assetSize: 2048000,
		assetDownloadUrl:
			"https://github.com/owner/repo/releases/download/backup-2026/vault-backup.zip",
		...overrides,
	};
}

function mockClient(overrides: Record<string, unknown> = {}): {
	listReleases: ReturnType<typeof vi.fn>;
	deleteRelease: ReturnType<typeof vi.fn>;
} {
	return {
		listReleases: vi.fn().mockResolvedValue([]),
		deleteRelease: vi.fn().mockResolvedValue(undefined),
		...overrides,
	} as ReturnType<typeof mockClient>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BackupModal", () => {
	beforeEach(() => {
		noticeLog.length = 0;
		Object.defineProperty(globalThis, "navigator", {
			value: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
			writable: true,
			configurable: true,
		});
	});

	it("renders list of backups after loading", async () => {
		const backups = [
			makeBackupRecord({ id: 1, tagName: "backup-2026-01-01-120000" }),
			makeBackupRecord({ id: 2, tagName: "backup-2026-01-02-120000" }),
		];
		const client = mockClient({ listReleases: vi.fn().mockResolvedValue(backups) });
		const modal = new BackupModal({} as never, client as never, vi.fn(), vi.fn());

		// onOpen renders empty, then loadBackups fetches and re-renders
		modal.onOpen();
		await vi.waitFor(() => {
			expect(client.listReleases).toHaveBeenCalled();
		});

		// After load, re-render with data
		const root = modal.contentEl as unknown as MockElement;
		const heading = findByText(root, "Vault Backups (2)");
		expect(heading).toBeDefined();

		const entries = findByCls(root, "ghvault-backup-entry");
		expect(entries).toHaveLength(2);
	});

	it("shows empty state message", async () => {
		const client = mockClient();
		const modal = new BackupModal({} as never, client as never, vi.fn(), vi.fn());

		modal.onOpen();
		// Wait for async loadBackups to complete
		await vi.waitFor(() => {
			const root = modal.contentEl as unknown as MockElement;
			const heading = findByText(root, "Vault Backups (0)");
			if (!heading) throw new Error("not loaded yet");
		});

		const root = modal.contentEl as unknown as MockElement;
		const heading = findByText(root, "Vault Backups (0)");
		expect(heading).toBeDefined();

		const emptyMsg = findByText(root, "No backups yet.");
		expect(emptyMsg).toBeDefined();
	});

	it("delete button calls onDelete", async () => {
		const backups = [makeBackupRecord()];
		const client = mockClient({ listReleases: vi.fn().mockResolvedValue(backups) });
		const onDelete = vi.fn().mockResolvedValue(undefined);
		const modal = new BackupModal({} as never, client as never, vi.fn(), onDelete);
		modal.onOpen();

		await vi.waitFor(() => {
			expect(client.listReleases).toHaveBeenCalled();
		});

		const root = modal.contentEl as unknown as MockElement;
		const deleteBtn = findByText(root, "Delete");
		expect(deleteBtn).toBeDefined();

		await Promise.all((deleteBtn?.listeners.click ?? []).map((handler) => handler()));

		expect(onDelete).toHaveBeenCalledWith(backups[0]);
		const notice = noticeLog.find((n) => n.message.includes("Backup deleted"));
		expect(notice).toBeDefined();
	});

	it("restore button shows confirmation then calls onRestore", async () => {
		const backups = [makeBackupRecord()];
		const client = mockClient({ listReleases: vi.fn().mockResolvedValue(backups) });
		const onRestore = vi.fn().mockResolvedValue(undefined);
		const modal = new BackupModal({} as never, client as never, onRestore, vi.fn());
		modal.onOpen();

		await vi.waitFor(() => {
			expect(client.listReleases).toHaveBeenCalled();
		});

		const root = modal.contentEl as unknown as MockElement;
		const restoreBtn = findByText(root, "Restore");
		expect(restoreBtn).toBeDefined();

		// Click restore → shows confirmation
		await Promise.all((restoreBtn?.listeners.click ?? []).map((handler) => handler()));

		const confirmMsg = findByText(root, "This will overwrite all current vault files. Continue?");
		expect(confirmMsg).toBeDefined();

		// Click confirm restore
		const confirmBtn = findByText(root, "Restore");
		expect(confirmBtn).toBeDefined();
		await Promise.all((confirmBtn?.listeners.click ?? []).map((handler) => handler()));

		expect(onRestore).toHaveBeenCalledWith(backups[0]);
	});

	it("copy URL button copies to clipboard", async () => {
		const backups = [
			makeBackupRecord({ htmlUrl: "https://github.com/owner/repo/releases/copy-me" }),
		];
		const client = mockClient({ listReleases: vi.fn().mockResolvedValue(backups) });
		const modal = new BackupModal({} as never, client as never, vi.fn(), vi.fn());
		modal.onOpen();

		await vi.waitFor(() => {
			expect(client.listReleases).toHaveBeenCalled();
		});

		const root = modal.contentEl as unknown as MockElement;
		const copyBtn = findByText(root, "Copy URL");
		expect(copyBtn).toBeDefined();

		await Promise.all((copyBtn?.listeners.click ?? []).map((handler) => handler()));

		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
			"https://github.com/owner/repo/releases/copy-me",
		);
	});

	it("clipboard failure on copy URL does not crash", async () => {
		Object.defineProperty(globalThis, "navigator", {
			value: { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } },
			writable: true,
			configurable: true,
		});

		const backups = [
			makeBackupRecord({ htmlUrl: "https://github.com/owner/repo/releases/clip-fail" }),
		];
		const client = mockClient({ listReleases: vi.fn().mockResolvedValue(backups) });
		const modal = new BackupModal({} as never, client as never, vi.fn(), vi.fn());
		modal.onOpen();

		await vi.waitFor(() => {
			expect(client.listReleases).toHaveBeenCalled();
		});

		const root = modal.contentEl as unknown as MockElement;
		const copyBtn = findByText(root, "Copy URL");
		expect(copyBtn).toBeDefined();

		// Should not throw
		await Promise.all((copyBtn?.listeners.click ?? []).map((handler) => handler()));

		const notice = noticeLog.find((n) => n.message.includes("releases/clip-fail"));
		expect(notice).toBeDefined();
	});

	it("error state close button calls modal close", async () => {
		const client = mockClient({
			listReleases: vi.fn().mockRejectedValue(new Error("Auth failed")),
		});
		const modal = new BackupModal({} as never, client as never, vi.fn(), vi.fn());
		const closeSpy = vi.spyOn(modal, "close");

		modal.onOpen();
		await vi.waitFor(() => {
			const root = modal.contentEl as unknown as MockElement;
			const closeBtn = findByText(root, "Close");
			if (!closeBtn) throw new Error("not loaded yet");
		});

		const root = modal.contentEl as unknown as MockElement;
		const closeBtn = findByText(root, "Close");
		expect(closeBtn).toBeDefined();

		await Promise.all((closeBtn?.listeners.click ?? []).map((handler) => handler()));
		expect(closeSpy).toHaveBeenCalled();
	});

	it("backup list close button calls modal close", async () => {
		const client = mockClient({ listReleases: vi.fn().mockResolvedValue([]) });
		const modal = new BackupModal({} as never, client as never, vi.fn(), vi.fn());
		const closeSpy = vi.spyOn(modal, "close");

		modal.onOpen();
		await vi.waitFor(() => {
			const root = modal.contentEl as unknown as MockElement;
			const heading = findByText(root, "Vault Backups (0)");
			if (!heading) throw new Error("not loaded yet");
		});

		const root = modal.contentEl as unknown as MockElement;
		const closeBtn = findByText(root, "Close");
		expect(closeBtn).toBeDefined();

		await Promise.all((closeBtn?.listeners.click ?? []).map((handler) => handler()));
		expect(closeSpy).toHaveBeenCalled();
	});

	it("onClose empties contentEl", () => {
		const client = mockClient();
		const modal = new BackupModal({} as never, client as never, vi.fn(), vi.fn());
		modal.onOpen();
		modal.onClose();

		const root = modal.contentEl as unknown as MockElement;
		expect(root.children).toHaveLength(0);
	});

	it("loadBackups error shows error state with retry button", async () => {
		const client = mockClient({
			listReleases: vi.fn().mockRejectedValue(new Error("Network error")),
		});
		const modal = new BackupModal({} as never, client as never, vi.fn(), vi.fn());

		modal.onOpen();
		await vi.waitFor(() => {
			const root = modal.contentEl as unknown as MockElement;
			const errorMsg = findByText(root, "Failed to load backups: Network error");
			if (!errorMsg) throw new Error("not loaded yet");
		});

		const root = modal.contentEl as unknown as MockElement;
		const errorMsg = findByText(root, "Failed to load backups: Network error");
		expect(errorMsg).toBeDefined();

		const retryBtn = findByText(root, "Retry");
		expect(retryBtn).toBeDefined();
	});

	it("retry button reloads backups", async () => {
		const listReleases = vi
			.fn()
			.mockRejectedValueOnce(new Error("Network error"))
			.mockResolvedValueOnce([makeBackupRecord()]);
		const client = mockClient({ listReleases });
		const modal = new BackupModal({} as never, client as never, vi.fn(), vi.fn());

		modal.onOpen();
		await vi.waitFor(() => {
			const root = modal.contentEl as unknown as MockElement;
			const retryBtn = findByText(root, "Retry");
			if (!retryBtn) throw new Error("not loaded yet");
		});

		// Click retry
		const root = modal.contentEl as unknown as MockElement;
		const retryBtn = findByText(root, "Retry");
		expect(retryBtn).toBeDefined();
		await Promise.all((retryBtn?.listeners.click ?? []).map((handler) => handler()));

		await vi.waitFor(() => {
			expect(listReleases).toHaveBeenCalledTimes(2);
		});

		// After retry, should show backup list
		const heading = findByText(root, "Vault Backups (1)");
		expect(heading).toBeDefined();
	});

	it("delete error shows failure notice and restores button", async () => {
		const backups = [makeBackupRecord()];
		const client = mockClient({ listReleases: vi.fn().mockResolvedValue(backups) });
		const onDelete = vi.fn().mockRejectedValue(new Error("Delete failed"));
		const modal = new BackupModal({} as never, client as never, vi.fn(), onDelete);
		modal.onOpen();

		await vi.waitFor(() => {
			expect(client.listReleases).toHaveBeenCalled();
		});

		const root = modal.contentEl as unknown as MockElement;
		const deleteBtn = findByText(root, "Delete");
		expect(deleteBtn).toBeDefined();

		await Promise.all((deleteBtn?.listeners.click ?? []).map((handler) => handler()));

		const failNotice = noticeLog.find((n) => n.message.includes("Delete failed"));
		expect(failNotice).toBeDefined();
		expect(deleteBtn?.disabled).toBe(false);
		expect(deleteBtn?.textContent).toBe("Delete");
	});

	it("restore error shows failure notice and restores button", async () => {
		const backups = [makeBackupRecord()];
		const client = mockClient({ listReleases: vi.fn().mockResolvedValue(backups) });
		const onRestore = vi.fn().mockRejectedValue(new Error("Restore failed"));
		const modal = new BackupModal({} as never, client as never, onRestore, vi.fn());
		modal.onOpen();

		await vi.waitFor(() => {
			expect(client.listReleases).toHaveBeenCalled();
		});

		const root = modal.contentEl as unknown as MockElement;
		const restoreBtn = findByText(root, "Restore");
		expect(restoreBtn).toBeDefined();

		// Click restore -> shows confirmation
		await Promise.all((restoreBtn?.listeners.click ?? []).map((handler) => handler()));

		// Click confirm restore
		const confirmBtn = findByText(root, "Restore");
		expect(confirmBtn).toBeDefined();
		await Promise.all((confirmBtn?.listeners.click ?? []).map((handler) => handler()));

		const failNotice = noticeLog.find((n) => n.message.includes("Restore failed"));
		expect(failNotice).toBeDefined();
	});

	it("restore confirmation cancel returns to backup list without calling onRestore", async () => {
		const backups = [makeBackupRecord()];
		const client = mockClient({ listReleases: vi.fn().mockResolvedValue(backups) });
		const onRestore = vi.fn();
		const modal = new BackupModal({} as never, client as never, onRestore, vi.fn());
		modal.onOpen();

		await vi.waitFor(() => {
			expect(client.listReleases).toHaveBeenCalled();
		});

		const root = modal.contentEl as unknown as MockElement;
		const restoreBtn = findByText(root, "Restore");
		expect(restoreBtn).toBeDefined();

		// Click restore -> shows confirmation dialog
		await Promise.all((restoreBtn?.listeners.click ?? []).map((handler) => handler()));

		// Verify we are on the confirmation screen
		const confirmMsg = findByText(root, "This will overwrite all current vault files. Continue?");
		expect(confirmMsg).toBeDefined();

		// Click cancel
		const cancelBtn = findByText(root, "Cancel");
		expect(cancelBtn).toBeDefined();
		await Promise.all((cancelBtn?.listeners.click ?? []).map((handler) => handler()));

		// Should return to backup list (not call onRestore)
		expect(onRestore).not.toHaveBeenCalled();

		// Verify backup list is re-rendered
		const heading = findByText(root, "Vault Backups (1)");
		expect(heading).toBeDefined();
	});

	it("loadBackups stale-data branch shows cached data and notice on refresh failure", async () => {
		const backups = [makeBackupRecord({ id: 1, tagName: "backup-2026-01-01-120000" })];
		const listReleases = vi
			.fn()
			.mockResolvedValueOnce(backups)
			.mockRejectedValueOnce(new Error("Network timeout"));
		const client = mockClient({ listReleases });
		const modal = new BackupModal({} as never, client as never, vi.fn(), vi.fn());

		// First load succeeds
		modal.onOpen();
		await vi.waitFor(() => {
			const root = modal.contentEl as unknown as MockElement;
			const heading = findByText(root, "Vault Backups (1)");
			if (!heading) throw new Error("not loaded yet");
		});

		// Trigger a second load (e.g. after delete refreshes the list)
		// Access private loadBackups via any cast
		await (modal as unknown as { loadBackups: () => Promise<void> }).loadBackups();

		// Cached data should still be shown (not empty/error)
		const root = modal.contentEl as unknown as MockElement;
		const heading = findByText(root, "Vault Backups (1)");
		expect(heading).toBeDefined();

		// A notice should warn about the refresh failure
		const notice = noticeLog.find((n) => n.message.includes("Failed to refresh backups"));
		expect(notice).toBeDefined();
	});

	it("confirmation dialog shows correct size formatting (KB vs MB)", async () => {
		const smallBackup = makeBackupRecord({ id: 1, assetSize: 512 * 1024 }); // 512 KB
		const largeBackup = makeBackupRecord({ id: 2, assetSize: 2.5 * 1024 * 1024 }); // 2.5 MB
		const client = mockClient({
			listReleases: vi.fn().mockResolvedValue([smallBackup, largeBackup]),
		});
		const modal = new BackupModal({} as never, client as never, vi.fn(), vi.fn());

		modal.onOpen();
		await vi.waitFor(() => {
			expect(client.listReleases).toHaveBeenCalled();
		});

		const root = modal.contentEl as unknown as MockElement;
		const kbSize = findByText(root, "512.0 KB");
		expect(kbSize).toBeDefined();
		const mbSize = findByText(root, "2.5 MB");
		expect(mbSize).toBeDefined();
	});
});

describe("formatSize", () => {
	it("formats 0 bytes", () => {
		expect(formatSize(0)).toBe("0 B");
	});

	it("formats kilobytes", () => {
		expect(formatSize(512 * 1024)).toBe("512.0 KB");
	});

	it("formats megabytes", () => {
		expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
	});
});
