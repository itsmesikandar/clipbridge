import { bytesToHex } from '../lib/bytes';

declare const deviceIdBrand: unique symbol;
declare const clipIdBrand: unique symbol;

/** Stable device identifier derived from the device's signing public key. */
export type DeviceId = string & { readonly [deviceIdBrand]: true };

/** Time-ordered clip identifier (UUIDv7). */
export type ClipId = string & { readonly [clipIdBrand]: true };

const DEVICE_ID_PATTERN = /^dev_[0-9a-f]{32}$/;
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isDeviceId(value: string): value is DeviceId {
  return DEVICE_ID_PATTERN.test(value);
}

export function isClipId(value: string): value is ClipId {
  return UUID_V7_PATTERN.test(value);
}

/** Builds a device id from the first 16 bytes of a hash of the device's public key. */
export function deviceIdFromDigest(digest: Uint8Array): DeviceId {
  if (digest.length < 16) throw new Error('deviceIdFromDigest: digest too short');
  return `dev_${bytesToHex(digest.subarray(0, 16))}` as DeviceId;
}

/**
 * Creates a UUIDv7 (RFC 9562): 48-bit Unix ms timestamp, version, 74 random bits.
 * @param random at least 10 random bytes
 */
export function createClipId(unixMs: number, random: Uint8Array): ClipId {
  if (random.length < 10) throw new Error('createClipId: need 10 random bytes');
  const bytes = new Uint8Array(16);
  let time = Math.max(0, Math.floor(unixMs));
  for (let i = 5; i >= 0; i--) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = 0x70 | ((random[0] ?? 0) & 0x0f);
  bytes[7] = random[1] ?? 0;
  bytes[8] = 0x80 | ((random[2] ?? 0) & 0x3f);
  bytes.set(random.subarray(3, 10), 9);
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as ClipId;
}
