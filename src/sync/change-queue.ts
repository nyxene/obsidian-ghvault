import type { ChangeType, FileChange } from "../types";
import { isExcluded } from "../utils/path";

export interface ChangeQueueOptions {
	debounceMs: number;
	onReady: () => void;
	onPersist?: (pending: Record<string, ChangeType>) => void;
	excludePatterns?: readonly string[];
}

export class ChangeQueue {
	private pending = new Map<string, ChangeType>();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private readonly debounceMs: number;
	private readonly onReady: () => void;
	private readonly onPersist?: (pending: Record<string, ChangeType>) => void;
	private readonly excludePatterns?: readonly string[];
	private persistScheduled = false;
	private paused = false;

	constructor(options: ChangeQueueOptions) {
		this.debounceMs = options.debounceMs;
		this.onReady = options.onReady;
		this.onPersist = options.onPersist;
		this.excludePatterns = options.excludePatterns;
	}

	push(path: string, type: ChangeType): void {
		if (isExcluded(path, this.excludePatterns)) return;

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

		this.persist();

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
		this.persistNow();
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

	private persist(): void {
		if (!this.onPersist) return;
		if (this.persistScheduled) return;
		this.persistScheduled = true;
		queueMicrotask(() => {
			this.persistScheduled = false;
			this.persistNow();
		});
	}

	private persistNow(): void {
		if (!this.onPersist) return;
		this.persistScheduled = false;
		const snapshot: Record<string, ChangeType> = {};
		for (const [path, type] of this.pending) {
			snapshot[path] = type;
		}
		this.onPersist(snapshot);
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
