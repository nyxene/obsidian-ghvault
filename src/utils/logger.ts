import type { App } from "obsidian";
import type { LogLevel } from "../types";
import { LOG_FILE } from "../types";

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

		const line = `${JSON.stringify(entry)}\n`;
		this.app.vault.adapter.append(LOG_FILE, line).catch(() => {
			// Silently ignore write failures to avoid recursive error loops
		});
	}
}
