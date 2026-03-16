import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { processZipEntries } from "./zip";

function createZip(files: Record<string, string>): ArrayBuffer {
	const entries: Record<string, Uint8Array> = {};
	for (const [path, content] of Object.entries(files)) {
		entries[path] = new TextEncoder().encode(content);
	}
	const zipped = zipSync(entries);
	return zipped.buffer.slice(
		zipped.byteOffset,
		zipped.byteOffset + zipped.byteLength,
	) as ArrayBuffer;
}

describe("processZipEntries", () => {
	it("extracts files and strips root directory prefix", async () => {
		const zip = createZip({
			"owner-repo-abc123/note.md": "hello",
			"owner-repo-abc123/docs/readme.md": "world",
		});

		const extracted: Array<{ path: string; content: string }> = [];
		const count = await processZipEntries(zip, async (path, data) => {
			extracted.push({ path, content: new TextDecoder().decode(data) });
		});

		expect(count).toBe(2);
		expect(extracted).toContainEqual({ path: "note.md", content: "hello" });
		expect(extracted).toContainEqual({ path: "docs/readme.md", content: "world" });
	});

	it("skips directory entries", async () => {
		const zip = createZip({
			"root/": "",
			"root/dir/": "",
			"root/file.md": "content",
		});

		const paths: string[] = [];
		await processZipEntries(zip, async (path) => {
			paths.push(path);
		});

		expect(paths).toEqual(["file.md"]);
	});

	it("returns 0 for empty ZIP", async () => {
		const zip = createZip({});

		const count = await processZipEntries(zip, async () => {});

		expect(count).toBe(0);
	});

	it("handles binary content", async () => {
		const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
		const entries: Record<string, Uint8Array> = {
			"root/image.png": binaryData,
		};
		const zipped = zipSync(entries);
		const zip = zipped.buffer.slice(
			zipped.byteOffset,
			zipped.byteOffset + zipped.byteLength,
		) as ArrayBuffer;

		const extracted: Uint8Array[] = [];
		await processZipEntries(zip, async (_path, data) => {
			extracted.push(data);
		});

		expect(extracted).toHaveLength(1);
		expect(Array.from(extracted[0])).toEqual(Array.from(binaryData));
	});

	it("calls onEntry sequentially (awaits each)", async () => {
		const zip = createZip({
			"root/a.md": "a",
			"root/b.md": "b",
			"root/c.md": "c",
		});

		const order: string[] = [];
		await processZipEntries(zip, async (path) => {
			order.push(`start-${path}`);
			await new Promise((r) => setTimeout(r, 10));
			order.push(`end-${path}`);
		});

		// Each entry should complete before next starts
		expect(order).toEqual([
			"start-a.md",
			"end-a.md",
			"start-b.md",
			"end-b.md",
			"start-c.md",
			"end-c.md",
		]);
	});
});
