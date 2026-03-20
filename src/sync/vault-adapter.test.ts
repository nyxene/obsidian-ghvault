import type { TFile, TFolder, Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { ObsidianVaultAdapter } from "./vault-adapter";

vi.mock("../utils/hash", () => ({
	computeHash: vi
		.fn()
		.mockImplementation((content: string) => Promise.resolve(`hash-${content.length}`)),
	computeHashFromBuffer: vi.fn().mockImplementation((data: ArrayBuffer | Uint8Array) => {
		const len = data instanceof Uint8Array ? data.length : data.byteLength;
		return Promise.resolve(`hash-${len}`);
	}),
}));

// ---------------------------------------------------------------------------
// Mock Obsidian Vault
// ---------------------------------------------------------------------------

interface MockFileEntry {
	path: string;
	content: string;
	size: number;
}

function createMockFile(path: string, size = 100): TFile {
	const name = path.split("/").pop() ?? path;
	return {
		path,
		name,
		basename: name.replace(/\.[^.]+$/, ""),
		extension: name.includes(".") ? (name.split(".").pop() ?? "") : "",
		stat: { size, ctime: Date.now(), mtime: Date.now() },
		vault: {},
		parent: null,
	} as unknown as TFile;
}

function createMockVault(files: MockFileEntry[] = []): Vault {
	const fileMap = new Map<string, MockFileEntry>();
	const tfiles = new Map<string, TFile>();
	const folders = new Set<string>();

	for (const f of files) {
		fileMap.set(f.path, f);
		tfiles.set(f.path, createMockFile(f.path, f.size));
	}

	return {
		getFileByPath: vi.fn((path: string) => tfiles.get(path) ?? null),
		getFolderByPath: vi.fn((path: string) => {
			if (folders.has(path)) {
				return { path } as TFolder;
			}
			return null;
		}),
		read: vi.fn(async (file: TFile) => {
			const entry = fileMap.get(file.path);
			if (!entry) throw new Error(`File not found: ${file.path}`);
			return entry.content;
		}),
		readBinary: vi.fn(async (file: TFile) => {
			const entry = fileMap.get(file.path);
			if (!entry) throw new Error(`File not found: ${file.path}`);
			return new TextEncoder().encode(entry.content).buffer as ArrayBuffer;
		}),
		cachedRead: vi.fn(async (file: TFile) => {
			const entry = fileMap.get(file.path);
			if (!entry) throw new Error(`File not found: ${file.path}`);
			return entry.content;
		}),
		modify: vi.fn(async (file: TFile, content: string) => {
			const entry = fileMap.get(file.path);
			if (entry) {
				entry.content = content;
			}
		}),
		modifyBinary: vi.fn(async (file: TFile, data: ArrayBuffer) => {
			const entry = fileMap.get(file.path);
			if (entry) {
				entry.content = new TextDecoder().decode(data);
			}
		}),
		create: vi.fn(async (path: string, content: string) => {
			const f: MockFileEntry = { path, content, size: content.length };
			fileMap.set(path, f);
			const tf = createMockFile(path, content.length);
			tfiles.set(path, tf);
			return tf;
		}),
		createBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
			const content = new TextDecoder().decode(data);
			const f: MockFileEntry = { path, content, size: data.byteLength };
			fileMap.set(path, f);
			const tf = createMockFile(path, data.byteLength);
			tfiles.set(path, tf);
			return tf;
		}),
		createFolder: vi.fn(async (path: string) => {
			folders.add(path);
		}),
		trash: vi.fn(async (file: TFile) => {
			fileMap.delete(file.path);
			tfiles.delete(file.path);
		}),
		getFiles: vi.fn(() => Array.from(tfiles.values())),
	} as unknown as Vault;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ObsidianVaultAdapter", () => {
	describe("readFile", () => {
		it("reads content from existing file", async () => {
			const vault = createMockVault([{ path: "notes/hello.md", content: "Hello World", size: 11 }]);
			const adapter = new ObsidianVaultAdapter(vault);

			const content = await adapter.readFile("notes/hello.md");

			expect(content).toBe("Hello World");
			expect(vault.read).toHaveBeenCalled();
		});

		it("throws when file does not exist", async () => {
			const vault = createMockVault([]);
			const adapter = new ObsidianVaultAdapter(vault);

			await expect(adapter.readFile("missing.md")).rejects.toThrow("File not found: missing.md");
		});
	});

	describe("writeFile", () => {
		it("modifies existing file", async () => {
			const vault = createMockVault([{ path: "doc.md", content: "old content", size: 11 }]);
			const adapter = new ObsidianVaultAdapter(vault);

			await adapter.writeFile("doc.md", "new content");

			expect(vault.modify).toHaveBeenCalled();
		});

		it("creates new file when it does not exist", async () => {
			const vault = createMockVault([]);
			const adapter = new ObsidianVaultAdapter(vault);

			await adapter.writeFile("new-file.md", "fresh content");

			expect(vault.create).toHaveBeenCalledWith("new-file.md", "fresh content");
		});

		it("ensures parent directory before creating file", async () => {
			const vault = createMockVault([]);
			const adapter = new ObsidianVaultAdapter(vault);

			await adapter.writeFile("deep/nested/file.md", "content");

			expect(vault.createFolder).toHaveBeenCalledWith("deep/nested");
			expect(vault.create).toHaveBeenCalledWith("deep/nested/file.md", "content");
		});

		it("skips folder creation when parent already exists", async () => {
			const vault = createMockVault([]);
			// Simulate existing folder
			vi.mocked(vault.getFolderByPath).mockReturnValue({ path: "existing" } as TFolder);
			const adapter = new ObsidianVaultAdapter(vault);

			await adapter.writeFile("existing/file.md", "content");

			expect(vault.createFolder).not.toHaveBeenCalled();
		});
	});

	describe("deleteFile", () => {
		it("trashes existing file", async () => {
			const vault = createMockVault([{ path: "to-delete.md", content: "bye", size: 3 }]);
			const adapter = new ObsidianVaultAdapter(vault);

			await adapter.deleteFile("to-delete.md");

			expect(vault.trash).toHaveBeenCalled();
			const trashCall = vi.mocked(vault.trash).mock.calls[0];
			expect((trashCall[0] as TFile).path).toBe("to-delete.md");
			expect(trashCall[1]).toBe(false);
		});

		it("does nothing when file does not exist", async () => {
			const vault = createMockVault([]);
			const adapter = new ObsidianVaultAdapter(vault);

			// Should not throw
			await adapter.deleteFile("nonexistent.md");

			expect(vault.trash).not.toHaveBeenCalled();
		});
	});

	describe("listFiles", () => {
		it("returns all non-excluded files with content hashes", async () => {
			const vault = createMockVault([
				{ path: "note-a.md", content: "aaa", size: 3 },
				{ path: "note-b.md", content: "bbb", size: 3 },
			]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles();

			expect(files).toHaveLength(2);
			expect(files[0].path).toBe("note-a.md");
			expect(files[0].contentHash).toBeDefined();
			expect(files[0].size).toBe(3);
			expect(files[1].path).toBe("note-b.md");
		});

		it("excludes .obsidian/ files", async () => {
			const vault = createMockVault([
				{ path: ".obsidian/config.json", content: "{}", size: 2 },
				{ path: "real-note.md", content: "real", size: 4 },
			]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles();

			expect(files).toHaveLength(1);
			expect(files[0].path).toBe("real-note.md");
		});

		it("excludes .trash/ files", async () => {
			const vault = createMockVault([
				{ path: ".trash/old-note.md", content: "old", size: 3 },
				{ path: "active-note.md", content: "active", size: 6 },
			]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles();

			expect(files).toHaveLength(1);
			expect(files[0].path).toBe("active-note.md");
		});

		it("excludes ghvault.log", async () => {
			const vault = createMockVault([
				{ path: "ghvault.log", content: "log data", size: 8 },
				{ path: "readme.md", content: "readme", size: 6 },
			]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles();

			expect(files).toHaveLength(1);
			expect(files[0].path).toBe("readme.md");
		});

		it("returns empty array for empty vault", async () => {
			const vault = createMockVault([]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles();

			expect(files).toEqual([]);
		});

		it("excludes multiple excluded patterns simultaneously", async () => {
			const vault = createMockVault([
				{ path: ".obsidian/plugins/foo.json", content: "{}", size: 2 },
				{ path: ".trash/deleted.md", content: "gone", size: 4 },
				{ path: "ghvault.log", content: "log", size: 3 },
				{ path: ".ghvault", content: "init", size: 4 },
				{ path: "notes/real.md", content: "keep", size: 4 },
				{ path: "todo.md", content: "tasks", size: 5 },
			]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles();

			const paths = files.map((f) => f.path);
			expect(paths).toEqual(["notes/real.md", "todo.md"]);
		});
	});

	describe("readFileBinary", () => {
		it("reads binary content from existing file", async () => {
			const vault = createMockVault([{ path: "image.png", content: "PNG data", size: 8 }]);
			const adapter = new ObsidianVaultAdapter(vault);

			const buffer = await adapter.readFileBinary("image.png");

			expect(buffer).toBeInstanceOf(ArrayBuffer);
			expect(vault.readBinary).toHaveBeenCalled();
			const bytes = new Uint8Array(buffer);
			expect(new TextDecoder().decode(bytes)).toBe("PNG data");
		});

		it("throws when file does not exist", async () => {
			const vault = createMockVault([]);
			const adapter = new ObsidianVaultAdapter(vault);

			await expect(adapter.readFileBinary("missing.png")).rejects.toThrow(
				"File not found: missing.png",
			);
		});
	});

	describe("writeFileBinary", () => {
		it("modifies existing file with binary data", async () => {
			const vault = createMockVault([{ path: "image.png", content: "old", size: 3 }]);
			const adapter = new ObsidianVaultAdapter(vault);
			const newData = new TextEncoder().encode("new binary").buffer as ArrayBuffer;

			await adapter.writeFileBinary("image.png", newData);

			expect(vault.modifyBinary).toHaveBeenCalled();
		});

		it("creates new binary file when it does not exist", async () => {
			const vault = createMockVault([]);
			const adapter = new ObsidianVaultAdapter(vault);
			const data = new TextEncoder().encode("fresh binary").buffer as ArrayBuffer;

			await adapter.writeFileBinary("new-image.png", data);

			expect(vault.createBinary).toHaveBeenCalledWith("new-image.png", data);
		});

		it("ensures parent directory before creating binary file", async () => {
			const vault = createMockVault([]);
			const adapter = new ObsidianVaultAdapter(vault);
			const data = new TextEncoder().encode("data").buffer as ArrayBuffer;

			await adapter.writeFileBinary("assets/images/photo.png", data);

			expect(vault.createFolder).toHaveBeenCalledWith("assets/images");
			expect(vault.createBinary).toHaveBeenCalledWith("assets/images/photo.png", data);
		});
	});

	describe("listFiles — binary handling", () => {
		it("uses readBinary for non-text extensions and returns isBinary: true", async () => {
			const vault = createMockVault([{ path: "photo.png", content: "\x89PNG\x00", size: 5 }]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles();

			expect(files).toHaveLength(1);
			expect(files[0].isBinary).toBe(true);
			expect(files[0].path).toBe("photo.png");
			expect(vault.readBinary).toHaveBeenCalled();
			expect(vault.cachedRead).not.toHaveBeenCalled();
		});

		it("uses cachedRead for text extensions and returns isBinary: false", async () => {
			const vault = createMockVault([{ path: "note.md", content: "hello", size: 5 }]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles();

			expect(files).toHaveLength(1);
			expect(files[0].isBinary).toBe(false);
			expect(vault.cachedRead).toHaveBeenCalled();
			expect(vault.readBinary).not.toHaveBeenCalled();
		});

		it("handles mixed text and binary files", async () => {
			const vault = createMockVault([
				{ path: "readme.md", content: "# Hello", size: 7 },
				{ path: "logo.png", content: "\x89PNG\x00", size: 5 },
				{ path: "data.json", content: '{"a":1}', size: 7 },
				{ path: "photo.jpg", content: "\xff\xd8\xff\x00", size: 4 },
			]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles();

			expect(files).toHaveLength(4);
			const byPath = new Map(files.map((f) => [f.path, f]));
			expect(byPath.get("readme.md")?.isBinary).toBe(false);
			expect(byPath.get("data.json")?.isBinary).toBe(false);
			expect(byPath.get("logo.png")?.isBinary).toBe(true);
			expect(byPath.get("photo.jpg")?.isBinary).toBe(true);

			// cachedRead for text, readBinary for non-text
			expect(vault.cachedRead).toHaveBeenCalledTimes(2);
			expect(vault.readBinary).toHaveBeenCalledTimes(2);
		});

		it("treats unknown extension as non-text (readBinary path)", async () => {
			const vault = createMockVault([{ path: "archive.zip", content: "PK\x00\x00", size: 4 }]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles();

			expect(files).toHaveLength(1);
			expect(vault.readBinary).toHaveBeenCalled();
			expect(vault.cachedRead).not.toHaveBeenCalled();
		});
	});

	describe("ensureParentDir", () => {
		it("creates nested directories for deep paths", async () => {
			const vault = createMockVault([]);
			const adapter = new ObsidianVaultAdapter(vault);

			await adapter.writeFile("a/b/c/file.md", "content");

			expect(vault.createFolder).toHaveBeenCalledWith("a/b/c");
		});

		it("skips directory creation for root-level files", async () => {
			const vault = createMockVault([]);
			const adapter = new ObsidianVaultAdapter(vault);

			await adapter.writeFile("root-file.md", "content");

			expect(vault.createFolder).not.toHaveBeenCalled();
		});
	});

	describe("listFiles with mtime optimization", () => {
		it("skips hashing when file mtime and size match cache", async () => {
			const vault = createMockVault([{ path: "note.md", content: "hello", size: 5 }]);
			// Set mtime to past
			const tfile = vault.getFileByPath("note.md") as TFile;
			tfile.stat.mtime = 1000;

			const adapter = new ObsidianVaultAdapter(vault);
			const cache = {
				"note.md": {
					remoteSha: "sha",
					localContentHash: "cached-hash",
					lastSyncedAt: 2000,
					size: 5,
					isBinary: false,
				},
			};

			const files = await adapter.listFiles(cache);

			expect(files).toHaveLength(1);
			expect(files[0].contentHash).toBe("cached-hash");
			// Should NOT have read the file
			expect(vault.cachedRead).not.toHaveBeenCalled();
		});

		it("hashes file when mtime is newer than cache", async () => {
			const vault = createMockVault([{ path: "note.md", content: "hello", size: 5 }]);
			const tfile = vault.getFileByPath("note.md") as TFile;
			tfile.stat.mtime = 3000;

			const adapter = new ObsidianVaultAdapter(vault);
			const cache = {
				"note.md": {
					remoteSha: "sha",
					localContentHash: "old-hash",
					lastSyncedAt: 2000,
					size: 5,
					isBinary: false,
				},
			};

			const files = await adapter.listFiles(cache);

			expect(files).toHaveLength(1);
			// Should have recomputed hash (not "old-hash")
			expect(files[0].contentHash).toBe("hash-5");
			expect(vault.cachedRead).toHaveBeenCalled();
		});

		it("hashes file when size differs from cache", async () => {
			const vault = createMockVault([{ path: "note.md", content: "hello world", size: 11 }]);
			const tfile = vault.getFileByPath("note.md") as TFile;
			tfile.stat.mtime = 1000;

			const adapter = new ObsidianVaultAdapter(vault);
			const cache = {
				"note.md": {
					remoteSha: "sha",
					localContentHash: "old-hash",
					lastSyncedAt: 2000,
					size: 5, // different from actual 11
					isBinary: false,
				},
			};

			const files = await adapter.listFiles(cache);

			expect(files[0].contentHash).toBe("hash-11");
		});

		it("hashes file when not in cache", async () => {
			const vault = createMockVault([{ path: "new.md", content: "new", size: 3 }]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles({});

			expect(files[0].contentHash).toBe("hash-3");
		});

		it("hashes all files when no cache provided", async () => {
			const vault = createMockVault([{ path: "a.md", content: "aaa", size: 3 }]);
			const adapter = new ObsidianVaultAdapter(vault);

			const files = await adapter.listFiles();

			expect(files[0].contentHash).toBe("hash-3");
			expect(vault.cachedRead).toHaveBeenCalled();
		});
	});
});
