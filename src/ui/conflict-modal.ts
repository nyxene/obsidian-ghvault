import { type App, Modal } from "obsidian";
import type {
	ConflictContentProvider,
	ConflictDecision,
	ConflictInfo,
	ConflictResolution,
} from "../types";
import { hasBinaryContent } from "../utils/binary";
import { computeDiff, type DiffHunk, type DiffLine, groupIntoHunks, mergeHunks } from "./diff";

const DIFF_MAX_SIZE = 100 * 1024; // 100KB

export class ConflictModal extends Modal {
	private readonly conflicts: ConflictInfo[];
	private readonly contentProvider: ConflictContentProvider;
	private readonly decisions: Map<string, ConflictResolution> = new Map();
	private readonly contentCache = new Map<string, { local: string; remote: string }>();
	private readonly diffCache = new Map<string, { diff: DiffLine[]; hunks: DiffHunk[] }>();
	private readonly hunkDecisions = new Map<string, Map<number, "local" | "remote">>();
	private resolvePromise: ((decisions: ConflictDecision[]) => void) | null = null;
	private resolveButton: HTMLButtonElement | null = null;
	private expandedPath: string | null = null;
	private diffPanels = new Map<string, HTMLElement>();

	constructor(app: App, conflicts: ConflictInfo[], contentProvider: ConflictContentProvider) {
		super(app);
		this.conflicts = conflicts;
		this.contentProvider = contentProvider;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ghvault-conflict-modal");

		contentEl.createEl("h2", {
			text: `Resolve conflicts (${this.conflicts.length} file${this.conflicts.length === 1 ? "" : "s"})`,
		});

		const container = contentEl.createEl("div", { cls: "ghvault-conflict-container" });
		Object.assign(container.style, { marginTop: "12px" });

		for (const conflict of this.conflicts) {
			this.renderConflictRow(container, conflict);
		}

		const footer = contentEl.createEl("div", { cls: "ghvault-conflict-footer" });
		Object.assign(footer.style, {
			display: "flex",
			justifyContent: "flex-end",
			gap: "8px",
			marginTop: "16px",
			paddingTop: "12px",
			borderTop: "1px solid var(--background-modifier-border)",
		});

		const skipBtn = footer.createEl("button", { text: "Skip All" });
		skipBtn.addEventListener("click", () => {
			this.resolveWith([]);
		});

		const resolveBtn = footer.createEl("button", {
			text: "Resolve",
			cls: "mod-cta",
		});
		resolveBtn.disabled = true;
		this.resolveButton = resolveBtn;
		resolveBtn.addEventListener("click", () => {
			this.buildAndResolve();
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.resolvePromise) {
			this.resolvePromise([]);
			this.resolvePromise = null;
		}
	}

	waitForDecisions(): Promise<ConflictDecision[]> {
		return new Promise<ConflictDecision[]>((resolve) => {
			this.resolvePromise = resolve;
		});
	}

	private renderConflictRow(container: HTMLElement, conflict: ConflictInfo): void {
		const row = container.createEl("div", { cls: "ghvault-conflict-row" });
		Object.assign(row.style, {
			display: "grid",
			gridTemplateColumns: "1fr auto auto auto",
			gap: "0",
			borderBottom: "1px solid var(--background-modifier-border)",
		});

		const cellStyle = {
			padding: "12px",
			display: "flex",
			alignItems: "center",
		};

		// File path cell (clickable to expand diff)
		const pathCell = row.createEl("div", { cls: "ghvault-conflict-path" });
		Object.assign(pathCell.style, {
			...cellStyle,
			cursor: "pointer",
			wordBreak: "break-all",
		});
		const indicator = pathCell.createEl("span", { text: "▶ " });
		Object.assign(indicator.style, { marginRight: "4px", fontSize: "10px" });
		pathCell.createEl("span", { text: conflict.path });

		pathCell.addEventListener("click", () => {
			this.toggleDiff(conflict, container, row, indicator);
		});

		// Change type cells
		for (const changeType of [conflict.localChange, conflict.remoteChange]) {
			const cell = row.createEl("div", { text: changeType });
			Object.assign(cell.style, {
				...cellStyle,
				color: "var(--text-muted)",
			});
		}

		// Action buttons (whole-file decisions)
		const actionCell = row.createEl("div", { cls: "ghvault-conflict-actions" });
		Object.assign(actionCell.style, {
			...cellStyle,
			gap: "8px",
			flexWrap: "wrap",
		});

		const localBtn = actionCell.createEl("button", { text: "Keep Local" });
		const remoteBtn = actionCell.createEl("button", { text: "Keep Remote" });

		localBtn.addEventListener("click", () => {
			this.decisions.set(conflict.path, "local");
			this.hunkDecisions.delete(conflict.path); // clear per-hunk if any
			localBtn.addClass("ghvault-conflict-selected");
			remoteBtn.removeClass("ghvault-conflict-selected");
			this.clearHunkSelections(conflict.path);
			this.updateResolveButton();
		});

		remoteBtn.addEventListener("click", () => {
			this.decisions.set(conflict.path, "remote");
			this.hunkDecisions.delete(conflict.path);
			remoteBtn.addClass("ghvault-conflict-selected");
			localBtn.removeClass("ghvault-conflict-selected");
			this.clearHunkSelections(conflict.path);
			this.updateResolveButton();
		});
	}

	private async toggleDiff(
		conflict: ConflictInfo,
		container: HTMLElement,
		row: HTMLElement,
		indicator: HTMLElement,
	): Promise<void> {
		if (this.expandedPath === conflict.path) {
			this.collapseDiff(conflict.path, indicator);
			return;
		}

		if (this.expandedPath) {
			const prevIndicator = this.findIndicator(this.expandedPath);
			this.collapseDiff(this.expandedPath, prevIndicator);
		}

		this.expandedPath = conflict.path;
		indicator.setText("▼ ");

		const panel = container.createEl("div", { cls: "ghvault-diff-panel" });
		Object.assign(panel.style, {
			maxHeight: "400px",
			overflowY: "auto",
			padding: "8px",
			backgroundColor: "var(--background-secondary)",
			borderBottom: "1px solid var(--background-modifier-border)",
			fontFamily: "var(--font-monospace)",
			fontSize: "12px",
			lineHeight: "1.5",
		});

		row.after(panel);
		this.diffPanels.set(conflict.path, panel);
		panel.setText("Loading diff...");

		if (conflict.localChange === "delete" && conflict.remoteChange === "delete") {
			panel.setText("Both versions deleted — no diff available.");
			return;
		}

		try {
			await this.renderDiffContent(panel, conflict);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			panel.empty();
			panel.setText(`Failed to load: ${message}`);
		}
	}

	private async renderDiffContent(panel: HTMLElement, conflict: ConflictInfo): Promise<void> {
		let content = this.contentCache.get(conflict.path);

		if (!content) {
			const [local, remote] = await Promise.all([
				conflict.localChange === "delete"
					? Promise.resolve("")
					: this.contentProvider.getLocalContent(conflict.path),
				conflict.remoteChange === "delete"
					? Promise.resolve("")
					: this.contentProvider.getRemoteContent(conflict.path),
			]);
			content = { local, remote };
			this.contentCache.set(conflict.path, content);
		}

		panel.empty();

		// Handle delete scenarios
		if (conflict.localChange === "delete") {
			this.renderInfoMessage(panel, "Deleted locally — remote content:");
			this.renderPlainContent(panel, content.remote);
			return;
		}
		if (conflict.remoteChange === "delete") {
			this.renderInfoMessage(panel, "Deleted on remote — local content:");
			this.renderPlainContent(panel, content.local);
			return;
		}

		// Binary check
		const localBytes = new TextEncoder().encode(content.local);
		if (localBytes.length > DIFF_MAX_SIZE) {
			panel.setText("File too large for inline diff (>100KB).");
			return;
		}
		if (hasBinaryContent(new Uint8Array(localBytes.buffer))) {
			panel.setText("Binary file — cannot display diff.");
			return;
		}

		// Compute diff and group into hunks (cached)
		let cached = this.diffCache.get(conflict.path);
		if (!cached) {
			const diff = computeDiff(content.local, content.remote);
			const hunks = groupIntoHunks(diff);
			cached = { diff, hunks };
			this.diffCache.set(conflict.path, cached);
		}
		const { diff, hunks } = cached;

		if (hunks.length === 0) {
			panel.setText("Files are identical.");
			return;
		}

		// Summary
		const addCount = diff.filter((l) => l.type === "add").length;
		const removeCount = diff.filter((l) => l.type === "remove").length;
		this.renderInfoMessage(
			panel,
			`${hunks.length} change${hunks.length === 1 ? "" : "s"}: +${addCount} −${removeCount} lines`,
		);

		// Render hunks with per-hunk controls
		for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
			this.renderHunk(panel, conflict.path, hunks[hunkIdx], hunkIdx);
		}
	}

