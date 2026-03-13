import { describe, expect, it, vi } from "vitest";
import type { SHACacheEntry } from "../types";
import type { StorageAdapter } from "./state";
import { SyncStateManager } from "./state";

function createMockStorage(
	initial: Record<string, unknown> | null = null,
): StorageAdapter & { data: Record<string, unknown> | null } {
	const store = { data: initial };
	return {
		get data() {
			return store.data;
		},
		loadData: vi.fn(async () => store.data),
		saveData: vi.fn(async (data: Record<string, unknown>) => {
			store.data = data;
		}),
	};
}

const sampleEntry: SHACacheEntry = {
	remoteSha: "abc123",
	localContentHash: "def456",
	lastSyncedAt: 1000,
	size: 42,
	isBinary: false,
};

describe("SyncStateManager", () => {
	describe("load", () => {
		it("initializes empty state when no data exists", async () => {
			const storage = createMockStorage(null);
			const manager = new SyncStateManager(storage);

			await manager.load();

			expect(manager.getHeadOid()).toBe("");
			expect(manager.getLastSyncedAt()).toBe(0);
			expect(manager.getAllSHAs()).toEqual({});
		});

		it("restores state from existing data", async () => {
			const validSha = "a".repeat(40);
			const storage = createMockStorage({
				syncState: {
					lastRemoteHeadSha: validSha,
					lastSyncedAt: 5000,
					cache: { "file.md": sampleEntry },
				},
			});
			const manager = new SyncStateManager(storage);

			await manager.load();

			expect(manager.getHeadOid()).toBe(validSha);
			expect(manager.getLastSyncedAt()).toBe(5000);
			expect(manager.getSHA("file.md")).toEqual(sampleEntry);
		});

		it("preserves valid entries and discards invalid ones in partially corrupted cache", async () => {
			const validEntry = {
				remoteSha: "abc123",
				localContentHash: "def456",
				lastSyncedAt: 1000,
				size: 42,
				isBinary: false,
			};
			const storage = createMockStorage({
				syncState: {
					lastRemoteHeadSha: "a".repeat(40),
					lastSyncedAt: 5000,
					cache: {
						"valid.md": validEntry,
						"missing-sha.md": { localContentHash: "h", lastSyncedAt: 1, size: 1, isBinary: false },
						"missing-hash.md": { remoteSha: "s", lastSyncedAt: 1, size: 1, isBinary: false },
						"missing-time.md": { remoteSha: "s", localContentHash: "h", size: 1, isBinary: false },
						"missing-size.md": {
							remoteSha: "s",
							localContentHash: "h",
							lastSyncedAt: 1,
							isBinary: false,
						},
						"missing-binary.md": {
							remoteSha: "s",
							localContentHash: "h",
							lastSyncedAt: 1,
							size: 1,
						},
						"null-entry.md": null,
						"string-entry.md": "not an object",
						"number-entry.md": 42,
					},
				},
			});
			const manager = new SyncStateManager(storage);

			await manager.load();

			expect(manager.getSHA("valid.md")).toEqual(validEntry);
			expect(manager.getSHA("missing-sha.md")).toBeUndefined();
			expect(manager.getSHA("missing-hash.md")).toBeUndefined();
			expect(manager.getSHA("missing-time.md")).toBeUndefined();
			expect(manager.getSHA("missing-size.md")).toBeUndefined();
			expect(manager.getSHA("missing-binary.md")).toBeUndefined();
			expect(manager.getSHA("null-entry.md")).toBeUndefined();
			expect(manager.getSHA("string-entry.md")).toBeUndefined();
			expect(manager.getSHA("number-entry.md")).toBeUndefined();
			// Valid metadata preserved
			expect(manager.getHeadOid()).toBe("a".repeat(40));
			expect(manager.getLastSyncedAt()).toBe(5000);
		});

		it("handles corrupted data gracefully", async () => {
			const storage = createMockStorage({ syncState: "not-an-object" });
			const manager = new SyncStateManager(storage);

			await manager.load();

			expect(manager.getHeadOid()).toBe("");
			expect(manager.getAllSHAs()).toEqual({});
		});
	});

	describe("save", () => {
		it("persists state to storage", async () => {
			const storage = createMockStorage(null);
			const manager = new SyncStateManager(storage);

			const validOid = "b".repeat(40);
			manager.setHeadOid(validOid);
			manager.setSHA("test.md", sampleEntry);
			await manager.save();

			expect(storage.data).toEqual({
				syncState: {
					lastRemoteHeadSha: validOid,
					lastSyncedAt: 0,
					cache: { "test.md": sampleEntry },
				},
			});
		});

		it("preserves other plugin data when saving", async () => {
			const storage = createMockStorage({ otherKey: "preserved" });
			const manager = new SyncStateManager(storage);

			await manager.load();
			manager.setHeadOid("c".repeat(40));
			await manager.save();

			expect(storage.data?.otherKey).toBe("preserved");
		});
	});

	describe("SHA cache", () => {
		it("returns undefined for unknown path", () => {
			const manager = new SyncStateManager(createMockStorage());
			expect(manager.getSHA("unknown.md")).toBeUndefined();
		});

		it("sets and gets SHA entry", () => {
			const manager = new SyncStateManager(createMockStorage());

			manager.setSHA("file.md", sampleEntry);

			expect(manager.getSHA("file.md")).toEqual(sampleEntry);
		});

		it("deletes SHA entry", () => {
			const manager = new SyncStateManager(createMockStorage());

			manager.setSHA("file.md", sampleEntry);
			manager.deleteSHA("file.md");

			expect(manager.getSHA("file.md")).toBeUndefined();
		});

		it("batch sets multiple SHA entries", () => {
			const manager = new SyncStateManager(createMockStorage());
			const entry2: SHACacheEntry = { ...sampleEntry, remoteSha: "xyz789" };

			manager.setSHABatch({
				"a.md": sampleEntry,
				"b.md": entry2,
			});

			expect(manager.getSHA("a.md")).toEqual(sampleEntry);
			expect(manager.getSHA("b.md")).toEqual(entry2);
		});

		it("getAllSHAs returns a live readonly reference", () => {
			const manager = new SyncStateManager(createMockStorage());
			manager.setSHA("file.md", sampleEntry);

			const all = manager.getAllSHAs();
			expect(all["file.md"]).toEqual(sampleEntry);

			// Mutations via setSHA are reflected in the returned reference
			const updated = { ...sampleEntry, remoteSha: "new-sha" };
			manager.setSHA("file.md", updated);
			expect(all["file.md"]).toEqual(updated);
		});
	});

	describe("head OID", () => {
		it("sets and gets a valid 40-char hex OID", () => {
			const manager = new SyncStateManager(createMockStorage());
			const validOid = "a".repeat(40);

			manager.setHeadOid(validOid);

			expect(manager.getHeadOid()).toBe(validOid);
		});

		it("allows empty string to reset OID", () => {
			const manager = new SyncStateManager(createMockStorage());

			manager.setHeadOid("");

			expect(manager.getHeadOid()).toBe("");
		});

		it("rejects invalid OID format", () => {
			const manager = new SyncStateManager(createMockStorage());

			expect(() => manager.setHeadOid("not-a-valid-oid")).toThrow("Invalid OID: not-a-valid-oid");
		});

		it("rejects OID with wrong length", () => {
			const manager = new SyncStateManager(createMockStorage());

			expect(() => manager.setHeadOid("abc123")).toThrow("Invalid OID: abc123");
		});

		it("rejects OID with non-hex characters", () => {
			const manager = new SyncStateManager(createMockStorage());
			const badOid = "g".repeat(40);

			expect(() => manager.setHeadOid(badOid)).toThrow(`Invalid OID: ${badOid}`);
		});
	});

	describe("lastSyncedAt", () => {
		it("sets and gets last synced timestamp", () => {
			const manager = new SyncStateManager(createMockStorage());

			manager.setLastSyncedAt(Date.now());

			expect(manager.getLastSyncedAt()).toBeGreaterThan(0);
		});
	});

	describe("clear", () => {
		it("resets all state to defaults", () => {
			const manager = new SyncStateManager(createMockStorage());

			manager.setHeadOid("d".repeat(40));
			manager.setLastSyncedAt(9999);
			manager.setSHA("file.md", sampleEntry);
			manager.clear();

			expect(manager.getHeadOid()).toBe("");
			expect(manager.getLastSyncedAt()).toBe(0);
			expect(manager.getAllSHAs()).toEqual({});
		});
	});
});
