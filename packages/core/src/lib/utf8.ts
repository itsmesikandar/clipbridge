/**
 * UTF-8 encode/decode without TextEncoder/TextDecoder, which are not available
 * on every React Native engine. Lone surrogates are encoded as U+FFFD.
 */

const REPLACEMENT = 0xfffd;

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      } else {
        code = REPLACEMENT;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = REPLACEMENT;
    }

    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/** Byte length of the UTF-8 encoding of `text`, without allocating it. */
export function utf8Length(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 4;
        i++;
      } else {
        length += 3;
      }
    } else length += 3;
  }
  return length;
}

/** Decodes UTF-8; invalid sequences become U+FFFD. */
export function utf8Decode(bytes: Uint8Array): string {
  const codes: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i] ?? 0;
    let code = REPLACEMENT;
    let size = 1;
    if (b0 < 0x80) {
      code = b0;
    } else if (b0 >= 0xc2 && b0 <= 0xdf && isContinuation(bytes, i + 1)) {
      code = ((b0 & 0x1f) << 6) | ((bytes[i + 1] ?? 0) & 0x3f);
      size = 2;
    } else if (
      b0 >= 0xe0 &&
      b0 <= 0xef &&
      isContinuation(bytes, i + 1) &&
      isContinuation(bytes, i + 2)
    ) {
      const candidate =
        ((b0 & 0x0f) << 12) | (((bytes[i + 1] ?? 0) & 0x3f) << 6) | ((bytes[i + 2] ?? 0) & 0x3f);
      if (candidate >= 0x800 && (candidate < 0xd800 || candidate > 0xdfff)) {
        code = candidate;
        size = 3;
      }
    } else if (
      b0 >= 0xf0 &&
      b0 <= 0xf4 &&
      isContinuation(bytes, i + 1) &&
      isContinuation(bytes, i + 2) &&
      isContinuation(bytes, i + 3)
    ) {
      const candidate =
        ((b0 & 0x07) << 18) |
        (((bytes[i + 1] ?? 0) & 0x3f) << 12) |
        (((bytes[i + 2] ?? 0) & 0x3f) << 6) |
        ((bytes[i + 3] ?? 0) & 0x3f);
      if (candidate >= 0x10000 && candidate <= 0x10ffff) {
        code = candidate;
        size = 4;
      }
    }
    codes.push(code);
    i += size;
  }

  let out = '';
  const CHUNK = 8192;
  for (let start = 0; start < codes.length; start += CHUNK) {
    out += String.fromCodePoint(...codes.slice(start, start + CHUNK));
  }
  return out;
}

function isContinuation(bytes: Uint8Array, index: number): boolean {
  const byte = bytes[index];
  return byte !== undefined && (byte & 0xc0) === 0x80;
}
