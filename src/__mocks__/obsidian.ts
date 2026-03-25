import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Minimal fake DOM element that works without jsdom / happy-dom.
// Obsidian augments HTMLElement with helpers like empty(), createEl(),
// setText(), etc. We reproduce the subset needed by our tests.
// ---------------------------------------------------------------------------

interface FakeStyle {
	[key: string]: string;
}

interface FakeEl {
	tagName: string;
	className: string;
	textContent: string;
	type: string;
	style: FakeStyle;
	children: FakeEl[];
	empty(): void;
	addClass(cls: string): void;
	createEl(
		tag: string,
		opts?: { cls?: string; text?: string; href?: string; attr?: Record<string, string> },
	): FakeEl;
	createSpan(opts?: { cls?: string; text?: string }): FakeEl;
	setText(text: string): void;
	querySelector(selector: string): FakeEl | null;
	appendChild(child: FakeEl): void;
	addEventListener(event: string, handler: () => void): void;
	toggle(show: boolean): void;
	/** Test helper: trigger a DOM event */
	simulateEvent(event: string): void;
}

function createFakeEl(tag: string): FakeEl {
	const eventHandlers = new Map<string, Array<() => void>>();
	const el: FakeEl = {
		tagName: tag.toUpperCase(),
		className: "",
		textContent: "",
		type: "",
		style: {} as FakeStyle,
		children: [],
		empty() {
			this.children = [];
			this.textContent = "";
		},
		addClass(cls: string) {
			this.className = this.className ? `${this.className} ${cls}` : cls;
		},
		createEl(
			t: string,
			opts?: { cls?: string; text?: string; href?: string; attr?: Record<string, string> },
		): FakeEl {
			const child = createFakeEl(t);
			if (opts?.cls) child.className = opts.cls;
			if (opts?.text) child.textContent = opts.text;
			this.children.push(child);
			return child;
		},
		createSpan(opts?: { cls?: string; text?: string }): FakeEl {
			return this.createEl("span", opts);
		},
		setText(text: string) {
			this.textContent = text;
		},
		querySelector(selector: string): FakeEl | null {
			// Minimal: supports ".classname" selectors
			if (selector.startsWith(".")) {
				const cls = selector.slice(1);
				return findByClass(this, cls);
			}
			return null;
		},
		appendChild(child: FakeEl) {
			this.children.push(child);
		},
		toggle(_show: boolean) {
			// no-op in tests
		},
		addEventListener(event: string, handler: () => void) {
			const handlers = eventHandlers.get(event) ?? [];
			handlers.push(handler);
			eventHandlers.set(event, handlers);
		},
		simulateEvent(event: string) {
			for (const handler of eventHandlers.get(event) ?? []) {
				handler();
			}
		},
	};
	return el;
}

function findByClass(el: FakeEl, cls: string): FakeEl | null {
	for (const child of el.children) {
		if (child.className === cls) return child;
		const found = findByClass(child, cls);
		if (found) return found;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Obsidian API mocks
// ---------------------------------------------------------------------------

export const requestUrl = vi.fn();

export class Modal {
	app: unknown;
	contentEl = createFakeEl("div");
	constructor(app: unknown) {
		this.app = app;
	}
	open(): void {}
	close(): void {}
	onClose(): void {}
}

export class Plugin {
	app = {};
	manifest = {};
	async loadData(): Promise<unknown> {
		return null;
	}
	async saveData(_data: unknown): Promise<void> {}
	addSettingTab(_tab: unknown): void {}
	addRibbonIcon(_icon: string, _title: string, _cb: unknown): unknown {
		return createFakeEl("div");
	}
	addCommand(_cmd: unknown): unknown {
		return _cmd;
	}
	addStatusBarItem(): unknown {
		return createFakeEl("div");
	}
	registerView(_type: string, _creator: unknown): void {}
	registerEvent(_event: unknown): void {}
}

export class ItemView {
	app: unknown;
	leaf: unknown;
	contentEl = createFakeEl("div");
	containerEl = createFakeEl("div");
	constructor(leaf: unknown) {
		this.leaf = leaf;
	}
	getViewType(): string {
		return "";
	}
	getDisplayText(): string {
		return "";
	}
	getIcon(): string {
		return "";
	}
	addAction(_icon: string, _title: string, _cb: unknown): unknown {
		return createFakeEl("div");
	}
	async onOpen(): Promise<void> {}
	async onClose(): Promise<void> {}
}

export function setIcon(_el: unknown, _iconId: string): void {}

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl = createFakeEl("div");
	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}
	display(): void {}
	hide(): void {}
}

export class TextComponent {
	inputEl = createFakeEl("input");
	private _value = "";
	private _placeholder = "";
	private _onChange?: (value: string) => void | Promise<void>;

	setPlaceholder(placeholder: string): this {
		this._placeholder = placeholder;
		return this;
	}
	setValue(value: string): this {
		this._value = value;
		return this;
	}
	getValue(): string {
		return this._value;
	}
	getPlaceholder(): string {
		return this._placeholder;
	}
	onChange(cb: (value: string) => void | Promise<void>): this {
		this._onChange = cb;
		return this;
	}
	async simulateChange(value: string): Promise<void> {
		await this._onChange?.(value);
	}
}

