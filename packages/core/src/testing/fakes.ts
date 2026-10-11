import type { Clip, ClipContent } from '../domain/clip';
import type { DeviceRecord } from '../domain/device';
import type { AppError } from '../domain/errors';
import { ok, type Result } from '../domain/result';
import type { ClipboardChange, ClipboardPort } from '../ports/clipboard';
import type { LogContext, LoggerPort } from '../ports/logger';
import type { NotifierPort } from '../ports/notifier';
import type { Unsubscribe } from '../ports/transport';

/** In-memory desktop clipboard. `userCopies()` simulates the user pressing Ctrl+C. */
export class FakeClipboard implements ClipboardPort {
  content: ClipContent | null = null;
  readonly writes: ClipContent[] = [];
  private readonly listeners = new Set<(change: ClipboardChange) => void>();

  write(content: ClipContent): Promise<Result<void, AppError>> {
    this.content = content;
    this.writes.push(content);
    // Real clipboards report our own writes as changes too; loop prevention must cope.
    this.emit({ content, sensitive: false });
    return Promise.resolve(ok(undefined));
  }

  watch(listener: (change: ClipboardChange) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  userCopies(content: ClipContent, sensitive = false): void {
    this.content = content;
    this.emit({ content, sensitive });
  }

  /** Phone variant: can be written but not watched, like Android/iOS in the background. */
  asPhoneClipboard(): ClipboardPort {
    return { write: (content) => this.write(content) };
  }

  private emit(change: ClipboardChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}

export class FakeNotifier implements NotifierPort {
  readonly received: { clip: Clip; from: DeviceRecord | undefined }[] = [];

  clipReceived(clip: Clip, from: DeviceRecord | undefined): void {
    this.received.push({ clip, from });
  }
}

export interface LogEntry {
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly context: LogContext | undefined;
}

export class MemoryLogger implements LoggerPort {
  readonly entries: LogEntry[] = [];

  debug(message: string, context?: LogContext): void {
    this.entries.push({ level: 'debug', message, context });
  }
  info(message: string, context?: LogContext): void {
    this.entries.push({ level: 'info', message, context });
  }
  warn(message: string, context?: LogContext): void {
    this.entries.push({ level: 'warn', message, context });
  }
  error(message: string, context?: LogContext): void {
    this.entries.push({ level: 'error', message, context });
  }
}
