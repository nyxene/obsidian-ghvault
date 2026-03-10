import type { App } from "obsidian";
import type { LogLevel } from "../types";
import { LOG_FILE, VALID_LOG_LEVELS } from "../types";

const MAX_LOG_LINES = 5000;
const TRIM_TO_LINES = 3000;
const SECRET_PATTERN =
	/gh[pousx]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|Bearer [a-zA-Z0-9_.-]+|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function sanitizeSecrets(text: string): string {
	return text.replace(SECRET_PATTERN, "[REDACTED]");
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
};

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	data?: unknown;
}

export interface LoggerOptions {
	app: App;
	minLevel: LogLevel;
}

export class Logger {
	private readonly app: App;
	private minLevel: LogLevel;
	private writeCount = 0;
	private rotating = false;
	private writeQueue: string[] = [];

	constructor(options: LoggerOptions) {
		this.app = options.app;
		this.minLevel = options.minLevel;
	}

	async init(): Promise<void> {
		try {
			const content = await this.app.vault.adapter.read(LOG_FILE);
			const lineCount = content.split("\n").length;
			this.writeCount = lineCount;
			if (lineCount > MAX_LOG_LINES) {
				this.rotateLog();
			}
		} catch {
			// Log file does not exist yet
		}
	}

	setLevel(level: LogLevel): void {
		if (!VALID_LOG_LEVELS.includes(level)) return;
		this.minLevel = level;
	}

	debug(message: string, data?: unknown): void {
		this.write("debug", message, data);
	}

	info(message: string, data?: unknown): void {
		this.write("info", message, data);
	}

	warn(message: string, data?: unknown): void {
		this.write("warn", message, data);
	}

	error(message: string, data?: unknown): void {
		this.write("error", message, data);
	}

	private write(level: LogLevel, message: string, data?: unknown): void {
		const priority = LEVEL_PRIORITY[level];
		if (priority === undefined || priority < LEVEL_PRIORITY[this.minLevel]) return;

		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
		};

		if (data !== undefined) {
			entry.data = data;
		}

		const line = sanitizeSecrets(JSON.stringify(entry));

		if (this.rotating) {
			this.writeQueue.push(line);
			return;
		}

		this.app.vault.adapter.append(LOG_FILE, `${line}\n`).catch(() => {});

		this.writeCount++;
		if (this.writeCount >= MAX_LOG_LINES) {
			this.rotateLog();
		}
	}

	private rotateLog(): void {
		this.rotating = true;
		this.app.vault.adapter
			.read(LOG_FILE)
			.then((content) => {
				const lines = content.split("\n");
				if (lines.length > MAX_LOG_LINES) {
					const trimmed = lines.slice(lines.length - TRIM_TO_LINES).join("\n");
					return this.app.vault.adapter.write(LOG_FILE, `${trimmed}\n`);
				}
			})
			.catch(() => {})
			.finally(() => {
				this.rotating = false;
				this.writeCount = 0;
				if (this.writeQueue.length > 0) {
					const queued = this.writeQueue.join("\n");
					this.writeQueue = [];
					this.app.vault.adapter.append(LOG_FILE, `${queued}\n`).catch(() => {});
					this.writeCount = queued.split("\n").length;
				}
			});
	}
}
