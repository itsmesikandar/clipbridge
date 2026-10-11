import { concatBytes } from '../lib/bytes';
import { utf8Encode } from '../lib/utf8';
import type { RandomPort } from '../ports/random';
import { boxPublicKeyOf, sharedSecret } from './identity';
import { aeadDecrypt, aeadEncrypt, hkdfSha256, KEY_LENGTH, type SealedPayload } from './primitives';

/** A secret encrypted to one device's X25519 public key (anonymous sender). */
export interface SealedBox extends SealedPayload {
  readonly ephemeralPublicKey: Uint8Array;
}

const INFO = utf8Encode('clipbridge/sealed-box/v1');

export function sealTo(
  recipientBoxPublicKey: Uint8Array,
  plaintext: Uint8Array,
  random: RandomPort,
): SealedBox {
  const ephemeralSecret = random.randomBytes(KEY_LENGTH);
  const { ephemeralPublicKey, key } = deriveSenderKey(ephemeralSecret, recipientBoxPublicKey);
  const sealed = aeadEncrypt(key, plaintext, ephemeralPublicKey, random);
  return { ephemeralPublicKey, ...sealed };
}

/** Opens a sealed box; returns null if it was not sealed to this key or was modified. */
export function openSealed(boxSecretKey: Uint8Array, box: SealedBox): Uint8Array | null {
  if (box.ephemeralPublicKey.length !== KEY_LENGTH) return null;
  let shared: Uint8Array;
  try {
    shared = sharedSecret(boxSecretKey, box.ephemeralPublicKey);
  } catch {
    return null;
  }
  const recipientPublicKey = boxPublicKeyOf(boxSecretKey);
  const key = hkdfSha256(
    shared,
    concatBytes(box.ephemeralPublicKey, recipientPublicKey),
    INFO,
    KEY_LENGTH,
  );
  return aeadDecrypt(key, box, box.ephemeralPublicKey);
}

function deriveSenderKey(
  ephemeralSecret: Uint8Array,
  recipientBoxPublicKey: Uint8Array,
): { ephemeralPublicKey: Uint8Array; key: Uint8Array } {
  const ephemeralPublicKey = boxPublicKeyOf(ephemeralSecret);
  const shared = sharedSecret(ephemeralSecret, recipientBoxPublicKey);
  const key = hkdfSha256(
    shared,
    concatBytes(ephemeralPublicKey, recipientBoxPublicKey),
    INFO,
    KEY_LENGTH,
  );
  return { ephemeralPublicKey, key };
}
