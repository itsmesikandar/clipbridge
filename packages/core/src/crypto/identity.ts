import { ed25519, x25519 } from '@noble/curves/ed25519.js';

import { type DeviceId, deviceIdFromDigest } from '../domain/ids';
import type { RandomPort } from '../ports/random';
import { KEY_LENGTH, sha256 } from './primitives';

/** Long-term keys of one device. Secret halves never leave secure storage. */
export interface IdentityKeyPair {
  readonly signSecretKey: Uint8Array;
  readonly signPublicKey: Uint8Array;
  readonly boxSecretKey: Uint8Array;
  readonly boxPublicKey: Uint8Array;
}

export const SIGNATURE_LENGTH = 64;

export function generateIdentity(random: RandomPort): IdentityKeyPair {
  return identityFromSeeds(random.randomBytes(KEY_LENGTH), random.randomBytes(KEY_LENGTH));
}

/** Rebuilds the key pair from stored secret keys. */
export function identityFromSeeds(
  signSecretKey: Uint8Array,
  boxSecretKey: Uint8Array,
): IdentityKeyPair {
  if (signSecretKey.length !== KEY_LENGTH || boxSecretKey.length !== KEY_LENGTH) {
    throw new Error('Identity secret keys must be 32 bytes');
  }
  return {
    signSecretKey,
    signPublicKey: ed25519.getPublicKey(signSecretKey),
    boxSecretKey,
    boxPublicKey: x25519.getPublicKey(boxSecretKey),
  };
}

/** Device id = `dev_` + first 16 bytes (hex) of SHA-256 over the signing public key. */
export function deviceIdFromSignPublicKey(signPublicKey: Uint8Array): DeviceId {
  return deviceIdFromDigest(sha256(signPublicKey));
}

export function sign(message: Uint8Array, signSecretKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, signSecretKey);
}

export function verifySignature(
  signature: Uint8Array,
  message: Uint8Array,
  signPublicKey: Uint8Array,
): boolean {
  if (signature.length !== SIGNATURE_LENGTH || signPublicKey.length !== KEY_LENGTH) return false;
  try {
    return ed25519.verify(signature, message, signPublicKey);
  } catch {
    return false;
  }
}

/** X25519 Diffie-Hellman. Throws for invalid (low-order) public keys. */
export function sharedSecret(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(secretKey, publicKey);
}

export function boxPublicKeyOf(boxSecretKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(boxSecretKey);
}
