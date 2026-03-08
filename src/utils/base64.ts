const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(content: string): string {
	const bytes = encoder.encode(content);
	return bytesToBase64(bytes);
}

export function fromBase64(encoded: string): string {
	const bytes = base64ToBytes(encoded);
	return decoder.decode(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export function base64ToBytes(encoded: string): Uint8Array {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
