/**
 * Thin wrappers around audited @noble primitives, so the rest of core never
 * imports a crypto library directly.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

import type { RandomPort } from '../ports/random';

export const KEY_LENGTH = 32;
export const AEAD_NONCE_LENGTH = 24;
export const AEAD_TAG_LENGTH = 16;

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(nobleSha256, key, message);
}

export function hkdfSha256(
  inputKey: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  return hkdf(nobleSha256, inputKey, salt, info, length);
}

export interface SealedPayload {
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/** XChaCha20-Poly1305 encryption with a fresh random 24-byte nonce. */
export function aeadEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  associatedData: Uint8Array,
  random: RandomPort,
): SealedPayload {
  assertKey(key);
  const nonce = random.randomBytes(AEAD_NONCE_LENGTH);
  const ciphertext = xchacha20poly1305(key, nonce, associatedData).encrypt(plaintext);
  return { nonce, ciphertext };
}

/** Decrypts and authenticates; returns null if anything was tampered with. */
export function aeadDecrypt(
  key: Uint8Array,
  payload: SealedPayload,
  associatedData: Uint8Array,
): Uint8Array | null {
  assertKey(key);
  if (payload.nonce.length !== AEAD_NONCE_LENGTH) return null;
  if (payload.ciphertext.length < AEAD_TAG_LENGTH) return null;
  try {
    return xchacha20poly1305(key, payload.nonce, associatedData).decrypt(payload.ciphertext);
  } catch {
    return null;
  }
}

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_LENGTH) throw new Error(`Expected a ${KEY_LENGTH}-byte key`);
}
