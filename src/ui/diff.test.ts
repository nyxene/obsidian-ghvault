import { describe, expect, it } from "vitest";
import { computeDiff, groupIntoHunks, mergeHunks } from "./diff";

describe("computeDiff", () => {
	it("returns empty array for two empty strings", () => {
		const result = computeDiff("", "");
		expect(result).toEqual([{ type: "same", text: "", localLine: 1, remoteLine: 1 }]);
	});

	it("returns all same for identical content", () => {
		const text = "line 1\nline 2\nline 3";
		const result = computeDiff(text, text);
		expect(result).toEqual([
			{ type: "same", text: "line 1", localLine: 1, remoteLine: 1 },
			{ type: "same", text: "line 2", localLine: 2, remoteLine: 2 },
			{ type: "same", text: "line 3", localLine: 3, remoteLine: 3 },
		]);
	});

	it("detects added lines (remote has more)", () => {
		const local = "line 1\nline 3";
		const remote = "line 1\nline 2\nline 3";
		const result = computeDiff(local, remote);
		expect(result).toEqual([
			{ type: "same", text: "line 1", localLine: 1, remoteLine: 1 },
			{ type: "add", text: "line 2", remoteLine: 2 },
			{ type: "same", text: "line 3", localLine: 2, remoteLine: 3 },
		]);
	});

	it("detects removed lines (local has more)", () => {
		const local = "line 1\nline 2\nline 3";
		const remote = "line 1\nline 3";
		const result = computeDiff(local, remote);
		expect(result).toEqual([
			{ type: "same", text: "line 1", localLine: 1, remoteLine: 1 },
			{ type: "remove", text: "line 2", localLine: 2 },
			{ type: "same", text: "line 3", localLine: 3, remoteLine: 2 },
		]);
	});

	it("detects modified lines as remove + add", () => {
		const local = "line 1\nold content\nline 3";
		const remote = "line 1\nnew content\nline 3";
		const result = computeDiff(local, remote);
		expect(result).toEqual([
			{ type: "same", text: "line 1", localLine: 1, remoteLine: 1 },
			{ type: "remove", text: "old content", localLine: 2 },
			{ type: "add", text: "new content", remoteLine: 2 },
			{ type: "same", text: "line 3", localLine: 3, remoteLine: 3 },
		]);
	});

	it("handles completely different content", () => {
		const local = "aaa\nbbb";
		const remote = "ccc\nddd";
		const result = computeDiff(local, remote);
		expect(result).toHaveLength(4);
		expect(result.filter((l) => l.type === "remove")).toHaveLength(2);
		expect(result.filter((l) => l.type === "add")).toHaveLength(2);
	});

	it("handles single line change", () => {
		const result = computeDiff("old", "new");
		expect(result).toEqual([
			{ type: "remove", text: "old", localLine: 1 },
			{ type: "add", text: "new", remoteLine: 1 },
		]);
	});

	it("handles mixed insertions and deletions", () => {
		const local = "a\nb\nc\nd\ne";
		const remote = "a\nx\nc\ny\ne";
		const result = computeDiff(local, remote);
		expect(result).toEqual([
			{ type: "same", text: "a", localLine: 1, remoteLine: 1 },
			{ type: "remove", text: "b", localLine: 2 },
			{ type: "add", text: "x", remoteLine: 2 },
			{ type: "same", text: "c", localLine: 3, remoteLine: 3 },
			{ type: "remove", text: "d", localLine: 4 },
			{ type: "add", text: "y", remoteLine: 4 },
			{ type: "same", text: "e", localLine: 5, remoteLine: 5 },
		]);
	});

	it("includes line numbers on all line types", () => {
		const local = "same\nremoved";
		const remote = "same\nadded";
		const result = computeDiff(local, remote);
		const removeLine = result.find((l) => l.type === "remove");
		const addLine = result.find((l) => l.type === "add");
		expect(removeLine?.localLine).toBe(2);
		expect(removeLine?.remoteLine).toBeUndefined();
		expect(addLine?.remoteLine).toBe(2);
		expect(addLine?.localLine).toBeUndefined();
	});
});

