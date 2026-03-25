import { type App, Modal, Notice } from "obsidian";
import type { GitHubClient } from "../github/client";
import type { BackupRecord } from "../types";

export class BackupModal extends Modal {
	private readonly client: GitHubClient;
	private readonly onRestore: (backup: BackupRecord) => Promise<void>;
	private readonly onDelete: (backup: BackupRecord) => Promise<void>;
	private cachedBackups: BackupRecord[] = [];

	constructor(
		app: App,
		client: GitHubClient,
		onRestore: (backup: BackupRecord) => Promise<void>,
		onDelete: (backup: BackupRecord) => Promise<void>,
	) {
		super(app);
		this.client = client;
		this.onRestore = onRestore;
		this.onDelete = onDelete;
	}

	onOpen(): void {
		this.renderLoading();
		this.loadBackups();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderLoading(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ghvault-backup-manager");
		contentEl.createEl("h2", { text: "Vault Backups" });
		const loading = contentEl.createEl("div", { text: "Loading backups..." });
		Object.assign(loading.style, {
			padding: "16px",
			color: "var(--text-muted)",
			fontStyle: "italic",
		});
	}

	private async loadBackups(): Promise<void> {
		try {
			const backups = await this.client.listReleases();
			this.cachedBackups = backups;
			this.render(backups);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			if (this.cachedBackups.length > 0) {
				new Notice(`GHVault: Failed to refresh backups — ${message}`);
				this.render(this.cachedBackups);
			} else {
				this.renderError(message);
			}
		}
	}

	private renderError(message: string): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ghvault-backup-manager");
		contentEl.createEl("h2", { text: "Vault Backups" });

		const errorEl = contentEl.createEl("div", {
			text: `Failed to load backups: ${message}`,
		});
		Object.assign(errorEl.style, {
			padding: "16px",
			color: "var(--text-error)",
			fontSize: "12px",
		});

		const retryBtn = contentEl.createEl("button", { text: "Retry" });
		Object.assign(retryBtn.style, { marginLeft: "16px" });
		retryBtn.addEventListener("click", () => {
			this.renderLoading();
			this.loadBackups();
		});

		const footer = contentEl.createEl("div");
		Object.assign(footer.style, {
			display: "flex",
			justifyContent: "flex-end",
			marginTop: "16px",
			paddingTop: "12px",
			borderTop: "1px solid var(--background-modifier-border)",
		});
		const closeBtn = footer.createEl("button", { text: "Close" });
		closeBtn.addEventListener("click", () => {
			this.close();
		});
	}

	private render(backups: BackupRecord[]): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ghvault-backup-manager");

		contentEl.createEl("h2", {
			text: `Vault Backups (${backups.length})`,
		});

		if (backups.length === 0) {
			const empty = contentEl.createEl("div", { text: "No backups yet." });
			Object.assign(empty.style, {
				padding: "16px",
				color: "var(--text-muted)",
				fontStyle: "italic",
			});
		}

		for (const backup of backups) {
			this.renderBackupEntry(contentEl, backup);
		}

		// Footer
		const footer = contentEl.createEl("div", { cls: "ghvault-backup-manager-footer" });
		Object.assign(footer.style, {
			display: "flex",
			justifyContent: "flex-end",
			marginTop: "16px",
			paddingTop: "12px",
			borderTop: "1px solid var(--background-modifier-border)",
		});

		const closeBtn = footer.createEl("button", { text: "Close" });
		closeBtn.addEventListener("click", () => {
			this.close();
		});
	}

	private renderBackupEntry(parent: HTMLElement, backup: BackupRecord): void {
		const card = parent.createEl("div", { cls: "ghvault-backup-entry" });
		Object.assign(card.style, {
			padding: "12px",
			marginBottom: "8px",
			border: "1px solid var(--background-modifier-border)",
			borderRadius: "4px",
		});

		// Header: icon + tag name
		const header = card.createEl("div");
		Object.assign(header.style, {
			display: "flex",
			alignItems: "center",
			gap: "6px",
			marginBottom: "4px",
		});

		header.createEl("span", { text: "\uD83D\uDCE6" });
		const tagEl = header.createEl("span", { text: backup.tagName });
		Object.assign(tagEl.style, { fontWeight: "600", fontSize: "13px" });

		const sizeText = formatSize(backup.assetSize);
		const sizeEl = header.createEl("span", { text: sizeText });
		Object.assign(sizeEl.style, {
			fontSize: "10px",
			color: "var(--text-muted)",
			marginLeft: "auto",
		});

		// Date
		const date = new Date(backup.createdAt);
		const dateStr = `${date.toLocaleDateString()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
		const dateEl = card.createEl("div", { text: `Created: ${dateStr}` });
		Object.assign(dateEl.style, {
			fontSize: "11px",
			color: "var(--text-muted)",
			marginBottom: "8px",
		});

		// Action buttons
		const actions = card.createEl("div", { cls: "ghvault-backup-actions" });
		Object.assign(actions.style, { display: "flex", gap: "8px" });

		const copyBtn = actions.createEl("button", { text: "Copy URL" });
		Object.assign(copyBtn.style, { fontSize: "12px" });
		copyBtn.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(backup.htmlUrl);
				new Notice("GHVault: URL copied to clipboard");
			} catch {
				new Notice(`GHVault: ${backup.htmlUrl}`);
			}
		});

		const restoreBtn = actions.createEl("button", { text: "Restore" });
		Object.assign(restoreBtn.style, { fontSize: "12px" });
		restoreBtn.addEventListener("click", () => {
			this.showRestoreConfirmation(backup);
		});

		const deleteBtn = actions.createEl("button", { text: "Delete" });
		Object.assign(deleteBtn.style, { fontSize: "12px", color: "var(--text-error)" });
		deleteBtn.addEventListener("click", async () => {
			deleteBtn.disabled = true;
			deleteBtn.setText("Deleting...");
			try {
				await this.onDelete(backup);
				new Notice("GHVault: Backup deleted");
				await this.loadBackups();
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`GHVault: Delete failed — ${message}`);
				deleteBtn.disabled = false;
				deleteBtn.setText("Delete");
			}
		});
	}

	private showRestoreConfirmation(backup: BackupRecord): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ghvault-backup-manager");

		contentEl.createEl("h2", { text: "Confirm Restore" });

		const msg = contentEl.createEl("p", {
			text: "This will overwrite all current vault files. Continue?",
		});
		Object.assign(msg.style, { marginBottom: "16px" });

		const info = contentEl.createEl("div", { text: `Backup: ${backup.tagName}` });
		Object.assign(info.style, {
			fontSize: "12px",
			color: "var(--text-muted)",
			marginBottom: "16px",
		});

		const btnRow = contentEl.createEl("div");
		Object.assign(btnRow.style, { display: "flex", gap: "8px", justifyContent: "flex-end" });

		const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => {
			this.render(this.cachedBackups);
		});

		const confirmBtn = btnRow.createEl("button", { text: "Restore" });
		Object.assign(confirmBtn.style, { fontWeight: "600" });
		confirmBtn.addEventListener("click", async () => {
			confirmBtn.disabled = true;
			confirmBtn.setText("Restoring...");
			try {
				await this.onRestore(backup);
				this.close();
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`GHVault: Restore failed — ${message}`);
				confirmBtn.disabled = false;
				confirmBtn.setText("Restore");
			}
		});
	}
}

export function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const mb = bytes / (1024 * 1024);
	if (mb >= 1) return `${mb.toFixed(1)} MB`;
	const kb = bytes / 1024;
	return `${kb.toFixed(1)} KB`;
}