	private renderHunk(
		panel: HTMLElement,
		conflictPath: string,
		hunk: DiffHunk,
		hunkIdx: number,
	): void {
		const hunkContainer = panel.createEl("div", { cls: "ghvault-diff-hunk" });
		Object.assign(hunkContainer.style, {
			marginBottom: "8px",
			border: "1px solid var(--background-modifier-border)",
			borderRadius: "4px",
			overflow: "hidden",
		});

		// Hunk header with line range and per-hunk buttons
		const header = hunkContainer.createEl("div", { cls: "ghvault-diff-hunk-header" });
		Object.assign(header.style, {
			display: "flex",
			justifyContent: "space-between",
			alignItems: "center",
			padding: "4px 8px",
			backgroundColor: "var(--background-modifier-border)",
			fontSize: "11px",
			color: "var(--text-muted)",
		});

		header.createEl("span", {
			text: `@@ -${hunk.localStart},${hunk.localEnd} +${hunk.remoteStart},${hunk.remoteEnd} @@`,
		});

		// Per-hunk accept/reject buttons
		const hunkActions = header.createEl("span", { cls: "ghvault-hunk-actions" });
		Object.assign(hunkActions.style, { display: "flex", gap: "4px" });

		const localBtn = hunkActions.createEl("button", { text: "Local", cls: "ghvault-hunk-btn" });
		const remoteBtn = hunkActions.createEl("button", { text: "Remote", cls: "ghvault-hunk-btn" });
		Object.assign(localBtn.style, { fontSize: "10px", padding: "2px 6px" });
		Object.assign(remoteBtn.style, { fontSize: "10px", padding: "2px 6px" });

		localBtn.addEventListener("click", () => {
			this.setHunkDecision(conflictPath, hunkIdx, "local");
			localBtn.addClass("ghvault-conflict-selected");
			remoteBtn.removeClass("ghvault-conflict-selected");
		});

		remoteBtn.addEventListener("click", () => {
			this.setHunkDecision(conflictPath, hunkIdx, "remote");
			remoteBtn.addClass("ghvault-conflict-selected");
			localBtn.removeClass("ghvault-conflict-selected");
		});

		// Restore selection state if re-expanding
		const existingDecisions = this.hunkDecisions.get(conflictPath);
		if (existingDecisions?.has(hunkIdx)) {
			const d = existingDecisions.get(hunkIdx);
			if (d === "local") localBtn.addClass("ghvault-conflict-selected");
			if (d === "remote") remoteBtn.addClass("ghvault-conflict-selected");
		}

		// Diff lines with line numbers
		const linesContainer = hunkContainer.createEl("div");
		for (const line of hunk.lines) {
			this.renderDiffLine(linesContainer, line);
		}
	}

