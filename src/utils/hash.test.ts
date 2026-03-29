import { describe, expect, it } from "vitest";
import { computeGitBlobSha, computeHash, computeHashFromBuffer } from "./hash";

describe("computeHash", () => {
	it("returns a 64-char hex string", async () => {
		const hash = await computeHash("hello");
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("produces known SHA-256 for 'hello'", async () => {
		const hash = await computeHash("hello");
		expect(hash).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
	});

	it("produces different hashes for different inputs", async () => {
		const a = await computeHash("foo");
		const b = await computeHash("bar");
		expect(a).not.toBe(b);
	});

	it("handles empty string", async () => {
		const hash = await computeHash("");
		expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	});

	it("handles unicode content", async () => {
		const hash = await computeHash("привет мир 🌍");
		expect(hash).toHaveLength(64);
	});
});

describe("computeGitBlobSha", () => {
	it("returns a 40-char hex SHA-1 string", async () => {
		const data = new TextEncoder().encode("hello");
		const sha = await computeGitBlobSha(data);
		expect(sha).toHaveLength(40);
		expect(sha).toMatch(/^[0-9a-f]{40}$/);
	});

	it("produces known git blob SHA for 'hello'", async () => {
		// Equivalent to: echo -n 'hello' | git hash-object --stdin
		// git computes SHA-1 of "blob 5\0hello"
		const data = new TextEncoder().encode("hello");
		const sha = await computeGitBlobSha(data);
		expect(sha).toBe("b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
	});

	it("produces known git blob SHA for empty content", async () => {
		// Equivalent to: echo -n '' | git hash-object --stdin
		// git computes SHA-1 of "blob 0\0"
		const data = new Uint8Array(0);
		const sha = await computeGitBlobSha(data);
		expect(sha).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
	});

	it("produces different SHAs for different content", async () => {
		const a = await computeGitBlobSha(new TextEncoder().encode("foo"));
		const b = await computeGitBlobSha(new TextEncoder().encode("bar"));
		expect(a).not.toBe(b);
	});

	it("uses git blob format (blob {size}\\0{content})", async () => {
		// Verify the function uses correct prefix format by checking
		// that changing content length changes the SHA even if raw bytes overlap
		const short = new TextEncoder().encode("ab");
		const long = new TextEncoder().encode("abc");
		const shaShort = await computeGitBlobSha(short);
		const shaLong = await computeGitBlobSha(long);
		expect(shaShort).not.toBe(shaLong);
	});
});

describe("computeHashFromBuffer", () => {
	it("produces same hash as computeHash for same content (Uint8Array input)", async () => {
		const text = "hello";
		const hashFromString = await computeHash(text);
		const hashFromBuffer = await computeHashFromBuffer(new TextEncoder().encode(text));
		expect(hashFromBuffer).toBe(hashFromString);
	});

	it("produces same hash as computeHash for same content (ArrayBuffer input)", async () => {
		const text = "hello";
		const hashFromString = await computeHash(text);
		const buffer = new TextEncoder().encode(text).buffer as ArrayBuffer;
		const hashFromBuffer = await computeHashFromBuffer(buffer);
		expect(hashFromBuffer).toBe(hashFromString);
	});

	it("handles empty Uint8Array", async () => {
		const hashFromString = await computeHash("");
		const hashFromBuffer = await computeHashFromBuffer(new Uint8Array(0));
		expect(hashFromBuffer).toBe(hashFromString);
	});

	it("handles binary data with null bytes", async () => {
		const bytes = new Uint8Array([0x00, 0x89, 0x50, 0x00, 0xff]);
		const hash = await computeHashFromBuffer(bytes);
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("returns 64-char hex string", async () => {
		const hash = await computeHashFromBuffer(new TextEncoder().encode("test"));
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("handles Uint8Array subarray with non-zero byteOffset", async () => {
		const full = new TextEncoder().encode("prefixhello");
		const sub = full.subarray(6); // "hello" with byteOffset=6
		const expected = await computeHash("hello");
		const result = await computeHashFromBuffer(sub);
		expect(result).toBe(expected);
	});
});
