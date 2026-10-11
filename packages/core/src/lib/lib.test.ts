import { describe, expect, it } from 'vitest';

import { base64ToBytes, bytesToBase64 } from './base64';
import { bytesToHex, concatBytes, constantTimeEqual, hexToBytes, lengthPrefixed } from './bytes';
import { canonicalJson } from './canonical-json';
import { utf8Decode, utf8Encode, utf8Length } from './utf8';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('base64', () => {
  // RFC 4648 §10 test vectors.
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ])('encodes %j as %j and back', (plain, encoded) => {
    expect(bytesToBase64(utf8Encode(plain))).toBe(encoded);
    expect(utf8Decode(base64ToBytes(encoded) ?? bytes())).toBe(plain);
  });

  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all);
  });

  it.each(['abc', 'ab=c', '@@@@', 'Zm9vé==='])('rejects malformed input %j', (input) => {
    expect(base64ToBytes(input)).toBeNull();
  });
});

describe('utf8', () => {
  it.each(['hello', 'नमस्ते', 'emoji 🚀📋', 'mixed: aé中🙂'])('round-trips %j', (text) => {
    const encoded = utf8Encode(text);
    expect(utf8Decode(encoded)).toBe(text);
    expect(utf8Length(text)).toBe(encoded.length);
  });

  it('encodes multi-byte characters correctly', () => {
    expect(utf8Encode('é')).toEqual(bytes(0xc3, 0xa9));
    expect(utf8Encode('€')).toEqual(bytes(0xe2, 0x82, 0xac));
    expect(utf8Encode('🙂')).toEqual(bytes(0xf0, 0x9f, 0x99, 0x82));
  });

  it('replaces lone surrogates and invalid bytes with U+FFFD', () => {
    expect(utf8Decode(utf8Encode('\ud800'))).toBe('�');
    expect(utf8Length('\ud800')).toBe(3);
    expect(utf8Decode(bytes(0xff, 0x41))).toBe('�A');
    expect(utf8Decode(bytes(0xc3))).toBe('�');
    expect(utf8Decode(bytes(0xed, 0xa0, 0x80))).toBe('���'); // encoded surrogate
  });
});

describe('bytes', () => {
  it('concatenates', () => {
    expect(concatBytes(bytes(1), bytes(), bytes(2, 3))).toEqual(bytes(1, 2, 3));
  });

  it('compares in constant time', () => {
    expect(constantTimeEqual(bytes(1, 2), bytes(1, 2))).toBe(true);
    expect(constantTimeEqual(bytes(1, 2), bytes(1, 3))).toBe(false);
    expect(constantTimeEqual(bytes(1), bytes(1, 2))).toBe(false);
  });

  it('converts hex both ways and rejects bad hex', () => {
    expect(bytesToHex(bytes(0, 0xab, 0xff))).toBe('00abff');
    expect(hexToBytes('00abff')).toEqual(bytes(0, 0xab, 0xff));
    expect(() => hexToBytes('abc')).toThrow();
    expect(() => hexToBytes('zz')).toThrow();
  });

  it('length-prefixes fields big-endian', () => {
    expect(lengthPrefixed(bytes(9, 9))).toEqual(bytes(0, 0, 0, 2, 9, 9));
  });
});

describe('canonicalJson', () => {
  it('sorts keys recursively and has no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [{ d: true, c: null }], e: 'x' })).toBe(
      '{"a":[{"c":null,"d":true}],"b":1,"e":"x"}',
    );
  });

  it('gives the same output regardless of key insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
  });
});
