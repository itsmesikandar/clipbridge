import {
  type AppError,
  appError,
  classifyText,
  type ClipboardChange,
  type ClipboardPort,
  type ClipContent,
  err,
  ok,
  type Result,
  type Unsubscribe,
} from '@clipbridge/core';

/** The subset of Electron's (async, W3C-style) `clipboard` module this adapter needs. */
export interface SystemClipboard {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  has(mimetype: string): Promise<boolean>;
}

/**
 * Formats that password managers and the OS set to say "do not sync or record
 * this copy" (docs/PLAN.md §8.5).
 */
export const SENSITIVE_FORMATS = [
  'org.nspasteboard.ConcealedType',
  'org.nspasteboard.TransientType',
  'ExcludeClipboardContentFromMonitorProcessing',
  'Clipboard Viewer Ignore',
] as const;

/** Electron's syntax for checking a raw OS clipboard format. */
export function rawFormat(format: string): string {
  return `electron application/osclipboard;format="${format}"`;
}

export const POLL_INTERVAL_MS = 500;

/**
 * Electron has no clipboard change event, so the adapter polls. A cheap string
 * comparison runs every 500 ms; the first read only sets the baseline so whatever
 * was on the clipboard at startup is not sent. Text only until images (M6).
 */
export class ElectronClipboard implements ClipboardPort {
  private lastText: string | null = null;
  private readonly listeners = new Set<(change: ClipboardChange) => void>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(
    private readonly system: SystemClipboard,
    private readonly intervalMs = POLL_INTERVAL_MS,
  ) {}

  async write(content: ClipContent): Promise<Result<void, AppError>> {
    if (content.kind === 'image') {
      return err(
        appError('CLIPBOARD_ACCESS_FAILED', 'images arrive in M6', { operation: 'write' }),
      );
    }
    const text = content.kind === 'text' ? content.text : content.url;
    // Set first: a poll running during the write must not report it as a user copy.
    this.lastText = text;
    try {
      await this.system.writeText(text);
      return ok(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return err(
        appError('CLIPBOARD_ACCESS_FAILED', `write failed: ${message}`, { operation: 'write' }),
      );
    }
  }

  watch(listener: (change: ClipboardChange) => void): Unsubscribe {
    this.listeners.add(listener);
    if (!this.timer) {
      this.polling = true;
      void this.readTextSafely().then((text) => {
        this.lastText ??= text;
        this.polling = false;
      });
      this.timer = setInterval(() => {
        void this.poll();
      }, this.intervalMs);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  /** One polling step; public for tests. Overlapping polls are skipped. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const text = await this.readTextSafely();
      if (text === null || text === this.lastText) return;
      this.lastText = text;
      if (text.length === 0) return;
      const change: ClipboardChange = {
        content: classifyText(text),
        sensitive: await this.isSensitive(),
      };
      for (const listener of [...this.listeners]) listener(change);
    } finally {
      this.polling = false;
    }
  }

  private async readTextSafely(): Promise<string | null> {
    try {
      return await this.system.readText();
    } catch {
      return null; // clipboard locked by another app; try again next tick
    }
  }

  private async isSensitive(): Promise<boolean> {
    const checks = await Promise.all(
      SENSITIVE_FORMATS.map((format) => this.system.has(rawFormat(format)).catch(() => false)),
    );
    return checks.some(Boolean);
  }
}
