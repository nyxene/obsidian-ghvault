import { type IconName, ItemView, setIcon } from "obsidian";
import type { ChangeType, ConflictInfo, SHACacheEntry } from "../types";

export const SYNC_STATUS_VIEW_TYPE = "ghvault-sync-status";

const SYNCED_COLLAPSED_LIMIT = 5;

export interface SyncStatusData {
	synced: string[];
	pending: Array<{ path: string; type: ChangeType }>;
	conflicts: ConflictInfo[];
	untracked: string[];
	lastSyncedAt: number;
}

export function buildSyncStatusData(
	cache: Readonly<Record<string, SHACacheEntry>>,
	vaultFiles: readonly string[],
	pending: ReadonlyMap<string, ChangeType>,
	conflicts: readonly ConflictInfo[],
	lastSyncedAt: number,
	excludedPaths?: ReadonlySet<string>,
): SyncStatusData {
	const cachedPaths = new Set(Object.keys(cache));
	const pendingPaths = new Set(pending.keys());
	const conflictPaths = new Set(conflicts.map((c) => c.path));
	const synced: string[] = [];
	const untracked: string[] = [];

	for (const path of vaultFiles) {
		if (excludedPaths?.has(path)) continue;
		if (conflictPaths.has(path)) continue;
		if (pendingPaths.has(path)) continue;
		if (cachedPaths.has(path)) {
			synced.push(path);
		} else {
			untracked.push(path);
		}
	}

	return {
		synced: synced.sort(),
		pending: [...pending.entries()]
			.filter(([p]) => !conflictPaths.has(p))
			.map(([path, type]) => ({ path, type }))
			.sort((a, b) => a.path.localeCompare(b.path)),
		conflicts: [...conflicts].sort((a, b) => a.path.localeCompare(b.path)),
		untracked: untracked.sort(),
		lastSyncedAt,
	};
}

export class SyncStatusView extends ItemView {
	private data: SyncStatusData | null = null;
	private onSyncClick: (() => void) | null = null;
	private onFileClick: ((path: string) => void) | null = null;
	private syncedExpanded = false;

	getViewType(): string {
		return SYNC_STATUS_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "GHVault: Sync Status";
	}

	getIcon(): IconName {
		return "layers";
	}

