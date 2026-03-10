import { bench, describe } from "vitest";
import { base64ToBytes, bytesToBase64, fromBase64, toBase64 } from "./base64";

const smallText = "Hello, world!";
const mediumText = "x".repeat(10_000);
const largeText = "x".repeat(1_000_000);

const smallB64 = toBase64(smallText);
const mediumB64 = toBase64(mediumText);
const largeB64 = toBase64(largeText);

const smallBytes = new Uint8Array(100);
const mediumBytes = new Uint8Array(10_000);
const largeBytes = new Uint8Array(1_000_000);

describe("toBase64", () => {
	bench("small string (13 bytes)", () => {
		toBase64(smallText);
	});

	bench("medium string (10KB)", () => {
		toBase64(mediumText);
	});

	bench("large string (1MB)", () => {
		toBase64(largeText);
	});
});

describe("fromBase64", () => {
	bench("small string", () => {
		fromBase64(smallB64);
	});

	bench("medium string (10KB)", () => {
		fromBase64(mediumB64);
	});

	bench("large string (1MB)", () => {
		fromBase64(largeB64);
	});
});

describe("bytesToBase64", () => {
	bench("100 bytes", () => {
		bytesToBase64(smallBytes);
	});

	bench("10KB", () => {
		bytesToBase64(mediumBytes);
	});

	bench("1MB", () => {
		bytesToBase64(largeBytes);
	});
});

describe("base64ToBytes", () => {
	bench("100 bytes", () => {
		base64ToBytes(bytesToBase64(smallBytes));
	});

	bench("10KB", () => {
		base64ToBytes(bytesToBase64(mediumBytes));
	});
});
