const BINARY_CHECK_BYTES = 8192;

/**
 * Detect binary content by scanning for null bytes in the first 8KB.
 * Returns true if any null byte (0x00) is found.
 */
export function hasBinaryContent(bytes: Uint8Array): boolean {
	const limit = Math.min(bytes.length, BINARY_CHECK_BYTES);
	for (let i = 0; i < limit; i++) {
		if (bytes[i] === 0) return true;
	}
	return false;
}

/**
 * Extract a safe ArrayBuffer from a Uint8Array, handling potential
 * non-zero byteOffset when the Uint8Array is a view into a larger buffer.
 */
export function toSafeArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
