import { describe, expect, it } from 'vitest';

import { bytesToHex, hexToBytes } from '../lib/bytes';
import { utf8Encode } from '../lib/utf8';
import { SeededRandom } from '../testing/seeded-random';
import { computeContentHash } from './content-hash';
import { generateGroupId, generateGroupKey, groupTag } from './group-key';
import {
  deviceIdFromSignPublicKey,
  generateIdentity,
  identityFromSeeds,
  sharedSecret,
  sign,
  verifySignature,
} from './identity';
import { aeadDecrypt, aeadEncrypt, hmacSha256, sha256 } from './primitives';
import { openSealed, sealTo } from './sealed-box';

const random = new SeededRandom(7);

describe('known-answer tests', () => {
  it('SHA-256 of "abc" (FIPS 180-2)', () => {
    expect(bytesToHex(sha256(utf8Encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('HMAC-SHA256 (RFC 4231 test case 2)', () => {
    expect(
      bytesToHex(hmacSha256(utf8Encode('Jefe'), utf8Encode('what do ya want for nothing?'))),
    ).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('Ed25519 public key and signature (RFC 8032 test 1)', () => {
    const secret = hexToBytes('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
    const identity = identityFromSeeds(secret, new Uint8Array(32).fill(1));
    expect(bytesToHex(identity.signPublicKey)).toBe(
      'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    );
    expect(bytesToHex(sign(new Uint8Array(0), secret))).toBe(
      'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
    );
  });

  it('X25519 key agreement (RFC 7748 §6.1)', () => {
    const alice = hexToBytes('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
    const bob = hexToBytes('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
    const aliceIdentity = identityFromSeeds(new Uint8Array(32).fill(1), alice);
    const bobIdentity = identityFromSeeds(new Uint8Array(32).fill(1), bob);
    expect(bytesToHex(aliceIdentity.boxPublicKey)).toBe(
      '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a',
    );
    expect(bytesToHex(bobIdentity.boxPublicKey)).toBe(
      'de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f',
    );
    const expected = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
    expect(bytesToHex(sharedSecret(alice, bobIdentity.boxPublicKey))).toBe(expected);
    expect(bytesToHex(sharedSecret(bob, aliceIdentity.boxPublicKey))).toBe(expected);
  });
});

describe('AEAD', () => {
  const key = random.randomBytes(32);
  const aad = utf8Encode('header');
  const message = utf8Encode('secret clip');

  it('round-trips', () => {
    const sealed = aeadEncrypt(key, message, aad, random);
    expect(aeadDecrypt(key, sealed, aad)).toEqual(message);
  });

  it('uses a fresh nonce each time', () => {
    const a = aeadEncrypt(key, message, aad, random);
    const b = aeadEncrypt(key, message, aad, random);
    expect(a.nonce).not.toEqual(b.nonce);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it('detects tampering with ciphertext, nonce, associated data or key', () => {
    const sealed = aeadEncrypt(key, message, aad, random);
    const flipped = sealed.ciphertext.slice();
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const otherNonce = sealed.nonce.slice();
    otherNonce[0] = (otherNonce[0] ?? 0) ^ 1;
    expect(aeadDecrypt(key, { ...sealed, ciphertext: flipped }, aad)).toBeNull();
    expect(aeadDecrypt(key, { ...sealed, nonce: otherNonce }, aad)).toBeNull();
    expect(aeadDecrypt(key, sealed, utf8Encode('other'))).toBeNull();
    expect(aeadDecrypt(random.randomBytes(32), sealed, aad)).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    expect(
      aeadDecrypt(key, { nonce: new Uint8Array(3), ciphertext: new Uint8Array(32) }, aad),
    ).toBeNull();
    expect(
      aeadDecrypt(key, { nonce: new Uint8Array(24), ciphertext: new Uint8Array(3) }, aad),
    ).toBeNull();
  });

  it('refuses keys of the wrong length', () => {
    expect(() => aeadEncrypt(new Uint8Array(16), message, aad, random)).toThrow();
  });
});

describe('identity', () => {
  it('signs and verifies; rejects other keys and messages', () => {
    const identity = generateIdentity(random);
    const other = generateIdentity(random);
    const message = utf8Encode('hello');
    const signature = sign(message, identity.signSecretKey);
    expect(verifySignature(signature, message, identity.signPublicKey)).toBe(true);
    expect(verifySignature(signature, utf8Encode('hellO'), identity.signPublicKey)).toBe(false);
    expect(verifySignature(signature, message, other.signPublicKey)).toBe(false);
    expect(verifySignature(new Uint8Array(10), message, identity.signPublicKey)).toBe(false);
  });

  it('derives a stable device id from the public key', () => {
    const identity = generateIdentity(random);
    const restored = identityFromSeeds(identity.signSecretKey, identity.boxSecretKey);
    expect(deviceIdFromSignPublicKey(restored.signPublicKey)).toBe(
      deviceIdFromSignPublicKey(identity.signPublicKey),
    );
    expect(() => identityFromSeeds(new Uint8Array(31), new Uint8Array(32))).toThrow();
  });
});

describe('sealed box', () => {
  it('only the recipient can open it', () => {
    const recipient = generateIdentity(random);
    const stranger = generateIdentity(random);
    const secret = utf8Encode('new group key');
    const box = sealTo(recipient.boxPublicKey, secret, random);
    expect(openSealed(recipient.boxSecretKey, box)).toEqual(secret);
    expect(openSealed(stranger.boxSecretKey, box)).toBeNull();
  });

  it('rejects modified boxes', () => {
    const recipient = generateIdentity(random);
    const box = sealTo(recipient.boxPublicKey, utf8Encode('x'), random);
    const ephemeral = box.ephemeralPublicKey.slice();
    ephemeral[5] = (ephemeral[5] ?? 0) ^ 1;
    expect(
      openSealed(recipient.boxSecretKey, { ...box, ephemeralPublicKey: ephemeral }),
    ).toBeNull();
    expect(
      openSealed(recipient.boxSecretKey, { ...box, ephemeralPublicKey: new Uint8Array(3) }),
    ).toBeNull();
  });
});

describe('group key and content hash', () => {
  it('derives a short public tag per group id', () => {
    expect(generateGroupKey(random)).toHaveLength(32);
    const a = generateGroupId(random);
    const b = generateGroupId(random);
    expect(a).toMatch(/^grp_[0-9a-f]{16}$/);
    expect(groupTag(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(groupTag(a)).toBe(groupTag(a));
    expect(groupTag(a)).not.toBe(groupTag(b));
  });

  it('hashes the kind together with the payload', () => {
    const text = computeContentHash({ kind: 'text', text: 'https://a.b' });
    const url = computeContentHash({ kind: 'url', url: 'https://a.b' });
    expect(text).not.toBe(url);
    expect(computeContentHash({ kind: 'text', text: 'x' })).toBe(
      computeContentHash({ kind: 'text', text: 'x' }),
    );
  });
});
