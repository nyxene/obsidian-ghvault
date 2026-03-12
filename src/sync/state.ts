import type { SHACacheEntry, SyncState } from "../types";

const SHA_HEX_PATTERN = /^[0-9a-f]{40}$/;

const EMPTY_STATE: SyncState = {
	lastRemoteHeadSha: "",
	lastSyncedAt: 0,
	cache: {},
};

const STATE_KEY = "syncState";

export interface StorageAdapter {
	loadData(): Promise<Record<string, unknown> | null>;
	saveData(data: Record<string, unknown>): Promise<void>;
}

export class SyncStateManager {
	private state: SyncState = { ...EMPTY_STATE, cache: {} };
	private storage: StorageAdapter;

	constructor(storage: StorageAdapter) {
		this.storage = storage;
	}

	async load(): Promise<void> {
		const data = await this.storage.loadData();
		const raw = data?.[STATE_KEY] as SyncState | undefined;

		if (raw && typeof raw === "object" && typeof raw.cache === "object") {
			const validCache: Record<string, SHACacheEntry> = {};
			for (const [path, entry] of Object.entries(raw.cache)) {
				if (isValidCacheEntry(entry)) {
					validCache[path] = entry;
				}
			}
			this.state = {
				lastRemoteHeadSha:
					typeof raw.lastRemoteHeadSha === "string" &&
					(raw.lastRemoteHeadSha === "" || SHA_HEX_PATTERN.test(raw.lastRemoteHeadSha))
						? raw.lastRemoteHeadSha
						: "",
				lastSyncedAt: typeof raw.lastSyncedAt === "number" ? raw.lastSyncedAt : 0,
				cache: validCache,
			};
		} else {
			this.state = { ...EMPTY_STATE, cache: {} };
		}
	}

	async save(): Promise<void> {
		const data = (await this.storage.loadData()) || {};
		data[STATE_KEY] = this.state;
		await this.storage.saveData(data);
	}

	getSHA(path: string): SHACacheEntry | undefined {
		return this.state.cache[path];
	}

	setSHA(path: string, entry: SHACacheEntry): void {
		this.state.cache[path] = entry;
	}

	deleteSHA(path: string): void {
		delete this.state.cache[path];
	}

	setSHABatch(entries: Record<string, SHACacheEntry>): void {
		for (const [path, entry] of Object.entries(entries)) {
			this.state.cache[path] = entry;
		}
	}

	getAllSHAs(): Readonly<Record<string, SHACacheEntry>> {
		return this.state.cache;
	}

	getHeadOid(): string {
		return this.state.lastRemoteHeadSha;
	}

	setHeadOid(oid: string): void {
		if (oid !== "" && !SHA_HEX_PATTERN.test(oid)) {
			throw new Error(`Invalid OID: ${oid}`);
		}
		this.state.lastRemoteHeadSha = oid;
	}

	getLastSyncedAt(): number {
		return this.state.lastSyncedAt;
	}

	setLastSyncedAt(timestamp: number): void {
		this.state.lastSyncedAt = timestamp;
	}

	clear(): void {
		this.state = { ...EMPTY_STATE, cache: {} };
	}
}

function isValidCacheEntry(entry: unknown): entry is SHACacheEntry {
	if (!entry || typeof entry !== "object") return false;
	const e = entry as Record<string, unknown>;
	return (
		typeof e.remoteSha === "string" &&
		typeof e.localContentHash === "string" &&
		typeof e.lastSyncedAt === "number" &&
		typeof e.size === "number" &&
		typeof e.isBinary === "boolean"
	);
}
