import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangeQueue } from "./change-queue";

describe("ChangeQueue", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("push and flush", () => {
		it("collects a single change", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("note.md", "create");

			expect(queue.size).toBe(1);
			const changes = queue.flush();
			expect(changes).toEqual([{ path: "note.md", type: "create" }]);
			expect(queue.size).toBe(0);
		});

		it("collects multiple different paths", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("a.md", "create");
			queue.push("b.md", "modify");
			queue.push("c.md", "delete");

			expect(queue.size).toBe(3);
			const changes = queue.flush();
			expect(changes).toHaveLength(3);
			expect(changes).toContainEqual({ path: "a.md", type: "create" });
			expect(changes).toContainEqual({ path: "b.md", type: "modify" });
			expect(changes).toContainEqual({ path: "c.md", type: "delete" });
		});

		it("flush clears the queue", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("note.md", "create");
			queue.flush();

			expect(queue.size).toBe(0);
			expect(queue.flush()).toEqual([]);
		});
	});

	describe("merge rules", () => {
		it("create + modify → create", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("note.md", "create");
			queue.push("note.md", "modify");

			const changes = queue.flush();
			expect(changes).toEqual([{ path: "note.md", type: "create" }]);
		});

		it("create + delete → noop (removed from queue)", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("note.md", "create");
			queue.push("note.md", "delete");

			expect(queue.size).toBe(0);
			expect(queue.flush()).toEqual([]);
		});

		it("modify + delete → delete", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("note.md", "modify");
			queue.push("note.md", "delete");

			const changes = queue.flush();
			expect(changes).toEqual([{ path: "note.md", type: "delete" }]);
		});

		it("delete + create → modify (recreated)", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("note.md", "delete");
			queue.push("note.md", "create");

			const changes = queue.flush();
			expect(changes).toEqual([{ path: "note.md", type: "modify" }]);
		});

		it("modify + modify → modify", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("note.md", "modify");
			queue.push("note.md", "modify");

			const changes = queue.flush();
			expect(changes).toEqual([{ path: "note.md", type: "modify" }]);
		});

		it("create + delete + create → modify", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("note.md", "create");
			queue.push("note.md", "delete");
			// Queue is now empty for note.md
			queue.push("note.md", "create");

			const changes = queue.flush();
			expect(changes).toEqual([{ path: "note.md", type: "create" }]);
		});
	});

	describe("excluded paths", () => {
		it("ignores .obsidian/ paths", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push(".obsidian/config.json", "modify");

			expect(queue.size).toBe(0);
		});

		it("ignores .trash/ paths", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push(".trash/deleted.md", "delete");

			expect(queue.size).toBe(0);
		});

		it("ignores ghvault.log", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("ghvault.log", "modify");

			expect(queue.size).toBe(0);
		});

		it("accepts normal vault files", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("notes/hello.md", "create");

			expect(queue.size).toBe(1);
		});
	});

	describe("debounce", () => {
		it("fires onReady after debounce period", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("note.md", "modify");
			expect(onReady).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1000);
			expect(onReady).toHaveBeenCalledTimes(1);
		});

		it("resets timer on subsequent pushes", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("a.md", "modify");
			vi.advanceTimersByTime(800);
			expect(onReady).not.toHaveBeenCalled();

			queue.push("b.md", "modify");
			vi.advanceTimersByTime(800);
			expect(onReady).not.toHaveBeenCalled();

			vi.advanceTimersByTime(200);
			expect(onReady).toHaveBeenCalledTimes(1);
		});

		it("does not fire onReady if queue becomes empty (create + delete)", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("note.md", "create");
			queue.push("note.md", "delete");

			vi.advanceTimersByTime(1000);
			expect(onReady).not.toHaveBeenCalled();
		});

		it("does not fire onReady for excluded paths only", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push(".obsidian/config.json", "modify");

			vi.advanceTimersByTime(1000);
			expect(onReady).not.toHaveBeenCalled();
		});
	});

	describe("pause and resume", () => {
		it("collects events while paused but does not fire timer", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.pause();
			queue.push("note.md", "modify");

			expect(queue.size).toBe(1);
			vi.advanceTimersByTime(1000);
			expect(onReady).not.toHaveBeenCalled();
		});

		it("fires onReady after resume if events were collected during pause", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.pause();
			queue.push("note.md", "modify");
			queue.push("other.md", "create");

			queue.resume();
			expect(onReady).not.toHaveBeenCalled();

			vi.advanceTimersByTime(1000);
			expect(onReady).toHaveBeenCalledTimes(1);
			expect(queue.size).toBe(2);
		});

		it("does not fire onReady after resume if no events during pause", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.pause();
			queue.resume();

			vi.advanceTimersByTime(1000);
			expect(onReady).not.toHaveBeenCalled();
		});

		it("accepts pushes after resume", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.pause();
			queue.push("during-pause.md", "modify");

			queue.resume();
			queue.push("after-resume.md", "create");

			expect(queue.size).toBe(2);
			vi.advanceTimersByTime(1000);
			expect(onReady).toHaveBeenCalledTimes(1);
		});

		it("pause clears pending timer", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("note.md", "modify");
			vi.advanceTimersByTime(500);

			queue.pause();
			vi.advanceTimersByTime(1000);

			expect(onReady).not.toHaveBeenCalled();
		});

		it("merge rules apply during pause", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.pause();
			queue.push("temp.md", "create");
			queue.push("temp.md", "delete");

			// create + delete = noop
			expect(queue.size).toBe(0);

			queue.resume();
			vi.advanceTimersByTime(1000);
			// Empty queue — no sync
			expect(onReady).not.toHaveBeenCalled();
		});
	});

	describe("destroy", () => {
		it("clears timer and pending changes", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("a.md", "create");
			queue.push("b.md", "modify");

			queue.destroy();

			expect(queue.size).toBe(0);
			vi.advanceTimersByTime(1000);
			expect(onReady).not.toHaveBeenCalled();
		});
	});

	describe("onPersist", () => {
		it("calls onPersist after push (via microtask)", async () => {
			const onReady = vi.fn();
			const onPersist = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady, onPersist });

			queue.push("note.md", "create");
			await Promise.resolve();

			expect(onPersist).toHaveBeenCalledTimes(1);
			expect(onPersist).toHaveBeenCalledWith({ "note.md": "create" });
		});

		it("batches sequential pushes into single persist call", async () => {
			const onReady = vi.fn();
			const onPersist = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady, onPersist });

			queue.push("note.md", "create");
			queue.push("note.md", "modify");

			// Both pushes happen synchronously — only one microtask persist
			await Promise.resolve();
			expect(onPersist).toHaveBeenCalledTimes(1);
			expect(onPersist).toHaveBeenCalledWith({ "note.md": "create" });
		});

		it("calls onPersist with empty object when entries cancel out", async () => {
			const onReady = vi.fn();
			const onPersist = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady, onPersist });

			queue.push("note.md", "create");
			queue.push("note.md", "delete");

			await Promise.resolve();
			expect(onPersist).toHaveBeenCalledTimes(1);
			expect(onPersist).toHaveBeenCalledWith({});
		});

		it("calls onPersist with empty object on flush (synchronously)", () => {
			const onReady = vi.fn();
			const onPersist = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady, onPersist });

			queue.push("a.md", "create");
			queue.push("b.md", "modify");
			onPersist.mockClear();

			queue.flush();

			// flush persists synchronously via persistNow
			expect(onPersist).toHaveBeenCalledTimes(1);
			expect(onPersist).toHaveBeenCalledWith({});
		});

		it("does NOT call onPersist on destroy", async () => {
			const onReady = vi.fn();
			const onPersist = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady, onPersist });

			queue.push("note.md", "create");
			await Promise.resolve();
			onPersist.mockClear();

			queue.destroy();
			await Promise.resolve();

			expect(onPersist).not.toHaveBeenCalled();
		});

		it("works without onPersist callback", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			expect(() => {
				queue.push("note.md", "create");
				queue.flush();
				queue.destroy();
			}).not.toThrow();
		});

		it("persists multiple paths correctly", async () => {
			const onReady = vi.fn();
			const onPersist = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady, onPersist });

			queue.push("a.md", "create");
			queue.push("b.md", "modify");
			queue.push("c.md", "delete");

			await Promise.resolve();
			expect(onPersist).toHaveBeenCalledTimes(1);
			expect(onPersist).toHaveBeenCalledWith({
				"a.md": "create",
				"b.md": "modify",
				"c.md": "delete",
			});
		});
	});

	describe("rename handling (delete old + create new)", () => {
		it("handles rename as delete old path + create new path", () => {
			const onReady = vi.fn();
			const queue = new ChangeQueue({ debounceMs: 1000, onReady });

			queue.push("old-name.md", "delete");
			queue.push("new-name.md", "create");

			const changes = queue.flush();
			expect(changes).toHaveLength(2);
			expect(changes).toContainEqual({ path: "old-name.md", type: "delete" });
			expect(changes).toContainEqual({ path: "new-name.md", type: "create" });
		});
	});

	describe("frontmatter sync exclusion", () => {
		it("skips files where isSyncExcluded returns true", () => {
			const onReady = vi.fn();
			const isSyncExcluded = vi.fn((path: string) => path === "draft.md");
			const queue = new ChangeQueue({ debounceMs: 1000, onReady, isSyncExcluded });

			queue.push("draft.md", "modify");
			queue.push("published.md", "modify");

			expect(queue.size).toBe(1);
			const changes = queue.flush();
			expect(changes).toEqual([{ path: "published.md", type: "modify" }]);
		});

		it("includes files where isSyncExcluded returns false", () => {
			const onReady = vi.fn();
			const isSyncExcluded = vi.fn().mockReturnValue(false);
			const queue = new ChangeQueue({ debounceMs: 1000, onReady, isSyncExcluded });

			queue.push("note.md", "create");

			expect(queue.size).toBe(1);
		});

		it("does not trigger debounce for excluded files only", () => {
			const onReady = vi.fn();
			const isSyncExcluded = vi.fn().mockReturnValue(true);
			const queue = new ChangeQueue({ debounceMs: 1000, onReady, isSyncExcluded });

			queue.push("draft.md", "modify");

			vi.advanceTimersByTime(1500);
			expect(onReady).not.toHaveBeenCalled();
		});
	});
});
