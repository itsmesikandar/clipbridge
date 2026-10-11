import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import type { LogContext, LoggerPort } from '@clipbridge/core';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface FileLoggerOptions {
  readonly filePath: string;
  readonly minLevel: Level;
  readonly maxBytes: number;
  /** Rotated files kept next to the active one (`main.log.1`, `main.log.2`, …). */
  readonly keepFiles: number;
  readonly mirrorToConsole: boolean;
}

/**
 * Line-based log file with size rotation. Context values are primitives only
 * (enforced by `LogContext`), so clip contents and keys cannot be logged by accident.
 */
export class FileLogger implements LoggerPort {
  constructor(private readonly options: FileLoggerOptions) {
    mkdirSync(dirname(options.filePath), { recursive: true });
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  private write(level: Level, message: string, context: LogContext | undefined): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.options.minLevel]) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${
      context ? ` ${JSON.stringify(context)}` : ''
    }\n`;
    if (this.options.mirrorToConsole) {
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'log' : level](line.trimEnd());
    }
    try {
      this.rotateIfNeeded();
      appendFileSync(this.options.filePath, line);
    } catch {
      // Logging must never crash the app.
    }
  }

  private rotateIfNeeded(): void {
    const { filePath, maxBytes, keepFiles } = this.options;
    if (!existsSync(filePath) || statSync(filePath).size < maxBytes) return;
    rmSync(`${filePath}.${keepFiles}`, { force: true });
    for (let i = keepFiles - 1; i >= 1; i--) {
      if (existsSync(`${filePath}.${i}`)) renameSync(`${filePath}.${i}`, `${filePath}.${i + 1}`);
    }
    renameSync(filePath, `${filePath}.1`);
  }
}
