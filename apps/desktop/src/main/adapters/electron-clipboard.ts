import { createHash } from 'node:crypto';

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

/** What the adapter needs from the OS clipboard (Electron in production, a fake in tests). */
export interface SystemClipboard {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  has(mimetype: string): Promise<boolean>;
  /** PNG bytes of the clipboard image, or null if there is none. */
  readImagePng(): Promise<Uint8Array | null>;
  /** Puts an image on the clipboard; JPEG is converted to PNG by the implementation. */
  writeImage(mime: 'image/png' | 'image/jpeg', data: Uint8Array): Promise<void>;
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
 * Reading an image is much more expensive than reading text (the OS encodes a
 * PNG) and keeps the clipboard open, which can make other apps' copies fail on
 * Windows. Images are checked every 5 polls (2.5 s), backing off to every 20
 * polls (10 s) while the same image stays on the clipboard.
 */
export const IMAGE_POLL_EVERY = 5;
export const IMAGE_POLL_MAX_EVERY = 20;

function fingerprint(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}

/**
 * Electron has no clipboard change event, so the adapter polls. Text is checked
 * every 500 ms; images every 2.5 s and only when there is no text (copying from
 * a document often puts both; the text is what the user wants). The first read
 * only sets the baseline, so whatever was on the clipboard at startup is not sent.
 */
export class ElectronClipboard implements ClipboardPort {
  private lastText: string | null = null;
  private lastImage: string | null = null;
  private readonly listeners = new Set<(change: ClipboardChange) => void>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private imageEvery = IMAGE_POLL_EVERY;
  private pollsSinceImageCheck = 0;
  /** The first read (what was on the clipboard at startup); polls wait for it. */
  private baseline: Promise<void> = Promise.resolve();

  constructor(
    private readonly system: SystemClipboard,
    private readonly intervalMs = POLL_INTERVAL_MS,
  ) {}

  async write(content: ClipContent): Promise<Result<void, AppError>> {
    try {
      if (content.kind === 'image') {
        await this.system.writeImage(content.mime, content.data);
        // The OS may re-encode the image; remember what it now returns so it is not
        // mistaken for a new copy and sent back (which would ping-pong between devices).
        const stored = await this.system.readImagePng();
        this.lastImage = stored ? fingerprint(stored) : null;
        this.lastText = '';
        return ok(undefined);
      }
      const text = content.kind === 'text' ? content.text : content.url;
      // Set first: a poll running during the write must not report it as a user copy.
      this.lastText = text;
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
      this.baseline = this.readBaseline();
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
      await this.baseline;
      const text = await this.readTextSafely();
      if (text !== null && text !== this.lastText) {
        this.lastText = text;
        this.imageEvery = IMAGE_POLL_EVERY;
        if (text.length > 0) {
          this.emit({ content: classifyText(text), sensitive: await this.isSensitive() });
          return;
        }
      }
      this.pollsSinceImageCheck += 1;
      if (text === '' && this.pollsSinceImageCheck >= this.imageEvery) {
        this.pollsSinceImageCheck = 0;
        await this.pollImage();
      }
    } finally {
      this.polling = false;
    }
  }

  private async pollImage(): Promise<void> {
    const png = await this.readImageSafely();
    if (!png) {
      this.lastImage = null;
      return;
    }
    const print = fingerprint(png);
    if (print === this.lastImage) {
      this.imageEvery = Math.min(IMAGE_POLL_MAX_EVERY, this.imageEvery * 2);
      return;
    }
    this.lastImage = print;
    this.imageEvery = IMAGE_POLL_EVERY;
    this.emit({
      content: { kind: 'image', mime: 'image/png', data: png },
      sensitive: await this.isSensitive(),
    });
  }

  private async readBaseline(): Promise<void> {
    this.lastText ??= await this.readTextSafely();
    const png = await this.readImageSafely();
    this.lastImage ??= png ? fingerprint(png) : null;
  }

  private emit(change: ClipboardChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }

  private async readTextSafely(): Promise<string | null> {
    try {
      return await this.system.readText();
    } catch {
      return null; // clipboard locked by another app; try again next tick
    }
  }

  private async readImageSafely(): Promise<Uint8Array | null> {
    try {
      return await this.system.readImagePng();
    } catch {
      return null;
    }
  }

  private async isSensitive(): Promise<boolean> {
    const checks = await Promise.all(
      SENSITIVE_FORMATS.map((format) => this.system.has(rawFormat(format)).catch(() => false)),
    );
    return checks.some(Boolean);
  }
}
