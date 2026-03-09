const encoder = new TextEncoder();

export async function computeHash(content: string): Promise<string> {
	const data = encoder.encode(content);
	const buffer = await crypto.subtle.digest("SHA-256", data);
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
