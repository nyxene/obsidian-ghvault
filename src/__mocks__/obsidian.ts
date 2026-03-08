import { vi } from "vitest";

export const requestUrl = vi.fn();

export class Plugin {
	app = {};
	manifest = {};
	async loadData(): Promise<unknown> {
		return null;
	}
	async saveData(_data: unknown): Promise<void> {}
	addSettingTab(_tab: unknown): void {}
	addRibbonIcon(_icon: string, _title: string, _cb: unknown): HTMLElement {
		return document.createElement("div");
	}
	addCommand(_cmd: unknown): unknown {
		return _cmd;
	}
	addStatusBarItem(): HTMLElement {
		return document.createElement("div");
	}
}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl = document.createElement("div");
	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
	display(): void {}
	hide(): void {}
}

export class Setting {
	setName(_name: string): this {
		return this;
	}
	setDesc(_desc: string): this {
		return this;
	}
	addText(_cb: unknown): this {
		return this;
	}
	addDropdown(_cb: unknown): this {
		return this;
	}
	addToggle(_cb: unknown): this {
		return this;
	}
	addButton(_cb: unknown): this {
		return this;
	}
}

export class Notice {
	message: string;
	constructor(message: string, _duration?: number) {
		this.message = message;
	}
}

export class TFile {
	path = "";
	name = "";
	basename = "";
	extension = "";
	stat = { size: 0, ctime: 0, mtime: 0 };
	vault = {};
	parent = null;
}

export class TFolder {
	path = "";
	name = "";
	children: unknown[] = [];
	vault = {};
	parent = null;
}
