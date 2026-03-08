import type { Vault } from "obsidian";
import { computeHash } from "../utils/hash";
import { isExcluded } from "../utils/path";
import type { LocalFileInfo } from "./comparator";
import type { SyncVault } from "./engine";

export class ObsidianVaultAdapter implements SyncVault {
	private readonly vault: Vault;

	constructor(vault: Vault) {
		this.vault = vault;
	}

	async readFile(path: string): Promise<string> {
		const file = this.vault.getFileByPath(path);
		if (!file) {
			throw new Error(`File not found: ${path}`);
		}
		return this.vault.read(file);
	}

	async writeFile(path: string, content: string): Promise<void> {
		const existing = this.vault.getFileByPath(path);
		if (existing) {
			await this.vault.modify(existing, content);
		} else {
			await this.ensureParentDir(path);
			await this.vault.create(path, content);
		}
	}

	async deleteFile(path: string): Promise<void> {
		const file = this.vault.getFileByPath(path);
		if (file) {
			await this.vault.trash(file, false);
		}
	}

	async listFiles(): Promise<LocalFileInfo[]> {
		const files = this.vault.getFiles();
		const result: LocalFileInfo[] = [];

		for (const file of files) {
			if (isExcluded(file.path)) continue;

			const content = await this.vault.cachedRead(file);
			const contentHash = await computeHash(content);

			result.push({
				path: file.path,
				contentHash,
				size: file.stat.size,
			});
		}

		return result;
	}

	private async ensureParentDir(filePath: string): Promise<void> {
		const parts = filePath.split("/");
		if (parts.length <= 1) return;

		const dirPath = parts.slice(0, -1).join("/");
		const existing = this.vault.getFolderByPath(dirPath);
		if (!existing) {
			await this.vault.createFolder(dirPath);
		}
	}
}
