import type { App } from "obsidian";
import type { LogLevel } from "../types";
import { LOG_FILE } from "../types";

const MAX_LOG_LINES = 5000;
const TRIM_TO_LINES = 3000;
const SECRET_PATTERN = /ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|Bearer [a-zA-Z0-9_.-]+/g;

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

	constructor(options: LoggerOptions) {
		this.app = options.app;
		this.minLevel = options.minLevel;
	}

	setLevel(level: LogLevel): void {
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
		if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
		};

		if (data !== undefined) {
			entry.data = data;
		}

		const line = sanitizeSecrets(JSON.stringify(entry));
		this.app.vault.adapter.append(LOG_FILE, `${line}\n`).catch(() => {});

		this.writeCount++;
		if (this.writeCount >= MAX_LOG_LINES && !this.rotating) {
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
				this.writeCount = 0;
				this.rotating = false;
			});
	}
}