	private renderDiffLine(container: HTMLElement, line: DiffLine): void {
		const lineEl = container.createEl("div");
		Object.assign(lineEl.style, {
			display: "flex",
			whiteSpace: "pre-wrap",
			wordBreak: "break-all",
		});

		// Line number gutter
		const localNum = line.localLine !== undefined ? String(line.localLine).padStart(4) : "    ";
		const remoteNum = line.remoteLine !== undefined ? String(line.remoteLine).padStart(4) : "    ";

		const gutter = lineEl.createEl("span", { text: `${localNum} ${remoteNum} ` });
		Object.assign(gutter.style, {
			color: "var(--text-muted)",
			userSelect: "none",
			flexShrink: "0",
		});

		const content = lineEl.createEl("span");

		switch (line.type) {
			case "remove":
				content.setText(`- ${line.text}`);
				Object.assign(lineEl.style, {
					backgroundColor: "rgba(var(--background-modifier-error-rgb), 0.2)",
				});
				break;
			case "add":
				content.setText(`+ ${line.text}`);
				Object.assign(lineEl.style, {
					backgroundColor: "rgba(var(--background-modifier-success-rgb), 0.2)",
				});
				break;
			default:
				content.setText(`  ${line.text}`);
				break;
		}
	}

	private setHunkDecision(
		conflictPath: string,
		hunkIdx: number,
		decision: "local" | "remote",
	): void {
		let hunkMap = this.hunkDecisions.get(conflictPath);
		if (!hunkMap) {
			hunkMap = new Map();
			this.hunkDecisions.set(conflictPath, hunkMap);
		}
		hunkMap.set(hunkIdx, decision);

		// Set file-level decision to "merged" when using per-hunk
		this.decisions.set(conflictPath, "merged");

		// Clear whole-file button selection
		const pathCells = this.contentEl.querySelectorAll(".ghvault-conflict-actions button");
		for (const btn of Array.from(pathCells)) {
			// Only clear buttons for this file's row
			const row = btn.closest(".ghvault-conflict-row");
			if (row) {
				const pathSpan = row.querySelector(".ghvault-conflict-path span:nth-child(2)");
				if (pathSpan?.textContent === conflictPath) {
					btn.removeClass("ghvault-conflict-selected");
				}
			}
		}

		this.updateResolveButton();
	}

