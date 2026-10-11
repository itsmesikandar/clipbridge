import { utf8Encode, utf8Length } from '../lib/utf8';
import { type AppError, appError } from './errors';
import type { ClipId, DeviceId } from './ids';
import { err, ok, type Result } from './result';

export type ClipKind = 'text' | 'url' | 'image';
export type ImageMime = 'image/png' | 'image/jpeg';

export type ClipContent =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'url'; readonly url: string }
  | { readonly kind: 'image'; readonly mime: ImageMime; readonly data: Uint8Array };

/** One copied item travelling between devices. */
export interface Clip {
  readonly id: ClipId;
  /** Device where the user copied it. */
  readonly origin: DeviceId;
  /** Origin device clock, Unix ms. */
  readonly createdAt: number;
  readonly content: ClipContent;
  /** SHA-256 (hex) of `kind` + content bytes; used for loop prevention and dedupe. */
  readonly hash: string;
}

export const CLIP_LIMITS = {
  textBytes: 1024 * 1024,
  imageBytes: 10 * 1024 * 1024,
  urlChars: 8192,
} as const;

const SINGLE_URL = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/** Classifies copied text: a single http(s) URL becomes a `url` clip, anything else `text`. */
export function classifyText(text: string): ClipContent {
  const trimmed = text.trim();
  if (trimmed.length <= CLIP_LIMITS.urlChars && SINGLE_URL.test(trimmed)) {
    return { kind: 'url', url: trimmed };
  }
  return { kind: 'text', text };
}

export function contentSize(content: ClipContent): number {
  switch (content.kind) {
    case 'text':
      return utf8Length(content.text);
    case 'url':
      return utf8Length(content.url);
    case 'image':
      return content.data.length;
  }
}

export function isEmptyContent(content: ClipContent): boolean {
  switch (content.kind) {
    case 'text':
      return content.text.length === 0;
    case 'url':
      return content.url.length === 0;
    case 'image':
      return content.data.length === 0;
  }
}

/** Checks size limits (docs/PLAN.md §10). */
export function validateContentSize(
  content: ClipContent,
): Result<ClipContent, AppError<'PAYLOAD_TOO_LARGE'>> {
  const size = contentSize(content);
  const limit = content.kind === 'image' ? CLIP_LIMITS.imageBytes : CLIP_LIMITS.textBytes;
  if (size > limit) {
    return err(
      appError('PAYLOAD_TOO_LARGE', `${content.kind} clip of ${size} bytes exceeds ${limit}`, {
        kind: content.kind,
        sizeBytes: size,
        limitBytes: limit,
      }),
    );
  }
  return ok(content);
}

/** Bytes that identify the content for hashing: `kind`, a 0 separator, then the payload. */
export function contentFingerprintBytes(content: ClipContent): Uint8Array {
  const prefix = utf8Encode(`${content.kind}\u0000`);
  const body =
    content.kind === 'image'
      ? content.data
      : utf8Encode(content.kind === 'text' ? content.text : content.url);
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix);
  out.set(body, prefix.length);
  return out;
}

/**
 * Total order used for "newest wins": later `createdAt` first, ties broken by origin id.
 * Returns a positive number when `a` is newer than `b`.
 */
export function compareClipRecency(
  a: Pick<Clip, 'createdAt' | 'origin'>,
  b: Pick<Clip, 'createdAt' | 'origin'>,
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  if (a.origin === b.origin) return 0;
  return a.origin > b.origin ? 1 : -1;
}
