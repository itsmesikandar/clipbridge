import { clipboard, ClipboardItem, nativeImage } from 'electron';

import type { SystemClipboard } from './electron-clipboard';

const PNG = 'image/png';

/** Electron 44's async (W3C-style) clipboard behind the adapter's small interface. */
export const electronSystemClipboard: SystemClipboard = {
  readText: () => clipboard.readText(),
  writeText: (text) => clipboard.writeText(text),
  has: (mimetype) => clipboard.has(mimetype),

  async readImagePng() {
    if (!(await clipboard.has(PNG))) return null;
    const items = await clipboard.read();
    const item = items.find((candidate) => candidate.types.includes(PNG));
    if (!item) return null;
    const blob = await item.getType(PNG);
    return new Uint8Array(await blob.arrayBuffer());
  },

  async writeImage(mime, data) {
    // Clipboards hold PNG; photos from phones are usually JPEG.
    const png =
      mime === PNG ? data : new Uint8Array(nativeImage.createFromBuffer(Buffer.from(data)).toPNG());
    await clipboard.write([
      new ClipboardItem({ [PNG]: new Blob([new Uint8Array(png)], { type: PNG }) }),
    ]);
  },
};

/** Small preview for the history list (data URL), or null if the image cannot be decoded. */
export function makeThumbnail(data: Uint8Array, width = 160): Promise<string | null> {
  const image = nativeImage.createFromBuffer(Buffer.from(data));
  if (image.isEmpty()) return Promise.resolve(null);
  return Promise.resolve(image.resize({ width, quality: 'good' }).toDataURL());
}