	private clearHunkSelections(conflictPath: string): void {
		const panel = this.diffPanels.get(conflictPath);
		if (!panel) return;
		const hunkBtns = panel.querySelectorAll(".ghvault-hunk-btn");
		for (const btn of Array.from(hunkBtns)) {
			btn.removeClass("ghvault-conflict-selected");
		}
	}

	private buildAndResolve(): void {
		const decisions: ConflictDecision[] = [];
		for (const conflict of this.conflicts) {
			const resolution = this.decisions.get(conflict.path);
			if (!resolution) continue;

			if (resolution === "merged") {
				// Build merged content from per-hunk decisions
				const content = this.contentCache.get(conflict.path);
				const hunkMap = this.hunkDecisions.get(conflict.path);
				if (content && hunkMap && hunkMap.size > 0) {
					let cached = this.diffCache.get(conflict.path);
					if (!cached) {
						const diff = computeDiff(content.local, content.remote);
						const hunks = groupIntoHunks(diff);
						cached = { diff, hunks };
						this.diffCache.set(conflict.path, cached);
					}
					const mergedContent = mergeHunks(content.local, cached.hunks, hunkMap);
					decisions.push({ path: conflict.path, resolution: "merged", mergedContent });
				}
			} else {
				decisions.push({ path: conflict.path, resolution });
			}
		}
		this.resolveWith(decisions);
	}

	private renderInfoMessage(panel: HTMLElement, message: string): void {
		const info = panel.createEl("div", { text: message });
		Object.assign(info.style, {
			color: "var(--text-muted)",
			marginBottom: "8px",
			fontStyle: "italic",
		});
	}

	private renderPlainContent(panel: HTMLElement, text: string): void {
		for (const line of text.split("\n")) {
			panel.createEl("div", { text: `  ${line}` });
		}
	}

	private collapseDiff(path: string, indicator: HTMLElement | null): void {
		const panel = this.diffPanels.get(path);
		if (panel) {
			panel.remove();
			this.diffPanels.delete(path);
		}
		if (indicator) {
			indicator.setText("▶ ");
		}
		if (this.expandedPath === path) {
			this.expandedPath = null;
		}
	}

	private findIndicator(path: string): HTMLElement | null {
		const pathCells = this.contentEl.querySelectorAll(".ghvault-conflict-path");
		for (const cell of Array.from(pathCells)) {
			const spans = cell.querySelectorAll("span");
			if (spans.length >= 2 && spans[1].textContent === path) {
				return spans[0] as HTMLElement;
			}
		}
		return null;
	}

	private resolveWith(decisions: ConflictDecision[]): void {
		if (this.resolvePromise) {
			this.resolvePromise(decisions);
			this.resolvePromise = null;
		}
		this.close();
	}

	private updateResolveButton(): void {
		if (!this.resolveButton) return;
		this.resolveButton.disabled = this.decisions.size < this.conflicts.length;
	}
}