describe("groupIntoHunks", () => {
	it("returns empty array when no changes", () => {
		const diff = computeDiff("a\nb\nc", "a\nb\nc");
		const hunks = groupIntoHunks(diff);
		expect(hunks).toHaveLength(0);
	});

	it("groups single change with context", () => {
		// 10 lines, change on line 5
		const local = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
		const remoteLines = local.split("\n");
		remoteLines[4] = "changed line 5";
		const remote = remoteLines.join("\n");

		const diff = computeDiff(local, remote);
		const hunks = groupIntoHunks(diff, 3);

		expect(hunks).toHaveLength(1);
		// Context: 3 before (lines 2-4) + change (line 5) + 3 after (lines 6-8)
		// But line 5 produces remove+add = 2 diff lines
		expect(hunks[0].lines.length).toBeGreaterThanOrEqual(7);
		expect(hunks[0].lines.some((l) => l.type === "remove")).toBe(true);
		expect(hunks[0].lines.some((l) => l.type === "add")).toBe(true);
	});

	it("merges adjacent hunks when context overlaps", () => {
		// Changes on lines 3 and 7 (close enough for context=3 to overlap)
		const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
		const local = lines.join("\n");
		const remoteLines = [...lines];
		remoteLines[2] = "changed 3";
		remoteLines[6] = "changed 7";
		const remote = remoteLines.join("\n");

		const diff = computeDiff(local, remote);
		const hunks = groupIntoHunks(diff, 3);

		// With context=3, hunk1 covers [0,5] and hunk2 covers [3,9] → merged
		expect(hunks).toHaveLength(1);
	});

	it("keeps separate hunks when far apart", () => {
		// Changes on lines 3 and 15 (far apart, context=2)
		const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
		const local = lines.join("\n");
		const remoteLines = [...lines];
		remoteLines[2] = "changed 3";
		remoteLines[14] = "changed 15";
		const remote = remoteLines.join("\n");

		const diff = computeDiff(local, remote);
		const hunks = groupIntoHunks(diff, 2);

		expect(hunks).toHaveLength(2);
	});

	it("includes correct line numbers in hunk", () => {
		const local = "a\nb\nc\nd\ne";
		const remote = "a\nb\nX\nd\ne";
		const diff = computeDiff(local, remote);
		const hunks = groupIntoHunks(diff, 1);

		expect(hunks).toHaveLength(1);
		expect(hunks[0].localStart).toBe(2); // context line before change
		expect(hunks[0].remoteStart).toBe(2);
	});
});

describe("mergeHunks", () => {
	it("keeps local version for hunk when decision is local", () => {
		const local = "a\nold\nc";
		const remote = "a\nnew\nc";
		const diff = computeDiff(local, remote);
		const hunks = groupIntoHunks(diff, 1);

		const decisions = new Map<number, "local" | "remote">([[0, "local"]]);
		const result = mergeHunks(local, hunks, decisions);

		expect(result).toBe("a\nold\nc");
	});

	it("keeps remote version for hunk when decision is remote", () => {
		const local = "a\nold\nc";
		const remote = "a\nnew\nc";
		const diff = computeDiff(local, remote);
		const hunks = groupIntoHunks(diff, 1);

		const decisions = new Map<number, "local" | "remote">([[0, "remote"]]);
		const result = mergeHunks(local, hunks, decisions);

		expect(result).toBe("a\nnew\nc");
	});

	it("merges multiple hunks with different decisions", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
		const local = lines.join("\n");
		const remoteLines = [...lines];
		remoteLines[2] = "remote 3";
		remoteLines[14] = "remote 15";
		const remote = remoteLines.join("\n");

		const diff = computeDiff(local, remote);
		const hunks = groupIntoHunks(diff, 2);
		expect(hunks).toHaveLength(2);

		// Hunk 0: keep remote (line 3 → "remote 3")
		// Hunk 1: keep local (line 15 stays "line 15")
		const decisions = new Map<number, "local" | "remote">([
			[0, "remote"],
			[1, "local"],
		]);
		const result = mergeHunks(local, hunks, decisions);
		const resultLines = result.split("\n");

		expect(resultLines[2]).toBe("remote 3");
		expect(resultLines[14]).toBe("line 15");
	});

	it("defaults to local when no decision provided", () => {
		const local = "a\nold\nc";
		const remote = "a\nnew\nc";
		const diff = computeDiff(local, remote);
		const hunks = groupIntoHunks(diff, 1);

		const decisions = new Map<number, "local" | "remote">();
		const result = mergeHunks(local, hunks, decisions);

		expect(result).toBe("a\nold\nc");
	});
});
