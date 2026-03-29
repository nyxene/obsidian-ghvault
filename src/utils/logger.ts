import type { App } from "obsidian";
import type { LogLevel } from "../types";
import { LOG_FILE, SECRET_PATTERN, VALID_LOG_LEVELS } from "../types";

const MAX_LOG_LINES = 5000;
const TRIM_TO_LINES = 3000;

const MAX_DATA_STRING_LENGTH = 500;

function sanitizeSecrets(text: string): string {
	return text.replace(SECRET_PATTERN, "[REDACTED]");
}

function truncateDataStrings(data: unknown): unknown {
	if (typeof data === "string") {
		return data.length > MAX_DATA_STRING_LENGTH
			? `${data.slice(0, MAX_DATA_STRING_LENGTH)}...`
			: data;
	}
	if (data && typeof data === "object" && !Array.isArray(data)) {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(data)) {
			result[key] = truncateDataStrings(value);
		}
		return result;
	}
	return data;
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
				await this.rotateLog();
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
			entry.data = truncateDataStrings(data);
		}

		const line = sanitizeSecrets(JSON.stringify(entry));

		if (this.rotating) {
			this.writeQueue.push(line);
			return;
		}

		this.app.vault.adapter.append(LOG_FILE, `${line}\n`).catch(() => {
			// biome-ignore lint/suspicious/noConsole: intentional fallback when log file is inaccessible
			console.warn("[GHVault] Log write failed:", line);
		});

		this.writeCount++;
		if (this.writeCount >= MAX_LOG_LINES) {
			void this.rotateLog();
		}
	}

	private async rotateLog(): Promise<void> {
		this.rotating = true;
		try {
			const content = await this.app.vault.adapter.read(LOG_FILE);
			const lines = content.split("\n");
			if (lines.length > MAX_LOG_LINES) {
				const trimmed = lines.slice(lines.length - TRIM_TO_LINES).join("\n");
				await this.app.vault.adapter.write(LOG_FILE, `${trimmed}\n`);
				this.writeCount = TRIM_TO_LINES;
			}
		} catch {
			// biome-ignore lint/suspicious/noConsole: intentional fallback when log file is inaccessible
			console.warn("[GHVault] Log rotation failed");
		} finally {
			this.rotating = false;
			if (this.writeQueue.length > 0) {
				const queued = this.writeQueue.join("\n");
				this.writeQueue = [];
				await this.app.vault.adapter.append(LOG_FILE, `${queued}\n`).catch(() => {
					// biome-ignore lint/suspicious/noConsole: intentional fallback when log file is inaccessible
					console.warn("[GHVault] Log queue flush failed");
				});
				this.writeCount += queued.split("\n").length;
			}
		}
	}
}
