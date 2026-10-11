import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from '../lib/base64';
import { SeededRandom } from '../testing/seeded-random';
import {
  buildPairingLink,
  formatPairingCode,
  generatePairingCode,
  normalizePairingCode,
  PAIRING_CODE_LENGTH,
  pairingMac,
  pairingSecret,
  parsePairingLink,
} from './pairing';

const random = new SeededRandom(5);

describe('pairing code', () => {
  it('generates 12 Crockford base32 characters', () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePairingCode(random);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
      expect(normalizePairingCode(code)).toBe(code);
    }
    expect(generatePairingCode(random)).not.toBe(generatePairingCode(random));
  });

  it('formats in groups of four', () => {
    expect(formatPairingCode('K7QM2XPA9FRT')).toBe('K7QM-2XPA-9FRT');
  });

  it.each([
    ['k7qm-2xpa-9frt', 'K7QM2XPA9FRT'],
    ['K7QM 2XPA 9FRT', 'K7QM2XPA9FRT'],
    ['OOOO-IIII-LLLL', '000011111111'],
  ])('normalizes %j', (input, expected) => {
    expect(normalizePairingCode(input)).toBe(expected);
  });

  it.each(['K7QM-2XPA', 'K7QM-2XPA-9FRT-1', 'K7QM-2XPA-9FRU', ''])('rejects %j', (input) => {
    expect(normalizePairingCode(input)).toBeNull();
  });

  it('has 60 bits of entropy', () => {
    expect(PAIRING_CODE_LENGTH * 5).toBe(60);
  });
});

describe('pairing link (QR)', () => {
  const link = {
    hosts: ['192.168.1.7', '10.0.0.5'],
    port: 47821,
    token: random.randomBytes(32),
    hostSignPublicKey: bytesToBase64(random.randomBytes(32)),
  };

  it('round-trips through build and parse', () => {
    const text = buildPairingLink(link);
    expect(text.startsWith('clipbridge://pair?v=1&')).toBe(true);
    // Token and key are base64url: safe in a URL without escaping.
    expect(text).toMatch(/&t=[A-Za-z0-9_-]+&k=[A-Za-z0-9_-]+$/);
    expect(parsePairingLink(text)).toEqual(link);
  });

  it.each([
    'https://example.com',
    'clipbridge://pair?v=2&h=1.2.3.4&p=1&t=AA&k=AA',
    'clipbridge://pair?v=1&h=not-an-ip&p=47821&t=AA&k=AA',
    buildPairingLink(link).replace('p=47821', 'p=99999'),
    buildPairingLink(link).replace(/t=[^&]+/, 't=short'),
  ])('rejects %s', (text) => {
    expect(parsePairingLink(text)).toBeNull();
  });
});

describe('pairing secrets and MACs', () => {
  it('uses the code text or the QR token', () => {
    expect(pairingSecret('code', 'ABC')).toEqual(new Uint8Array([65, 66, 67]));
    const token = random.randomBytes(32);
    expect(pairingSecret('qr', token)).toBe(token);
    expect(() => pairingSecret('qr', 'ABC')).toThrow();
    expect(() => pairingSecret('code', token)).toThrow();
  });

  it('binds the MAC to role and transcript', () => {
    const secret = pairingSecret('code', 'K7QM2XPA9FRT');
    const transcript = random.randomBytes(32);
    const joiner = pairingMac(secret, 'joiner', transcript);
    expect(pairingMac(secret, 'joiner', transcript)).toEqual(joiner);
    expect(pairingMac(secret, 'host', transcript)).not.toEqual(joiner);
    expect(pairingMac(secret, 'joiner', random.randomBytes(32))).not.toEqual(joiner);
  });
});
