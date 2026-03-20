import type { Vault } from "obsidian";
import type { SHACacheEntry } from "../types";
import { hasBinaryContent } from "../utils/binary";
import { pMap } from "../utils/concurrency";
import { computeHash, computeHashFromBuffer } from "../utils/hash";
import { isExcluded } from "../utils/path";
import type { LocalFileInfo } from "./comparator";
import type { SyncVault } from "./engine";

const LIST_FILES_CONCURRENCY = 20;

/** Extensions known to be text — use fast cachedRead path */
const TEXT_EXTENSIONS = new Set([
	"md",
	"txt",
	"json",
	"yaml",
	"yml",
	"css",
	"js",
	"ts",
	"html",
	"xml",
	"csv",
	"svg",
	"canvas",
	"bib",
	"tex",
	"rst",
	"org",
	"ini",
	"toml",
	"cfg",
]);

export class ObsidianVaultAdapter implements SyncVault {
	private readonly vault: Vault;
	private readonly excludePatterns?: readonly string[];

	constructor(vault: Vault, excludePatterns?: readonly string[]) {
		this.vault = vault;
		this.excludePatterns = excludePatterns;
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

	async readFileBinary(path: string): Promise<ArrayBuffer> {
		const file = this.vault.getFileByPath(path);
		if (!file) {
			throw new Error(`File not found: ${path}`);
		}
		return this.vault.readBinary(file);
	}

	async writeFileBinary(path: string, data: ArrayBuffer): Promise<void> {
		const existing = this.vault.getFileByPath(path);
		if (existing) {
			await this.vault.modifyBinary(existing, data);
		} else {
			await this.ensureParentDir(path);
			await this.vault.createBinary(path, data);
		}
	}

	async deleteFile(path: string): Promise<void> {
		const file = this.vault.getFileByPath(path);
		if (file) {
			await this.vault.trash(file, false);
		}
	}

	async renameFile(oldPath: string, newPath: string): Promise<void> {
		const file = this.vault.getFileByPath(oldPath);
		if (!file) {
			throw new Error(`File not found: ${oldPath}`);
		}
		await this.ensureParentDir(newPath);
		await this.vault.rename(file, newPath);
	}

	async listFiles(cache?: Readonly<Record<string, SHACacheEntry>>): Promise<LocalFileInfo[]> {
		const allFiles = this.vault.getFiles();
		const files = allFiles.filter((f) => !isExcluded(f.path, this.excludePatterns));

		return pMap(
			files,
			async (file) => {
				// Skip hashing if file unchanged since last sync (mtime optimization)
				if (cache) {
					const cached = cache[file.path];
					if (cached && file.stat.mtime <= cached.lastSyncedAt && file.stat.size === cached.size) {
						return {
							path: file.path,
							contentHash: cached.localContentHash,
							size: file.stat.size,
							isBinary: cached.isBinary,
						};
					}
				}

				const ext = file.extension.toLowerCase();
				if (TEXT_EXTENSIONS.has(ext)) {
					const content = await this.vault.cachedRead(file);
					const contentHash = await computeHash(content);
					return { path: file.path, contentHash, size: file.stat.size, isBinary: false };
				}
				const binaryData = await this.vault.readBinary(file);
				const bytes = new Uint8Array(binaryData);
				const isBinary = hasBinaryContent(bytes);
				const contentHash = await computeHashFromBuffer(binaryData);
				return { path: file.path, contentHash, size: file.stat.size, isBinary };
			},
			LIST_FILES_CONCURRENCY,
		);
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
