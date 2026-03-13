import { describe, expect, it } from "vitest";
import { hasBinaryContent, toSafeArrayBuffer } from "./binary";

describe("hasBinaryContent", () => {
	it("detects null byte at position 0", () => {
		const bytes = new Uint8Array([0x00, 0x41, 0x42]);
		expect(hasBinaryContent(bytes)).toBe(true);
	});

	it("detects null byte at mid-range position", () => {
		const bytes = new Uint8Array(4096);
		bytes.fill(0x41);
		bytes[2048] = 0x00;
		expect(hasBinaryContent(bytes)).toBe(true);
	});

	it("detects null byte at position 8191 (last checked byte)", () => {
		const bytes = new Uint8Array(8192);
		bytes.fill(0x41);
		bytes[8191] = 0x00;
		expect(hasBinaryContent(bytes)).toBe(true);
	});

	it("does NOT detect null byte at position 8192 (beyond scan limit)", () => {
		const bytes = new Uint8Array(9000);
		bytes.fill(0x41);
		bytes[8192] = 0x00;
		expect(hasBinaryContent(bytes)).toBe(false);
	});

	it("returns false for empty Uint8Array", () => {
		expect(hasBinaryContent(new Uint8Array(0))).toBe(false);
	});

	it("returns false for all non-zero bytes", () => {
		const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
		expect(hasBinaryContent(bytes)).toBe(false);
	});

	it("returns true for single null byte", () => {
		expect(hasBinaryContent(new Uint8Array([0x00]))).toBe(true);
	});

	it("returns false for single non-zero byte", () => {
		expect(hasBinaryContent(new Uint8Array([0x41]))).toBe(false);
	});

	it("detects null byte in PNG header", () => {
		const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
		expect(hasBinaryContent(png)).toBe(true);
	});

	it("handles buffer shorter than scan limit", () => {
		const bytes = new Uint8Array(100);
		bytes.fill(0x41);
		expect(hasBinaryContent(bytes)).toBe(false);
	});
});

describe("toSafeArrayBuffer", () => {
	it("returns matching ArrayBuffer for standard Uint8Array", () => {
		const bytes = new Uint8Array([1, 2, 3, 4, 5]);
		const buffer = toSafeArrayBuffer(bytes);
		expect(new Uint8Array(buffer)).toEqual(bytes);
	});

	it("returns correct slice for Uint8Array with non-zero byteOffset", () => {
		const parent = new Uint8Array([10, 20, 30, 40, 50]);
		const view = parent.subarray(2, 4); // [30, 40], byteOffset=2
		expect(view.byteOffset).toBe(2);

		const buffer = toSafeArrayBuffer(view);
		const result = new Uint8Array(buffer);

		expect(result).toEqual(new Uint8Array([30, 40]));
		expect(buffer.byteLength).toBe(2);
	});

	it("returns empty ArrayBuffer for empty Uint8Array", () => {
		const buffer = toSafeArrayBuffer(new Uint8Array(0));
		expect(buffer.byteLength).toBe(0);
	});

	it("returns independent copy (not a view into original buffer)", () => {
		const original = new Uint8Array([1, 2, 3]);
		const buffer = toSafeArrayBuffer(original);
		const copy = new Uint8Array(buffer);

		original[0] = 99;
		expect(copy[0]).toBe(1); // copy is independent
	});
});
