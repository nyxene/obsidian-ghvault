const encoder = new TextEncoder();

export async function computeHash(content: string): Promise<string> {
	const data = encoder.encode(content);
	return computeHashFromBuffer(data);
}

export async function computeHashFromBuffer(data: ArrayBuffer | Uint8Array): Promise<string> {
	const source: BufferSource =
		data instanceof Uint8Array
			? data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
				? (data.buffer as ArrayBuffer)
				: (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength)
			: data;
	const buffer = await crypto.subtle.digest("SHA-256", source);
	const bytes = new Uint8Array(buffer);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export async function computeGitBlobSha(data: Uint8Array): Promise<string> {
	const prefix = encoder.encode(`blob ${data.length}\0`);
	const combined = new Uint8Array(prefix.length + data.length);
	combined.set(prefix);
	combined.set(data, prefix.length);
	const buffer = await crypto.subtle.digest("SHA-1", combined);
	const bytes = new Uint8Array(buffer);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
