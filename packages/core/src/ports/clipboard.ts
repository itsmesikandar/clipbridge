import type { ClipContent } from '../domain/clip';
import type { AppError } from '../domain/errors';
import type { Result } from '../domain/result';
import type { Unsubscribe } from './transport';

export interface ClipboardChange {
  readonly content: ClipContent;
  /** Marked as concealed/transient by the OS or a password manager; never synced. */
  readonly sensitive: boolean;
}

export interface ClipboardPort {
  write(content: ClipContent): Promise<Result<void, AppError>>;
  /**
   * Reports user copies (desktop only). Phones cannot read the clipboard in the
   * background, so they leave this undefined and send via the share sheet instead.
   */
  watch?(listener: (change: ClipboardChange) => void): Unsubscribe;
}
