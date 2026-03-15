import { type App, Modal } from "obsidian";
import type { ConflictDecision, ConflictInfo, ConflictResolution } from "../types";

export class ConflictModal extends Modal {
	private readonly conflicts: ConflictInfo[];
	private readonly decisions: Map<string, ConflictResolution> = new Map();
	private resolvePromise: ((decisions: ConflictDecision[]) => void) | null = null;
	private resolveButton: HTMLButtonElement | null = null;

	constructor(app: App, conflicts: ConflictInfo[]) {
		super(app);
		this.conflicts = conflicts;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ghvault-conflict-modal");

		contentEl.createEl("h2", {
			text: `Resolve conflicts (${this.conflicts.length} file${this.conflicts.length === 1 ? "" : "s"})`,
		});

		const grid = contentEl.createEl("div", { cls: "ghvault-conflict-table" });
		Object.assign(grid.style, {
			display: "grid",
			gridTemplateColumns: "1fr auto auto auto",
			gap: "0",
			marginTop: "12px",
		});

		// Header row
		for (const label of ["File", "Local", "Remote", "Action"]) {
			const th = grid.createEl("div", { text: label });
			Object.assign(th.style, {
				padding: "8px 12px",
				borderBottom: "2px solid var(--background-modifier-border)",
				color: "var(--text-muted)",
				fontSize: "12px",
				fontWeight: "600",
				textTransform: "uppercase" as const,
				letterSpacing: "0.05em",
			});
		}

		for (const conflict of this.conflicts) {
			const cellStyle = {
				padding: "12px",
				borderBottom: "1px solid var(--background-modifier-border)",
				display: "flex",
				alignItems: "center",
			};

			const pathCell = grid.createEl("div", { text: conflict.path, cls: "ghvault-conflict-path" });
			Object.assign(pathCell.style, {
				...cellStyle,
				wordBreak: "break-all",
			});

			for (const changeType of [conflict.localChange, conflict.remoteChange]) {
				const cell = grid.createEl("div", { text: changeType });
				Object.assign(cell.style, {
					...cellStyle,
					color: "var(--text-muted)",
				});
			}

			const actionCell = grid.createEl("div", { cls: "ghvault-conflict-actions" });
			Object.assign(actionCell.style, {
				...cellStyle,
				gap: "8px",
				flexWrap: "wrap",
			});

			const localBtn = actionCell.createEl("button", { text: "Keep Local" });
			const remoteBtn = actionCell.createEl("button", { text: "Keep Remote" });

			localBtn.addEventListener("click", () => {
				this.decisions.set(conflict.path, "local");
				localBtn.addClass("ghvault-conflict-selected");
				remoteBtn.removeClass("ghvault-conflict-selected");
				this.updateResolveButton();
			});

			remoteBtn.addEventListener("click", () => {
				this.decisions.set(conflict.path, "remote");
				remoteBtn.addClass("ghvault-conflict-selected");
				localBtn.removeClass("ghvault-conflict-selected");
				this.updateResolveButton();
			});
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
			const decisions: ConflictDecision[] = [];
			for (const conflict of this.conflicts) {
				const resolution = this.decisions.get(conflict.path);
				if (resolution) {
					decisions.push({ path: conflict.path, resolution });
				}
			}
			this.resolveWith(decisions);
		});
	}

	onClose(): void {
		this.contentEl.empty();
		// If modal closed without resolving, treat as skip
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
