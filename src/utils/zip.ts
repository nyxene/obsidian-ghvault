import { unzipSync, zipSync } from "fflate";

export const MAX_DECOMPRESSED_SIZE = 500 * 1024 * 1024; // 500MB
export const MAX_BACKUP_SIZE = 500 * 1024 * 1024; // 500MB

/**
 * Create a ZIP archive from a map of path → data entries.
 * Returns the ZIP as an ArrayBuffer.
 */
export function createZipFromEntries(entries: Record<string, Uint8Array>): ArrayBuffer {
	const zipped = zipSync(entries);
	return zipped.buffer.slice(
		zipped.byteOffset,
		zipped.byteOffset + zipped.byteLength,
	) as ArrayBuffer;
}

/**
 * Process ZIP entries one by one, stripping the root directory prefix
 * that GitHub adds to zipball downloads ({owner}-{repo}-{shortsha}/).
 *
 * Calls `onEntry` for each file (skips directories).
 * Throws if total decompressed size exceeds maxSize (ZIP bomb protection).
 */
export async function processZipEntries(
	zipBuffer: ArrayBuffer,
	onEntry: (path: string, data: Uint8Array) => Promise<void>,
	maxSize = MAX_DECOMPRESSED_SIZE,
): Promise<number> {
	const entries = unzipSync(new Uint8Array(zipBuffer));

	// Check total decompressed size before processing (ZIP bomb protection)
	let totalSize = 0;
	for (const data of Object.values(entries)) {
		totalSize += data.length;
	}
	if (totalSize > maxSize) {
		throw new Error(
			`ZIP decompressed size ${Math.round(totalSize / 1024 / 1024)}MB exceeds limit of ${Math.round(maxSize / 1024 / 1024)}MB`,
		);
	}

	let processed = 0;

	for (const [rawPath, data] of Object.entries(entries)) {
		// Skip directories (end with / or have zero-length data)
		if (rawPath.endsWith("/") || data.length === 0) continue;

		// Strip root directory prefix: "owner-repo-shortsha/path" → "path"
		const slashIndex = rawPath.indexOf("/");
		if (slashIndex === -1) continue;
		const path = rawPath.slice(slashIndex + 1);
		if (!path) continue;

		await onEntry(path, data);
		processed++;
	}

	return processed;
}
