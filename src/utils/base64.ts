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
	return btoa(uint8ArrayToBinaryString(bytes));
}

/** Convert Uint8Array to binary string using chunked String.fromCharCode — O(n) */
function uint8ArrayToBinaryString(bytes: Uint8Array): string {
	const chunkSize = 8192;
	const chunks: string[] = [];
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const end = Math.min(i + chunkSize, bytes.length);
		const slice = bytes.subarray(i, end);
		chunks.push(String.fromCharCode(...slice));
	}
	return chunks.join("");
}

export function base64ToBytes(encoded: string): Uint8Array {
	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	return bytesToBase64(new Uint8Array(buffer));
}

export function base64ToArrayBuffer(encoded: string): ArrayBuffer {
	return base64ToBytes(encoded).buffer as ArrayBuffer;
}
