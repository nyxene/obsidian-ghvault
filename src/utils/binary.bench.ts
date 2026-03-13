import { bench, describe } from "vitest";
import { hasBinaryContent, toSafeArrayBuffer } from "./binary";

// Text-only content (no null bytes)
const textSmall = new TextEncoder().encode("Hello, world!");
const textMedium = new TextEncoder().encode("x".repeat(10_000));
const textLarge = new TextEncoder().encode("x".repeat(100_000));

// Binary content (null byte at various positions)
const binaryEarly = new Uint8Array(10_000);
binaryEarly.fill(0x78); // 'x'
binaryEarly[5] = 0x00; // null byte near start

const binaryLate = new Uint8Array(10_000);
binaryLate.fill(0x78);
binaryLate[8000] = 0x00; // null byte near 8KB boundary

const binaryNone = new Uint8Array(10_000);
binaryNone.fill(0x78); // no null bytes — full 8KB scan

describe("hasBinaryContent", () => {
	bench("small text (13 bytes) — no null", () => {
		hasBinaryContent(textSmall);
	});

	bench("medium text (10KB) — no null, full scan", () => {
		hasBinaryContent(binaryNone);
	});

	bench("large text (100KB) — no null, capped at 8KB", () => {
		hasBinaryContent(textLarge);
	});

	bench("binary early null (position 5)", () => {
		hasBinaryContent(binaryEarly);
	});

	bench("binary late null (position 8000)", () => {
		hasBinaryContent(binaryLate);
	});
});

describe("toSafeArrayBuffer", () => {
	bench("small (13 bytes)", () => {
		toSafeArrayBuffer(textSmall);
	});

	bench("medium (10KB)", () => {
		toSafeArrayBuffer(textMedium);
	});

	bench("large (100KB)", () => {
		toSafeArrayBuffer(textLarge);
	});

	bench("view with offset", () => {
		const large = new Uint8Array(20_000);
		const view = large.subarray(5000, 15000);
		toSafeArrayBuffer(view);
	});
});
