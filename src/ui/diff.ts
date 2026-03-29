export interface DiffLine {
	type: "same" | "add" | "remove";
	text: string;
	localLine?: number;
	remoteLine?: number;
}

export interface DiffHunk {
	lines: DiffLine[];
	localStart: number;
	localEnd: number;
	remoteStart: number;
	remoteEnd: number;
}

const DEFAULT_CONTEXT_LINES = 3;
const DIFF_MAX_CELLS = 4_000_000;

/**
 * Compute a unified line-based diff between two texts using LCS.
 * "remove" lines come from localText, "add" lines come from remoteText.
 * Each line includes its original line number in the local/remote file.
 * O(n*m) where n and m are line counts — instant for typical markdown (<1000 lines).
 */
export function computeDiff(localText: string, remoteText: string): DiffLine[] {
	const localLines = localText.split("\n");
	const remoteLines = remoteText.split("\n");
	const n = localLines.length;
	const m = remoteLines.length;

	// Fallback for large inputs to avoid O(n*m) memory/time blow-up
	if (n * m > DIFF_MAX_CELLS) {
		const result: DiffLine[] = [];
		for (let i = 0; i < n; i++) {
			result.push({ type: "remove", text: localLines[i], localLine: i + 1 });
		}
		for (let j = 0; j < m; j++) {
			result.push({ type: "add", text: remoteLines[j], remoteLine: j + 1 });
		}
		return result;
	}

	// Build LCS table
	const dp: number[][] = [];
	for (let i = 0; i <= n; i++) {
		dp[i] = new Array(m + 1).fill(0);
	}
	for (let i = 1; i <= n; i++) {
		for (let j = 1; j <= m; j++) {
			if (localLines[i - 1] === remoteLines[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1] + 1;
			} else {
				dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}
	}

	// Backtrack to produce diff with line numbers
	const result: DiffLine[] = [];
	let i = n;
	let j = m;

	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && localLines[i - 1] === remoteLines[j - 1]) {
			result.push({ type: "same", text: localLines[i - 1], localLine: i, remoteLine: j });
			i--;
			j--;
		} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
			result.push({ type: "add", text: remoteLines[j - 1], remoteLine: j });
			j--;
		} else {
			result.push({ type: "remove", text: localLines[i - 1], localLine: i });
			i--;
		}
	}

	result.reverse();
	return result;
}

/**
 * Group diff lines into hunks with context lines.
 * Each hunk contains changed lines plus `contextLines` unchanged lines
 * before and after. Adjacent hunks are merged if their context overlaps.
 */
export function groupIntoHunks(
	diff: DiffLine[],
	contextLines: number = DEFAULT_CONTEXT_LINES,
): DiffHunk[] {
	if (diff.length === 0) return [];

	// Find indices of changed lines
	const changedIndices: number[] = [];
	for (let i = 0; i < diff.length; i++) {
		if (diff[i].type !== "same") {
			changedIndices.push(i);
		}
	}

	// No changes → no hunks
	if (changedIndices.length === 0) return [];

	// Build ranges: each changed line expands to [change - context, change + context]
	const ranges: Array<{ start: number; end: number }> = [];
	for (const idx of changedIndices) {
		const start = Math.max(0, idx - contextLines);
		const end = Math.min(diff.length - 1, idx + contextLines);
		if (ranges.length > 0 && start <= ranges[ranges.length - 1].end + 1) {
			// Merge with previous range
			ranges[ranges.length - 1].end = end;
		} else {
			ranges.push({ start, end });
		}
	}

	// Build hunks from merged ranges
	return ranges.map((range) => {
		const lines = diff.slice(range.start, range.end + 1);
		const firstLine = lines[0];
		const lastLine = lines[lines.length - 1];

		return {
			lines,
			localStart: firstLine.localLine ?? firstLine.remoteLine ?? 1,
			localEnd: lastLine.localLine ?? lastLine.remoteLine ?? 1,
			remoteStart: firstLine.remoteLine ?? firstLine.localLine ?? 1,
			remoteEnd: lastLine.remoteLine ?? lastLine.localLine ?? 1,
		};
	});
}

/**
 * Merge hunks by applying per-hunk decisions.
 * For each hunk, the decision determines which version of changed lines to keep.
 * Unchanged lines between hunks are always preserved from the local version.
 * Returns the merged file content as a string.
 */
export function mergeHunks(
	localText: string,
	hunks: DiffHunk[],
	decisions: Map<number, "local" | "remote">,
): string {
	const localLines = localText.split("\n");
	const resultLines: string[] = [];

	// Track which local lines are covered by hunks
	let localIdx = 0;

	for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
		const hunk = hunks[hunkIdx];
		const decision = decisions.get(hunkIdx) ?? "local";

		// Add unchanged lines before this hunk
		const hunkLocalStart = (hunk.localStart ?? 1) - 1; // 0-based
		while (localIdx < hunkLocalStart && localIdx < localLines.length) {
			resultLines.push(localLines[localIdx]);
			localIdx++;
		}

		// Process hunk lines based on decision
		for (const line of hunk.lines) {
			if (line.type === "same") {
				resultLines.push(line.text);
				if (line.localLine !== undefined) {
					localIdx = line.localLine; // advance past this line (0-based next)
				}
			} else if (decision === "local" && line.type === "remove") {
				resultLines.push(line.text);
				if (line.localLine !== undefined) {
					localIdx = line.localLine;
				}
			} else if (decision === "remote" && line.type === "add") {
				resultLines.push(line.text);
			} else if (decision === "local" && line.type === "add") {
				// Skip remote additions when keeping local
			} else if (decision === "remote" && line.type === "remove") {
				// Skip local removals when keeping remote
				if (line.localLine !== undefined) {
					localIdx = line.localLine;
				}
			}
		}
	}

	// Add remaining lines after last hunk
	while (localIdx < localLines.length) {
		resultLines.push(localLines[localIdx]);
		localIdx++;
	}

	return resultLines.join("\n");
}
