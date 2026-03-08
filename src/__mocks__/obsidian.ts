import { vi } from "vitest";

export const requestUrl = vi.fn();

export class Plugin {
	app = {};
	manifest = {};
	async loadData(): Promise<unknown> {
		return null;
	}
	async saveData(_data: unknown): Promise<void> {}
}
