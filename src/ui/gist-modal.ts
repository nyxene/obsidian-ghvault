import { type App, Modal, Notice } from "obsidian";
import type { GitHubClient } from "../github/client";
import type { GistRecord } from "../types";

export interface GistModalResult {
	record: GistRecord;
}

export class GistModal extends Modal {
	private readonly filePath: string;
	private readonly fileName: string;
	private readonly fileContent: string;
	private readonly client: GitHubClient;
	private readonly existingGist: GistRecord | undefined;
	private resolvePromise: ((result: GistModalResult | null) => void) | null = null;

	constructor(
		app: App,
		filePath: string,
		fileName: string,
		fileContent: string,
		client: GitHubClient,
		existingGist?: GistRecord,
	) {
		super(app);
		this.filePath = filePath;
		this.fileName = fileName;
		this.fileContent = fileContent;
		this.client = client;
		this.existingGist = existingGist;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("ghvault-gist-modal");

		const title = this.existingGist ? "Update Gist" : "Share as Gist";
		contentEl.createEl("h2", { text: title });

		// File info
		const fileInfo = contentEl.createEl("div", { cls: "ghvault-gist-file" });
		Object.assign(fileInfo.style, {
			padding: "8px 12px",
			marginBottom: "12px",
			backgroundColor: "var(--background-secondary)",
			borderRadius: "4px",
			fontSize: "13px",
		});
		fileInfo.createEl("strong", { text: "File: " });
		fileInfo.createEl("span", { text: this.filePath });

		// Visibility (only for new gists)
		let isPublic = this.existingGist?.isPublic ?? false;
		if (!this.existingGist) {
			const visGroup = contentEl.createEl("div", { cls: "ghvault-gist-visibility" });
			Object.assign(visGroup.style, { marginBottom: "12px" });
			visGroup.createEl("label", { text: "Visibility:" });
			Object.assign(visGroup.style, { display: "flex", gap: "16px", alignItems: "center" });

			const secretLabel = visGroup.createEl("label");
			Object.assign(secretLabel.style, { display: "flex", alignItems: "center", gap: "4px" });
			const secretRadio = secretLabel.createEl("input") as HTMLInputElement;
			secretRadio.type = "radio";
			secretRadio.name = "gist-visibility";
			secretRadio.checked = true;
			secretLabel.createEl("span", { text: "Secret" });

			const publicLabel = visGroup.createEl("label");
			Object.assign(publicLabel.style, { display: "flex", alignItems: "center", gap: "4px" });
			const publicRadio = publicLabel.createEl("input") as HTMLInputElement;
			publicRadio.type = "radio";
			publicRadio.name = "gist-visibility";
			publicLabel.createEl("span", { text: "Public" });

			secretRadio.addEventListener("change", () => {
				isPublic = false;
			});
			publicRadio.addEventListener("change", () => {
				isPublic = true;
			});
		}

		// Description
		const descGroup = contentEl.createEl("div", { cls: "ghvault-gist-description" });
		Object.assign(descGroup.style, { marginBottom: "16px" });
		descGroup.createEl("label", { text: "Description:" });
		Object.assign(descGroup.style, { display: "flex", flexDirection: "column", gap: "4px" });
		const descInput = descGroup.createEl("input") as HTMLInputElement;
		descInput.type = "text";
		descInput.value = this.existingGist?.description ?? this.fileName;
		descInput.placeholder = "Optional description";
		Object.assign(descInput.style, { width: "100%" });

		// Footer
		const footer = contentEl.createEl("div", { cls: "ghvault-gist-footer" });
		Object.assign(footer.style, {
			display: "flex",
			justifyContent: "flex-end",
			gap: "8px",
			marginTop: "8px",
			paddingTop: "12px",
			borderTop: "1px solid var(--background-modifier-border)",
		});

		const cancelBtn = footer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => {
			this.resolveWith(null);
		});

		const shareBtn = footer.createEl("button", {
			text: this.existingGist ? "Update" : "Share",
			cls: "mod-cta",
		});
		shareBtn.addEventListener("click", async () => {
			shareBtn.disabled = true;
			shareBtn.setText("Sharing...");

			try {
				const description = descInput.value.trim();
				let result: { id: string; htmlUrl: string };

				if (this.existingGist) {
					result = await this.client.updateGist(this.existingGist.gistId, {
						filename: this.fileName,
						content: this.fileContent,
						description,
					});
				} else {
					result = await this.client.createGist({
						filename: this.fileName,
						content: this.fileContent,
						description,
						isPublic: isPublic,
					});
				}

				await this.copyToClipboard(result.htmlUrl);

				const now = Date.now();
				const record: GistRecord = {
					gistId: result.id,
					htmlUrl: result.htmlUrl,
					isPublic: this.existingGist?.isPublic ?? isPublic,
					vaultPath: this.filePath,
					description,
					createdAt: this.existingGist?.createdAt ?? now,
					updatedAt: now,
				};

				this.resolveWith(record);
			} catch (error: unknown) {
				shareBtn.disabled = false;
				shareBtn.setText(this.existingGist ? "Update" : "Share");
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("403") || message.includes("denied")) {
					new Notice("GHVault: Token missing gist scope. Add 'gists' permission to your PAT.");
				} else {
					new Notice(`GHVault: Failed to share — ${message}`);
				}
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.resolvePromise) {
			this.resolvePromise(null);
			this.resolvePromise = null;
		}
	}

	waitForResult(): Promise<GistModalResult | null> {
		return new Promise<GistModalResult | null>((resolve) => {
			this.resolvePromise = resolve;
		});
	}

	private resolveWith(record: GistRecord | null): void {
		if (this.resolvePromise) {
			this.resolvePromise(record ? { record } : null);
			this.resolvePromise = null;
		}
		this.close();
	}

	private async copyToClipboard(url: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(url);
			new Notice("GHVault: Gist URL copied to clipboard");
		} catch {
			new Notice(`GHVault: Gist created — ${url}`);
		}
	}
}
