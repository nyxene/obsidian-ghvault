import type { ChangeType, FileChange } from "../types";
import { isExcluded } from "../utils/path";

export interface ChangeQueueOptions {
	debounceMs: number;
	onReady: () => void;
}

export class ChangeQueue {
	private pending = new Map<string, ChangeType>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private readonly debounceMs: number;
	private readonly onReady: () => void;
	private paused = false;

	constructor(options: ChangeQueueOptions) {
		this.debounceMs = options.debounceMs;
		this.onReady = options.onReady;
	}

	push(path: string, type: ChangeType): void {
		if (isExcluded(path)) return;

		const existing = this.pending.get(path);
		if (existing) {
			const merged = mergeChangeTypes(existing, type);
			if (merged === null) {
				this.pending.delete(path);
			} else {
				this.pending.set(path, merged);
			}
		} else {
			this.pending.set(path, type);
		}

		if (!this.paused) {
			this.resetTimer();
		}
	}

	flush(): FileChange[] {
		const changes: FileChange[] = [];
		for (const [path, type] of this.pending) {
			changes.push({ path, type });
		}
		this.pending.clear();
		return changes;
	}

	/** Pause debounce timer. Events are still collected — no data loss. */
	pause(): void {
		this.paused = true;
		this.clearTimer();
	}

	/** Resume and start debounce if events accumulated during pause. */
	resume(): void {
		this.paused = false;
		if (this.pending.size > 0) {
			this.resetTimer();
		}
	}

	destroy(): void {
		this.clearTimer();
		this.pending.clear();
	}

	get size(): number {
		return this.pending.size;
	}

	private resetTimer(): void {
		this.clearTimer();
		this.timer = setTimeout(() => {
			this.timer = null;
			if (this.pending.size > 0) {
				this.onReady();
			}
		}, this.debounceMs);
	}

	private clearTimer(): void {
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}

/** Merge two change types for the same path. Returns null if they cancel out. */
function mergeChangeTypes(existing: ChangeType, incoming: ChangeType): ChangeType | null {
	if (existing === "create" && incoming === "modify") return "create";
	if (existing === "create" && incoming === "delete") return null;
	if (existing === "modify" && incoming === "delete") return "delete";
	if (existing === "delete" && incoming === "create") return "modify";
	return incoming;
}
