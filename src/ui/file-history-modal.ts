import { type App, Modal } from "obsidian";
import type { FileCommitInfo } from "../types";

const PAGE_SIZE = 20;

export interface FileHistoryProvider {
	listFileCommits(
		path: string,
		branch: string,
		perPage: number,
		page: number,
	): Promise<FileCommitInfo[]>;
}

export class FileHistoryModal extends Modal {
	private readonly filePath: string;
	private readonly branch: string;
	private readonly provider: FileHistoryProvider;
	private currentPage = 1;
	private hasMore = true;
	private listEl: HTMLElement | null = null;
	private loadMoreBtn: HTMLButtonElement | null = null;

	constructor(app: App, filePath: string, branch: string, provider: FileHistoryProvider) {
		super(app);
		this.filePath = filePath;
		this.branch = branch;
		this.provider = provider;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ghvault-file-history-modal");

		const fileName = this.filePath.split("/").pop() ?? this.filePath;
		contentEl.createEl("h2", { text: `File history — ${fileName}` });

		this.listEl = contentEl.createEl("div", { cls: "ghvault-file-history-list" });
		Object.assign(this.listEl.style, { marginTop: "12px" });

		const footer = contentEl.createEl("div", { cls: "ghvault-file-history-footer" });
		Object.assign(footer.style, {
			display: "flex",
			justifyContent: "center",
			marginTop: "12px",
		});

		this.loadMoreBtn = footer.createEl("button", { text: "Load more" });
		this.loadMoreBtn.style.display = "none";
		this.loadMoreBtn.addEventListener("click", () => {
			this.loadPage();
		});

		await this.loadPage();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async loadPage(): Promise<void> {
		if (!this.listEl || !this.hasMore) return;

		if (this.loadMoreBtn) {
			this.loadMoreBtn.disabled = true;
			this.loadMoreBtn.setText("Loading...");
		}

		try {
			const commits = await this.provider.listFileCommits(
				this.filePath,
				this.branch,
				PAGE_SIZE,
				this.currentPage,
			);

			if (commits.length === 0 && this.currentPage === 1) {
				const emptyEl = this.listEl.createEl("div", {
					text: "No commits found for this file",
					cls: "ghvault-file-history-empty",
				});
				Object.assign(emptyEl.style, {
					color: "var(--text-muted)",
					padding: "16px 0",
					textAlign: "center",
				});
				this.hasMore = false;
			} else {
				for (const commit of commits) {
					this.renderCommit(commit);
				}
				this.currentPage++;
				this.hasMore = commits.length >= PAGE_SIZE;
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			this.listEl.createEl("div", {
				text: `Failed to load history: ${message}`,
				cls: "ghvault-file-history-error",
			});
			this.hasMore = false;
		}

		if (this.loadMoreBtn) {
			this.loadMoreBtn.disabled = false;
			this.loadMoreBtn.setText("Load more");
			this.loadMoreBtn.style.display = this.hasMore ? "" : "none";
		}
	}

	private renderCommit(commit: FileCommitInfo): void {
		if (!this.listEl) return;

		const row = this.listEl.createEl("div", { cls: "ghvault-file-history-row" });
		Object.assign(row.style, {
			padding: "10px 0",
			borderBottom: "1px solid var(--background-modifier-border)",
			cursor: "pointer",
		});

		const firstLine = commit.message.split("\n")[0];
		const truncated = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
		const msgEl = row.createEl("div", { text: truncated });
		Object.assign(msgEl.style, { fontWeight: "500" });

		const meta = row.createEl("div", {
			text: `${commit.authorName}, ${formatRelativeDate(commit.date)}`,
		});
		Object.assign(meta.style, {
			color: "var(--text-muted)",
			fontSize: "12px",
			marginTop: "4px",
		});

		row.addEventListener("click", () => {
			window.open(commit.htmlUrl, "_blank");
		});
	}
}

function formatRelativeDate(isoDate: string): string {
	const date = new Date(isoDate);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffMins = Math.floor(diffMs / 60000);

	if (diffMins < 1) return "just now";
	if (diffMins < 60) return `${diffMins}m ago`;

	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours}h ago`;

	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 30) return `${diffDays}d ago`;

	const diffMonths = Math.floor(diffDays / 30);
	if (diffMonths < 12) return `${diffMonths}mo ago`;

	return `${Math.floor(diffMonths / 12)}y ago`;
}
