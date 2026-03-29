import { type App, Modal, Notice } from "obsidian";
import type { GitHubClient } from "../github/client";
import type { GistRecord } from "../types";

export class GistManagerModal extends Modal {
	private readonly client: GitHubClient;
	private registry: Record<string, GistRecord>;
	private readonly onRegistryChange: (registry: Record<string, GistRecord>) => void;
	private readonly readFileContent: (path: string) => Promise<string>;

	constructor(
		app: App,
		client: GitHubClient,
		registry: Record<string, GistRecord>,
		onRegistryChange: (registry: Record<string, GistRecord>) => void,
		readFileContent: (path: string) => Promise<string>,
	) {
		super(app);
		this.client = client;
		this.registry = { ...registry };
		this.onRegistryChange = onRegistryChange;
		this.readFileContent = readFileContent;
	}

	onOpen(): void {
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ghvault-gist-manager");

		const entries = Object.values(this.registry).sort((a, b) => b.updatedAt - a.updatedAt);

		contentEl.createEl("h2", {
			text: `Shared Gists (${entries.length})`,
		});

		if (entries.length === 0) {
			const empty = contentEl.createEl("div", { text: "No gists shared yet." });
			Object.assign(empty.style, {
				padding: "16px",
				color: "var(--text-muted)",
				fontStyle: "italic",
			});
		}

		for (const entry of entries) {
			this.renderGistEntry(contentEl, entry);
		}

		// Footer
		const footer = contentEl.createEl("div", { cls: "ghvault-gist-manager-footer" });
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

	private renderGistEntry(parent: HTMLElement, entry: GistRecord): void {
		const card = parent.createEl("div", { cls: "ghvault-gist-entry" });
		Object.assign(card.style, {
			padding: "12px",
			marginBottom: "8px",
			border: "1px solid var(--background-modifier-border)",
			borderRadius: "4px",
		});

		// Header: icon + path
		const header = card.createEl("div");
		Object.assign(header.style, {
			display: "flex",
			alignItems: "center",
			gap: "6px",
			marginBottom: "4px",
		});

		header.createEl("span", { text: entry.isPublic ? "🌐" : "🔒" });
		const pathEl = header.createEl("span", { text: entry.vaultPath });
		Object.assign(pathEl.style, { fontWeight: "600", fontSize: "13px" });

		const visibility = header.createEl("span", {
			text: entry.isPublic ? "public" : "secret",
		});
		Object.assign(visibility.style, {
			fontSize: "10px",
			color: "var(--text-muted)",
			marginLeft: "auto",
		});

		// Description + date
		if (entry.description) {
			const desc = card.createEl("div", { text: entry.description });
			Object.assign(desc.style, {
				fontSize: "12px",
				color: "var(--text-muted)",
				marginBottom: "4px",
			});
		}

		const date = new Date(entry.updatedAt);
		const dateStr = `${date.toLocaleDateString()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
		const dateEl = card.createEl("div", { text: `Updated: ${dateStr}` });
		Object.assign(dateEl.style, {
			fontSize: "11px",
			color: "var(--text-muted)",
			marginBottom: "8px",
		});

		// Action buttons
		const actions = card.createEl("div", { cls: "ghvault-gist-actions" });
		Object.assign(actions.style, { display: "flex", gap: "8px" });

		const copyBtn = actions.createEl("button", { text: "Copy URL" });
		Object.assign(copyBtn.style, { fontSize: "12px" });
		copyBtn.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(entry.htmlUrl);
				new Notice("GHVault: URL copied to clipboard");
			} catch {
				new Notice(`GHVault: ${entry.htmlUrl}`);
			}
		});

		const updateBtn = actions.createEl("button", { text: "Update" });
		Object.assign(updateBtn.style, { fontSize: "12px" });
		updateBtn.addEventListener("click", async () => {
			updateBtn.disabled = true;
			updateBtn.setText("Updating...");
			try {
				const content = await this.readFileContent(entry.vaultPath);
				if (content.length > 1024 * 1024) {
					new Notice(
						"GHVault: File grew past 1MB limit. Delete this gist and re-share a smaller version.",
					);
					updateBtn.disabled = false;
					updateBtn.setText("Update");
					return;
				}
				const fileName = entry.vaultPath.split("/").pop() ?? entry.vaultPath;
				await this.client.updateGist(entry.gistId, {
					filename: fileName,
					content,
					description: entry.description,
				});
				entry.updatedAt = Date.now();
				this.onRegistryChange(this.registry);
				new Notice("GHVault: Gist updated");
				this.render();
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("404") || message.includes("Not Found")) {
					delete this.registry[entry.vaultPath];
					this.onRegistryChange(this.registry);
					new Notice("GHVault: Gist no longer exists — removed from registry");
					this.render();
				} else {
					new Notice(`GHVault: Update failed — ${message}`);
				}
				updateBtn.disabled = false;
				updateBtn.setText("Update");
			}
		});

		const deleteBtn = actions.createEl("button", { text: "Delete" });
		Object.assign(deleteBtn.style, { fontSize: "12px", color: "var(--text-error)" });
		deleteBtn.addEventListener("click", async () => {
			deleteBtn.disabled = true;
			deleteBtn.setText("Deleting...");
			try {
				await this.client.deleteGist(entry.gistId);
				delete this.registry[entry.vaultPath];
				this.onRegistryChange(this.registry);
				new Notice("GHVault: Gist deleted");
				this.render();
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				new Notice(`GHVault: Delete failed — ${message}`);
				deleteBtn.disabled = false;
				deleteBtn.setText("Delete");
			}
		});
	}
}
