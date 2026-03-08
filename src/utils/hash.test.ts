import { describe, expect, it } from "vitest";
import { computeHash } from "./hash";

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
