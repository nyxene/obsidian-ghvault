import { describe, expect, it } from "vitest";
import {
	arrayBufferToBase64,
	base64ToArrayBuffer,
	base64ToBytes,
	bytesToBase64,
	fromBase64,
	toBase64,
} from "./base64";

describe("toBase64 / fromBase64", () => {
	it("round-trips ASCII text", () => {
		const text = "hello world";
		expect(fromBase64(toBase64(text))).toBe(text);
	});

	it("round-trips unicode text", () => {
		const text = "привет мир 🌍";
		expect(fromBase64(toBase64(text))).toBe(text);
	});

	it("produces correct base64 for known input", () => {
		expect(toBase64("hello")).toBe("aGVsbG8=");
	});

	it("decodes known base64", () => {
		expect(fromBase64("aGVsbG8=")).toBe("hello");
	});

	it("handles empty string", () => {
		expect(toBase64("")).toBe("");
		expect(fromBase64("")).toBe("");
	});
});

describe("bytesToBase64 / base64ToBytes", () => {
	it("round-trips binary data", () => {
		const original = new Uint8Array([0, 1, 127, 128, 255]);
		const encoded = bytesToBase64(original);
		const decoded = base64ToBytes(encoded);
		expect(Array.from(decoded)).toEqual(Array.from(original));
	});

	it("handles empty array", () => {
		const empty = new Uint8Array(0);
		expect(bytesToBase64(empty)).toBe("");
		expect(Array.from(base64ToBytes(""))).toEqual([]);
	});
});

describe("arrayBufferToBase64 / base64ToArrayBuffer", () => {
	it("round-trips ArrayBuffer with text content", () => {
		const original = new TextEncoder().encode("hello world").buffer as ArrayBuffer;
		const encoded = arrayBufferToBase64(original);
		const decoded = base64ToArrayBuffer(encoded);
		expect(new Uint8Array(decoded)).toEqual(new Uint8Array(original));
	});

	it("round-trips ArrayBuffer with binary content (null bytes)", () => {
		const original = new Uint8Array([0x89, 0x50, 0x00, 0x47, 0x00, 0xff]).buffer as ArrayBuffer;
		const encoded = arrayBufferToBase64(original);
		const decoded = base64ToArrayBuffer(encoded);
		expect(new Uint8Array(decoded)).toEqual(new Uint8Array(original));
	});

	it("handles empty ArrayBuffer", () => {
		const empty = new ArrayBuffer(0);
		const encoded = arrayBufferToBase64(empty);
		expect(encoded).toBe("");
		const decoded = base64ToArrayBuffer(encoded);
		expect(decoded.byteLength).toBe(0);
	});

	it("produces known base64 for known input", () => {
		const buffer = new TextEncoder().encode("hello").buffer as ArrayBuffer;
		expect(arrayBufferToBase64(buffer)).toBe("aGVsbG8=");
	});

	it("decodes known base64 to correct bytes", () => {
		const buffer = base64ToArrayBuffer("aGVsbG8=");
		const text = new TextDecoder().decode(buffer);
		expect(text).toBe("hello");
	});
});
