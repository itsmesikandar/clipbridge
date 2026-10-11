/**
 * Fuzz tests: garbage and mutated frames must never throw — decoders always
 * return a Result (docs/milestones/M7-diagnostics-and-hardening.md).
 */

import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from '../lib/base64';
import { SeededRandom } from '../testing/seeded-random';
import { decodeBody, decodeFrame, encodeBody, encodeFrame } from './codec';
import type { Body, PlainFrame } from './frames';
import { deriveSessionKeys } from './handshake';
import { SecureChannel } from './secure-channel';

const ITERATIONS = 3_000;
const random = new SeededRandom(2026);

function randomInt(max: number): number {
  const [a = 0, b = 0, c = 0] = random.randomBytes(3);
  return ((a << 16) | (b << 8) | c) % max;
}

const ALPHABET =
  '{}[]":,.-_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/= \\\u0000é\ud83d';

function randomString(maxLength: number): string {
  let out = '';
  const length = randomInt(maxLength);
  for (let i = 0; i < length; i++) out += ALPHABET.charAt(randomInt(ALPHABET.length));
  return out;
}

/** Changes, deletes or inserts a few characters. */
function mutate(input: string): string {
  let out = input;
  const edits = 1 + randomInt(4);
  for (let i = 0; i < edits; i++) {
    const at = randomInt(Math.max(1, out.length));
    const choice = randomInt(3);
    if (choice === 0) out = out.slice(0, at) + randomString(4) + out.slice(at + 1);
    else if (choice === 1) out = out.slice(0, at) + out.slice(at + 1 + randomInt(8));
    else out = out.slice(0, at) + randomString(6) + out.slice(at);
  }
  return out;
}

const validFrames: PlainFrame[] = [
  {
    v: 1,
    t: 'HELLO',
    deviceId: `dev_${'a'.repeat(32)}`,
    signPublicKey: bytesToBase64(new Uint8Array(32)),
    nonce: bytesToBase64(new Uint8Array(32)),
    epoch: 1,
    role: 'initiator',
  },
  {
    v: 1,
    t: 'AUTH',
    mac: bytesToBase64(new Uint8Array(32)),
    sig: bytesToBase64(new Uint8Array(64)),
  },
  { v: 1, t: 'PAIR_ERROR', code: 'PAIRING_EXPIRED', attemptsLeft: 0 },
  {
    v: 1,
    t: 'SEC',
    s: 3,
    n: bytesToBase64(new Uint8Array(24)),
    c: bytesToBase64(new Uint8Array(40)),
  },
];

const validBodies: Body[] = [
  { t: 'PING', ts: 1 },
  { t: 'HISTORY_REQ', since: 0 },
  {
    t: 'CLIP',
    clip: {
      id: '018bcfe5-6800-7000-8000-000000000001',
      origin: `dev_${'b'.repeat(32)}`,
      createdAt: 5,
      kind: 'text',
      text: 'hello',
    },
  },
  { t: 'CLIP_CHUNK', clipId: '018bcfe5-6800-7000-8000-000000000001', index: 0, data: 'AAAA' },
];

describe('fuzzing the decoders', () => {
  it('decodeFrame never throws on random input', () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const raw = randomString(200);
      expect(() => decodeFrame(raw)).not.toThrow();
    }
  });

  it('decodeFrame never throws on mutated valid frames', () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const frame = validFrames[i % validFrames.length];
      if (!frame) throw new Error('no frame');
      const result = decodeFrame(mutate(encodeFrame(frame)));
      expect(typeof result.ok).toBe('boolean');
    }
  });

  it('decodeBody never throws on mutated valid bodies', () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const body = validBodies[i % validBodies.length];
      if (!body) throw new Error('no body');
      const result = decodeBody(mutate(encodeBody(body)));
      expect(typeof result.ok).toBe('boolean');
    }
  });

  it('SecureChannel rejects random and tampered ciphertext without throwing', () => {
    const keys = deriveSessionKeys(random.randomBytes(32), random.randomBytes(32), 'responder');
    const sender = new SecureChannel(
      deriveSessionKeys(new Uint8Array(32), new Uint8Array(32), 'initiator'),
      random,
    );
    const receiver = new SecureChannel(keys, random);
    for (let i = 0; i < 500; i++) {
      const sealed = sender.seal({ t: 'PING', ts: i });
      const tampered = { ...sealed, c: mutate(sealed.c), s: i };
      expect(receiver.open(tampered).ok).toBe(false);
    }
  });
});
