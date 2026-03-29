import { bench, describe } from "vitest";
import { computeDiff } from "./diff";

function generateLines(count: number, prefix: string): string {
	return Array.from({ length: count }, (_, i) => `${prefix} line ${i}`).join("\n");
}

function generateMixedLines(count: number): { local: string; remote: string } {
	const localLines = Array.from({ length: count }, (_, i) =>
		i % 5 === 0 ? `local unique ${i}` : `shared line ${i}`,
	);
	const remoteLines = Array.from({ length: count }, (_, i) =>
		i % 5 === 0 ? `remote unique ${i}` : `shared line ${i}`,
	);
	return { local: localLines.join("\n"), remote: remoteLines.join("\n") };
}

describe("computeDiff benchmarks", () => {
	const sizes = [100, 500, 1000, 2001];

	for (const size of sizes) {
		bench(`identical ${size} lines`, () => {
			const text = generateLines(size, "same");
			computeDiff(text, text);
		});

		bench(`completely different ${size} lines`, () => {
			const local = generateLines(size, "local");
			const remote = generateLines(size, "remote");
			computeDiff(local, remote);
		});

		bench(`20% changed ${size} lines`, () => {
			const { local, remote } = generateMixedLines(size);
			computeDiff(local, remote);
		});
	}
});
