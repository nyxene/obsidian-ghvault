const encoder = new TextEncoder();

export async function computeHash(content: string): Promise<string> {
	const data = encoder.encode(content);
	const buffer = await crypto.subtle.digest("SHA-256", data);
	const bytes = new Uint8Array(buffer);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
