/**
 * Runtime schemas for everything that crosses the network (docs/PLAN.md §7).
 *
 * Plain frames travel unencrypted and are only used for the handshake.
 * After the handshake every message is a `SEC` frame whose ciphertext holds a `Body`.
 */

import { z } from 'zod';

import { CLIP_LIMITS } from '../domain/clip';
import { DEVICE_NAME_MAX_LENGTH } from '../domain/device';
import { PROTOCOL_VERSION } from './version';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function base64(maxChars: number): z.ZodString {
  return z.string().max(maxChars).regex(BASE64);
}

/** Base64 characters needed for `bytes` bytes. */
function base64Chars(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

const key32 = base64(base64Chars(32)).length(base64Chars(32));
const signature64 = base64(base64Chars(64)).length(base64Chars(64));
const nonce24 = base64(base64Chars(24)).length(base64Chars(24));
const deviceId = z.string().regex(/^dev_[0-9a-f]{32}$/);
const clipId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const timestamp = z.number().int().min(0);
const version = z.literal(PROTOCOL_VERSION);

// ---------------------------------------------------------------- plain frames

export const helloFrameSchema = z.object({
  v: version,
  t: z.literal('HELLO'),
  deviceId,
  signPublicKey: key32,
  nonce: key32,
  epoch: z.number().int().min(1),
  role: z.enum(['initiator', 'responder']),
});

export const authFrameSchema = z.object({
  v: version,
  t: z.literal('AUTH'),
  mac: key32,
  sig: signature64,
});

export const ERROR_FRAME_CODES = [
  'VERSION_MISMATCH',
  'AUTH_FAILED',
  'PROTOCOL_ERROR',
  'REMOVED_FROM_GROUP',
] as const;

export const errorFrameSchema = z.object({
  v: version,
  t: z.literal('ERROR'),
  code: z.enum(ERROR_FRAME_CODES),
  message: z.string().max(500),
});

export const secureFrameSchema = z.object({
  v: version,
  t: z.literal('SEC'),
  /** Sequence number, strictly increasing per direction (replay protection). */
  s: z.number().int().min(0),
  n: nonce24,
  c: base64(Number.MAX_SAFE_INTEGER),
});

// ------------------------------------------------------------- pairing frames
// Plain JSON before the joiner is a member (docs/PLAN.md §8.2). Anything secret
// travels in `c`, encrypted with the pairing key.

export const pairHelloFrameSchema = z.object({
  v: version,
  t: z.literal('PAIR_HELLO'),
  method: z.enum(['code', 'qr']),
  ephPublicKey: key32,
  nonce: key32,
});

export const pairChallengeFrameSchema = z.object({
  v: version,
  t: z.literal('PAIR_CHALLENGE'),
  ephPublicKey: key32,
  nonce: key32,
  hostDeviceId: deviceId,
  hostSignPublicKey: key32,
});

export const pairProofFrameSchema = z.object({
  v: version,
  t: z.literal('PAIR_PROOF'),
  mac: key32,
  n: nonce24,
  c: base64(4096),
});

export const pairPendingFrameSchema = z.object({ v: version, t: z.literal('PAIR_PENDING') });

export const pairAcceptFrameSchema = z.object({
  v: version,
  t: z.literal('PAIR_ACCEPT'),
  mac: key32,
  n: nonce24,
  c: base64(256 * 1024),
});

export const PAIR_ERROR_CODES = [
  'PAIRING_EXPIRED',
  'PAIRING_REJECTED',
  'PAIRING_CODE_INVALID',
  'PROTOCOL_ERROR',
] as const;

export const pairErrorFrameSchema = z.object({
  v: version,
  t: z.literal('PAIR_ERROR'),
  code: z.enum(PAIR_ERROR_CODES),
  attemptsLeft: z.number().int().min(0),
});

export const plainFrameSchema = z.discriminatedUnion('t', [
  helloFrameSchema,
  authFrameSchema,
  errorFrameSchema,
  secureFrameSchema,
  pairHelloFrameSchema,
  pairChallengeFrameSchema,
  pairProofFrameSchema,
  pairPendingFrameSchema,
  pairAcceptFrameSchema,
  pairErrorFrameSchema,
]);

export type HelloFrame = z.infer<typeof helloFrameSchema>;
export type AuthFrame = z.infer<typeof authFrameSchema>;
export type ErrorFrame = z.infer<typeof errorFrameSchema>;
export type SecureFrame = z.infer<typeof secureFrameSchema>;
export type PlainFrame = z.infer<typeof plainFrameSchema>;
export type HandshakeRole = HelloFrame['role'];
export type PairHelloFrame = z.infer<typeof pairHelloFrameSchema>;
export type PairChallengeFrame = z.infer<typeof pairChallengeFrameSchema>;
export type PairProofFrame = z.infer<typeof pairProofFrameSchema>;
export type PairAcceptFrame = z.infer<typeof pairAcceptFrameSchema>;
export type PairErrorFrame = z.infer<typeof pairErrorFrameSchema>;
export type PairingMethod = PairHelloFrame['method'];

// ---------------------------------------------------------- encrypted bodies

const clipBase = {
  id: clipId,
  origin: deviceId,
  createdAt: timestamp,
};

export const wireClipSchema = z.discriminatedUnion('kind', [
  z.object({
    ...clipBase,
    kind: z.literal('text'),
    text: z.string().min(1).max(CLIP_LIMITS.textBytes),
  }),
  z.object({
    ...clipBase,
    kind: z.literal('url'),
    url: z.string().min(1).max(CLIP_LIMITS.urlChars),
  }),
  z.object({
    ...clipBase,
    kind: z.literal('image'),
    mime: z.enum(['image/png', 'image/jpeg']),
    data: base64(base64Chars(CLIP_LIMITS.imageBytes)).min(1),
  }),
]);

export const wireDeviceSchema = z.object({
  id: deviceId,
  name: z.string().min(1).max(DEVICE_NAME_MAX_LENGTH),
  platform: z.enum(['windows', 'macos', 'linux', 'android', 'ios']),
  signPublicKey: key32,
  boxPublicKey: key32,
  addedAt: timestamp,
});

export const MAX_GROUP_MEMBERS = 64;

export const wireMembershipSchema = z.object({
  groupId: z.string().min(1).max(64),
  version: z.number().int().min(1),
  members: z.array(wireDeviceSchema).min(1).max(MAX_GROUP_MEMBERS),
  updatedBy: deviceId,
  updatedAt: timestamp,
  signature: signature64,
});

export const MAX_HISTORY_CLIPS = 50;

/** Images travel in chunks of this many raw bytes (docs/milestones/M6-images.md). */
export const IMAGE_CHUNK_BYTES = 256 * 1024;
export const MAX_IMAGE_CHUNKS = Math.ceil(CLIP_LIMITS.imageBytes / IMAGE_CHUNK_BYTES);

/** Announces a chunked image: everything but the bytes, plus size, hash and chunk count. */
export const imageHeaderSchema = z.object({
  ...clipBase,
  kind: z.literal('image'),
  mime: z.enum(['image/png', 'image/jpeg']),
  size: z.number().int().min(1).max(CLIP_LIMITS.imageBytes),
  /** Content hash (see computeContentHash), checked after reassembly. */
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  chunks: z.number().int().min(1).max(MAX_IMAGE_CHUNKS),
});

export const sealedKeySchema = z.object({
  deviceId,
  /** Ephemeral X25519 public key of the sealed box. */
  e: key32,
  n: nonce24,
  c: base64(base64Chars(32 + 16)),
});

export const bodySchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('CLIP'), clip: wireClipSchema }),
  z.object({ t: z.literal('ACK'), clipId }),
  z.object({ t: z.literal('CLIP_START'), clip: imageHeaderSchema }),
  /** "I already have (or am receiving) this image, stop sending it." */
  z.object({ t: z.literal('CLIP_SKIP'), clipId }),
  z.object({
    t: z.literal('CLIP_CHUNK'),
    clipId,
    index: z
      .number()
      .int()
      .min(0)
      .max(MAX_IMAGE_CHUNKS - 1),
    data: base64(base64Chars(IMAGE_CHUNK_BYTES)).min(1),
  }),
  z.object({ t: z.literal('HISTORY_REQ'), since: timestamp }),
  z.object({
    t: z.literal('HISTORY_RES'),
    clips: z.array(wireClipSchema).max(MAX_HISTORY_CLIPS),
    /** The newest image, sent separately in chunks; lets the receiver skip older text. */
    newestImage: z.object({ createdAt: timestamp, origin: deviceId }).nullable(),
  }),
  z.object({ t: z.literal('MEMBERSHIP'), membership: wireMembershipSchema }),
  z.object({
    t: z.literal('KEY_ROTATE'),
    groupId: z.string().min(1).max(64),
    epoch: z.number().int().min(2),
    sealed: z.array(sealedKeySchema).min(1).max(MAX_GROUP_MEMBERS),
  }),
  z.object({ t: z.literal('PING'), ts: timestamp }),
  z.object({ t: z.literal('PONG'), ts: timestamp }),
]);

/** Encrypted inside PAIR_PROOF: who wants to join, signed with its identity key. */
export const pairingProofPayloadSchema = z.object({ device: wireDeviceSchema, sig: signature64 });

/** Encrypted inside PAIR_ACCEPT: everything the joiner needs to become a member. */
export const pairingAcceptPayloadSchema = z.object({
  groupId: z.string().min(1).max(64),
  groupKey: key32,
  epoch: z.number().int().min(1),
  membership: wireMembershipSchema,
});

export type SealedKey = z.infer<typeof sealedKeySchema>;
export type PairingProofPayload = z.infer<typeof pairingProofPayloadSchema>;
export type PairingAcceptPayload = z.infer<typeof pairingAcceptPayloadSchema>;
export type WireClip = z.infer<typeof wireClipSchema>;
export type ImageHeader = z.infer<typeof imageHeaderSchema>;
export type WireDevice = z.infer<typeof wireDeviceSchema>;
export type WireMembership = z.infer<typeof wireMembershipSchema>;
export type Body = z.infer<typeof bodySchema>;
export type BodyType = Body['t'];
