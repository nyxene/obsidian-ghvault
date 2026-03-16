import { unzipSync } from "fflate";

/**
 * Process ZIP entries one by one, stripping the root directory prefix
 * that GitHub adds to zipball downloads ({owner}-{repo}-{shortsha}/).
 *
 * Calls `onEntry` for each file (skips directories). Memory-efficient:
 * fflate's unzipSync decompresses all at once, but we process and release
 * entries sequentially via the callback.
 */
export async function processZipEntries(
	zipBuffer: ArrayBuffer,
	onEntry: (path: string, data: Uint8Array) => Promise<void>,
): Promise<number> {
	const entries = unzipSync(new Uint8Array(zipBuffer));
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