export class DropdownComponent {
	private _value = "";
	private _options: Record<string, string> = {};
	private _onChange?: (value: string) => void | Promise<void>;

	addOptions(options: Record<string, string>): this {
		this._options = options;
		return this;
	}
	getOptions(): Record<string, string> {
		return this._options;
	}
	setValue(value: string): this {
		this._value = value;
		return this;
	}
	getValue(): string {
		return this._value;
	}
	onChange(cb: (value: string) => void | Promise<void>): this {
		this._onChange = cb;
		return this;
	}
	async simulateChange(value: string): Promise<void> {
		await this._onChange?.(value);
	}
}

export class ToggleComponent {
	private _value = false;
	private _onChange?: (value: boolean) => void | Promise<void>;

	setValue(value: boolean): this {
		this._value = value;
		return this;
	}
	getValue(): boolean {
		return this._value;
	}
	onChange(cb: (value: boolean) => void | Promise<void>): this {
		this._onChange = cb;
		return this;
	}
	async simulateChange(value: boolean): Promise<void> {
		await this._onChange?.(value);
	}
}

export class ButtonComponent {
	private _text = "";
	private _disabled = false;
	private _onClick?: () => void | Promise<void>;

	setButtonText(text: string): this {
		this._text = text;
		return this;
	}
	getButtonText(): string {
		return this._text;
	}
	setDisabled(disabled: boolean): this {
		this._disabled = disabled;
		return this;
	}
	isDisabled(): boolean {
		return this._disabled;
	}
	setWarning(): this {
		return this;
	}
	onClick(cb: () => void | Promise<void>): this {
		this._onClick = cb;
		return this;
	}
	async simulateClick(): Promise<void> {
		await this._onClick?.();
	}
}

export class Setting {
	static instances: Setting[] = [];
	static clearInstances(): void {
		Setting.instances = [];
	}

	settingEl = createFakeEl("div");
	nameEl = createFakeEl("div");
	descEl = createFakeEl("div");

	private _name = "";
	private _desc = "";
	textComponents: TextComponent[] = [];
	dropdownComponents: DropdownComponent[] = [];
	toggleComponents: ToggleComponent[] = [];
	buttonComponents: ButtonComponent[] = [];

	constructor(_containerEl: unknown) {
		Setting.instances.push(this);
	}

	setName(name: string): this {
		this._name = name;
		return this;
	}
	getName(): string {
		return this._name;
	}
	setDesc(desc: string): this {
		this._desc = desc;
		return this;
	}
	getDesc(): string {
		return this._desc;
	}
	addText(cb: (text: TextComponent) => unknown): this {
		const text = new TextComponent();
		cb(text);
		this.textComponents.push(text);
		return this;
	}
	addDropdown(cb: (dropdown: DropdownComponent) => unknown): this {
		const dropdown = new DropdownComponent();
		cb(dropdown);
		this.dropdownComponents.push(dropdown);
		return this;
	}
	addToggle(cb: (toggle: ToggleComponent) => unknown): this {
		const toggle = new ToggleComponent();
		cb(toggle);
		this.toggleComponents.push(toggle);
		return this;
	}
	addButton(cb: (button: ButtonComponent) => void): this {
		const button = new ButtonComponent();
		cb(button);
		this.buttonComponents.push(button);
		return this;
	}
	addTextArea(cb: (text: TextComponent) => unknown): this {
		const text = new TextComponent();
		cb(text);
		this.textComponents.push(text);
		return this;
	}
}

export class SettingGroup {
	private _heading = "";
	private _containerEl: unknown;

	constructor(containerEl: unknown) {
		this._containerEl = containerEl;
	}

	setHeading(text: string): this {
		this._heading = text;
		return this;
	}

	getHeading(): string {
		return this._heading;
	}

	addClass(_cls: string): this {
		return this;
	}

	addSetting(cb: (setting: Setting) => void): this {
		const setting = new Setting(this._containerEl);
		cb(setting);
		return this;
	}

	addExtraButton(_cb: unknown): this {
		return this;
	}

	addSearch(_cb: unknown): this {
		return this;
	}
}

export interface EventRef {
	id: number;
}

export class Vault {
	private _listeners = new Map<number, { event: string; cb: (...args: unknown[]) => void }>();
	private _nextId = 1;

	on(event: string, cb: (...args: unknown[]) => void): EventRef {
		const id = this._nextId++;
		this._listeners.set(id, { event, cb });
		return { id };
	}

	offref(ref: EventRef): void {
		this._listeners.delete(ref.id);
	}

	/** Test helper: trigger a vault event */
	trigger(event: string, ...args: unknown[]): void {
		for (const listener of this._listeners.values()) {
			if (listener.event === event) {
				listener.cb(...args);
			}
		}
	}

	getListenerCount(): number {
		return this._listeners.size;
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