	async onOpen(): Promise<void> {
		this.addAction("refresh-cw", "Sync now", () => {
			this.onSyncClick?.();
		});
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	setCallbacks(onSync: () => void, onFileClick: (path: string) => void): void {
		this.onSyncClick = onSync;
		this.onFileClick = onFileClick;
	}

	refresh(data: SyncStatusData): void {
		this.data = data;
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ghvault-sync-status");

		if (!this.data) {
			const emptyEl = contentEl.createEl("div", {
				text: "Configure GHVault settings to see sync status.",
				cls: "ghvault-status-empty",
			});
			Object.assign(emptyEl.style, {
				padding: "16px",
				color: "var(--text-muted)",
				fontStyle: "italic",
			});
			return;
		}

		const data = this.data;

		// Last synced header
		if (data.lastSyncedAt > 0) {
			const header = contentEl.createEl("div", { cls: "ghvault-status-header" });
			Object.assign(header.style, {
				padding: "8px 12px",
				fontSize: "11px",
				color: "var(--text-muted)",
				borderBottom: "1px solid var(--background-modifier-border)",
			});
			const date = new Date(data.lastSyncedAt);
			const hours = String(date.getHours()).padStart(2, "0");
			const minutes = String(date.getMinutes()).padStart(2, "0");
			header.setText(`Last synced: ${hours}:${minutes}`);
		}

		// Conflicts section
		if (data.conflicts.length > 0) {
			this.renderSection(
				contentEl,
				"CONFLICTS",
				data.conflicts.length,
				"alert-triangle",
				"var(--text-error)",
				(container) => {
					for (const conflict of data.conflicts) {
						this.renderFileItem(container, conflict.path, "alert-triangle", "var(--text-error)");
					}
				},
			);
		}

		// Pending section
		if (data.pending.length > 0) {
			this.renderSection(
				contentEl,
				"PENDING",
				data.pending.length,
				"upload",
				"var(--text-warning, #e0a526)",
				(container) => {
					for (const item of data.pending) {
						const icon =
							item.type === "create" ? "plus" : item.type === "delete" ? "minus" : "edit";
						this.renderFileItem(
							container,
							item.path,
							icon,
							"var(--text-warning, #e0a526)",
							item.type,
						);
					}
				},
			);
		}

		// Untracked section
		if (data.untracked.length > 0) {
			this.renderSection(
				contentEl,
				"UNTRACKED",
				data.untracked.length,
				"plus-circle",
				"var(--text-accent)",
				(container) => {
					for (const path of data.untracked) {
						this.renderFileItem(container, path, "plus-circle", "var(--text-accent)");
					}
				},
			);
		}

		// Synced section
		if (data.synced.length > 0) {
			this.renderSection(
				contentEl,
				"SYNCED",
				data.synced.length,
				"check-circle",
				"var(--text-success, #28a745)",
				(container) => {
					const limit = this.syncedExpanded ? data.synced.length : SYNCED_COLLAPSED_LIMIT;
					const visible = data.synced.slice(0, limit);

					for (const path of visible) {
						this.renderFileItem(container, path, "check-circle", "var(--text-success, #28a745)");
					}

					if (!this.syncedExpanded && data.synced.length > SYNCED_COLLAPSED_LIMIT) {
						const expander = container.createEl("div", {
							text: `Show all ${data.synced.length} files`,
							cls: "ghvault-status-expander",
						});
						Object.assign(expander.style, {
							padding: "4px 12px 4px 32px",
							fontSize: "11px",
							color: "var(--text-accent)",
							cursor: "pointer",
						});
						expander.addEventListener("click", () => {
							this.syncedExpanded = true;
							this.render();
						});
					}
				},
			);
		}

		// Empty state
		if (
			data.conflicts.length === 0 &&
			data.pending.length === 0 &&
			data.untracked.length === 0 &&
			data.synced.length === 0
		) {
			const empty = contentEl.createEl("div", {
				text: "No files in vault.",
				cls: "ghvault-status-empty",
			});
			Object.assign(empty.style, {
				padding: "16px",
				color: "var(--text-muted)",
				fontStyle: "italic",
			});
		}
	}

	private renderSection(
		parent: HTMLElement,
		title: string,
		count: number,
		iconId: string,
		color: string,
		renderItems: (container: HTMLElement) => void,
	): void {
		const section = parent.createEl("div", { cls: "ghvault-status-section" });

		const header = section.createEl("div", { cls: "ghvault-status-section-header" });
		Object.assign(header.style, {
			display: "flex",
			alignItems: "center",
			gap: "6px",
			padding: "8px 12px",
			fontSize: "11px",
			fontWeight: "600",
			textTransform: "uppercase",
			letterSpacing: "0.05em",
			color,
		});

		const iconEl = header.createEl("span");
		setIcon(iconEl, iconId);
		Object.assign(iconEl.style, { width: "14px", height: "14px" });

		header.createEl("span", { text: `${title} (${count})` });

		const itemsContainer = section.createEl("div", { cls: "ghvault-status-items" });
		renderItems(itemsContainer);
	}

	private renderFileItem(
		container: HTMLElement,
		path: string,
		iconId: string,
		color: string,
		suffix?: string,
	): void {
		const item = container.createEl("div", { cls: "ghvault-status-file" });
		Object.assign(item.style, {
			display: "flex",
			alignItems: "center",
			gap: "6px",
			padding: "3px 12px 3px 24px",
			fontSize: "12px",
			cursor: "pointer",
		});

		item.addEventListener("mouseenter", () => {
			Object.assign(item.style, { backgroundColor: "var(--background-modifier-hover)" });
		});
		item.addEventListener("mouseleave", () => {
			Object.assign(item.style, { backgroundColor: "" });
		});

		const iconEl = item.createEl("span");
		setIcon(iconEl, iconId);
		Object.assign(iconEl.style, { width: "12px", height: "12px", color, flexShrink: "0" });

		const pathEl = item.createEl("span", { text: path });
		Object.assign(pathEl.style, {
			overflow: "hidden",
			textOverflow: "ellipsis",
			whiteSpace: "nowrap",
			flex: "1",
		});

		if (suffix) {
			const badge = item.createEl("span", { text: suffix });
			Object.assign(badge.style, {
				fontSize: "10px",
				color: "var(--text-muted)",
				flexShrink: "0",
			});
		}

		item.addEventListener("click", () => {
			this.onFileClick?.(path);
		});
	}
}
