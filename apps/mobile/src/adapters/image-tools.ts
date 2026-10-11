/** Getting images in and out of the phone: shared files, the clipboard, thumbnails. */

import { base64ToBytes, bytesToBase64, CLIP_LIMITS, type ClipContent } from '@clipbridge/core';
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export type ImageContent = Extract<ClipContent, { kind: 'image' }>;

/** Longest side after shrinking an image that is too large to send. */
const MAX_SIDE = 2560;
const THUMBNAIL_WIDTH = 160;

export function isSupportedMime(mime: string | null | undefined): mime is ImageContent['mime'] {
  return mime === 'image/png' || mime === 'image/jpeg';
}

/** Turns a data URL or a bare base64 string into bytes. */
export function decodeImageBase64(value: string): Uint8Array | null {
  const comma = value.startsWith('data:') ? value.indexOf(',') : -1;
  return base64ToBytes(comma >= 0 ? value.slice(comma + 1) : value);
}

/** Re-encodes any image the OS can read (HEIC, WebP, huge PNG) as a JPEG that fits the limit. */
async function toSendableJpeg(uri: string): Promise<ImageContent | null> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: MAX_SIDE });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.85,
    base64: true,
  });
  const data = result.base64 ? decodeImageBase64(result.base64) : null;
  return data && data.length <= CLIP_LIMITS.imageBytes
    ? { kind: 'image', mime: 'image/jpeg', data }
    : null;
}

/** Reads an image shared from another app (share sheet). */
export async function imageFromSharedFile(
  uri: string,
  mime: string | null,
): Promise<ImageContent | null> {
  if (isSupportedMime(mime)) {
    const data = new Uint8Array(await new File(uri).arrayBuffer());
    if (data.length <= CLIP_LIMITS.imageBytes) return { kind: 'image', mime, data };
  }
  return toSendableJpeg(uri);
}

/** The clipboard image as PNG (shrunk to JPEG if too large), or null if there is none. */
export async function imageFromClipboard(): Promise<ImageContent | null> {
  if (!(await Clipboard.hasImageAsync())) return null;
  const image = await Clipboard.getImageAsync({ format: 'png' });
  if (!image) return null;
  const data = decodeImageBase64(image.data);
  if (!data) return null;
  if (data.length <= CLIP_LIMITS.imageBytes) return { kind: 'image', mime: 'image/png', data };
  return toSendableJpeg(image.data);
}

/** Puts an image on the phone's clipboard. */
export async function writeImageToClipboard(image: ImageContent): Promise<void> {
  await Clipboard.setImageAsync(bytesToBase64(image.data));
}

/** Small JPEG preview (data URL) for the Recent list. */
export async function makeThumbnail(image: ImageContent): Promise<string | null> {
  const context = ImageManipulator.manipulate(
    `data:${image.mime};base64,${bytesToBase64(image.data)}`,
  );
  context.resize({ width: THUMBNAIL_WIDTH });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
  return result.base64 ? `data:image/jpeg;base64,${result.base64}` : null;
}
