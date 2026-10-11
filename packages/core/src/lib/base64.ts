/** Standard base64 (RFC 4648 §4, with padding), implemented without platform APIs. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += char(n >> 18) + char(n >> 12) + char(n >> 6) + char(n);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += `${char(n >> 18)}${char(n >> 12)}==`;
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += `${char(n >> 18)}${char(n >> 12)}${char(n >> 6)}=`;
  }
  return out;
}

/** Decodes base64; returns `null` for malformed input instead of throwing. */
export function base64ToBytes(input: string): Uint8Array | null {
  if (input.length % 4 !== 0) return null;
  const padding = input.endsWith('==') ? 2 : input.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((input.length / 4) * 3 - padding);
  let o = 0;
  for (let i = 0; i < input.length; i += 4) {
    const isLast = i + 4 === input.length;
    const a = decodeChar(input, i);
    const b = decodeChar(input, i + 1);
    const c = isLast && padding === 2 ? 0 : decodeChar(input, i + 2);
    const d = isLast && padding >= 1 ? 0 : decodeChar(input, i + 3);
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (n >> 16) & 0xff;
    if (o < out.length) out[o++] = (n >> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}

function char(n: number): string {
  return ALPHABET[n & 63] ?? '';
}

function decodeChar(input: string, index: number): number {
  const code = input.charCodeAt(index);
  return code < 128 ? (LOOKUP[code] ?? -1) : -1;
}
