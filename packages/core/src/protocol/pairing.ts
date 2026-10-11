/**
 * Pairing cryptography and formats (docs/PLAN.md §8.2). Pure functions.
 *
 *   joiner → PAIR_HELLO     { method, ephemeral X25519 key, nonce }
 *   host   → PAIR_CHALLENGE { ephemeral key, nonce, host id + signing key }
 *   joiner → PAIR_PROOF     { HMAC(secret, "joiner" ‖ transcript), sealed { device record, signature } }
 *   host   → PAIR_PENDING   (waiting for the user to click Allow)
 *   host   → PAIR_ACCEPT    { HMAC(secret, "host" ‖ transcript), sealed { group id, key, epoch, member list } }
 *
 * The secret is the 12-character code typed by the user or the 32-byte token
 * from the QR code. It is mixed into the encryption key, so only someone who
 * knows it can read the group key.
 */

import { hkdfSha256, hmacSha256, KEY_LENGTH, sha256 } from '../crypto/primitives';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import { concatBytes, lengthPrefixed } from '../lib/bytes';
import { utf8Encode } from '../lib/utf8';
import type { RandomPort } from '../ports/random';
import type { PairChallengeFrame, PairHelloFrame, PairingMethod } from './frames';

// ------------------------------------------------------------------ pairing code

/** Crockford base32: no I, L, O, U, so codes are easy to read aloud and type. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 12;

/** 12 random characters (60 bits), e.g. `K7QM2XPA9FRT`. */
export function generatePairingCode(random: RandomPort): string {
  const bytes = random.randomBytes(PAIRING_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += CROCKFORD[byte & 31] ?? '0';
  return code;
}

/** `K7QM2XPA9FRT` → `K7QM-2XPA-9FRT`. */
export function formatPairingCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/**
 * Accepts what users type: any case, spaces or dashes, and the usual
 * look-alikes (O → 0, I/L → 1). Returns null if it cannot be a valid code.
 */
export function normalizePairingCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (cleaned.length !== PAIRING_CODE_LENGTH) return null;
  for (const char of cleaned) if (!CROCKFORD.includes(char)) return null;
  return cleaned;
}

// ------------------------------------------------------------------ QR link

export interface PairingLink {
  readonly hosts: readonly string[];
  readonly port: number;
  /** 32-byte one-time secret. */
  readonly token: Uint8Array;
  /** Host's Ed25519 public key (base64); the joiner checks it during pairing. */
  readonly hostSignPublicKey: string;
}

const LINK_PREFIX = 'clipbridge://pair?';

/** `clipbridge://pair?v=1&h=192.168.1.7,10.0.0.5&p=47821&t=…&k=…` (base64url values). */
export function buildPairingLink(link: PairingLink): string {
  const params = [
    'v=1',
    `h=${link.hosts.join(',')}`,
    `p=${link.port}`,
    `t=${toBase64Url(bytesToBase64(link.token))}`,
    `k=${toBase64Url(link.hostSignPublicKey)}`,
  ];
  return `${LINK_PREFIX}${params.join('&')}`;
}

/** Parses a scanned QR code; null if it is not a valid ClipBridge pairing link. */
export function parsePairingLink(text: string): PairingLink | null {
  if (!text.startsWith(LINK_PREFIX)) return null;
  const params = new Map<string, string>();
  for (const pair of text.slice(LINK_PREFIX.length).split('&')) {
    const index = pair.indexOf('=');
    if (index > 0) params.set(pair.slice(0, index), pair.slice(index + 1));
  }
  if (params.get('v') !== '1') return null;

  const hosts = (params.get('h') ?? '')
    .split(',')
    .filter((host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host));
  const port = Number(params.get('p'));
  const token = base64ToBytes(fromBase64Url(params.get('t') ?? ''));
  const hostSignPublicKey = fromBase64Url(params.get('k') ?? '');
  if (hosts.length === 0 || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (token?.length !== KEY_LENGTH || base64ToBytes(hostSignPublicKey)?.length !== KEY_LENGTH)
    return null;
  return { hosts, port, token, hostSignPublicKey };
}

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64 + '='.repeat((4 - (base64.length % 4)) % 4);
}

// ------------------------------------------------------------------ key schedule

const TRANSCRIPT_LABEL = utf8Encode('clipbridge/pairing/v1');
const KEY_INFO = utf8Encode('clipbridge/pairing-key/v1');

/** The shared secret as bytes: the normalized code, or the QR token. */
export function pairingSecret(method: PairingMethod, codeOrToken: string | Uint8Array): Uint8Array {
  if (method === 'qr') {
    if (typeof codeOrToken === 'string') throw new Error('QR pairing needs the token bytes');
    return codeOrToken;
  }
  if (typeof codeOrToken !== 'string') throw new Error('Code pairing needs the code');
  return utf8Encode(codeOrToken);
}

export function pairingTranscript(
  hello: PairHelloFrame,
  challenge: PairChallengeFrame,
): Uint8Array {
  const fields = [
    hello.method,
    hello.ephPublicKey,
    hello.nonce,
    challenge.ephPublicKey,
    challenge.nonce,
    challenge.hostDeviceId,
    challenge.hostSignPublicKey,
  ].map((field) => lengthPrefixed(utf8Encode(field)));
  return sha256(concatBytes(TRANSCRIPT_LABEL, ...fields));
}

/** Encryption key for the pairing payloads: needs both the DH secret and the code/token. */
export function pairingKey(
  sharedSecret: Uint8Array,
  secret: Uint8Array,
  transcript: Uint8Array,
): Uint8Array {
  return hkdfSha256(concatBytes(sharedSecret, secret), transcript, KEY_INFO, KEY_LENGTH);
}

export type PairingRole = 'joiner' | 'host';

/** Proof that the sender knows the code/token, bound to this exchange. */
export function pairingMac(
  secret: Uint8Array,
  role: PairingRole,
  transcript: Uint8Array,
): Uint8Array {
  return hmacSha256(secret, concatBytes(utf8Encode(`clipbridge/pairing-mac/${role}`), transcript));
}

/** Associated data for the sealed payload of each frame type. */
export function pairingPayloadLabel(frame: 'PAIR_PROOF' | 'PAIR_ACCEPT'): Uint8Array {
  return utf8Encode(`clipbridge/pairing/${frame}`);
}

/** What the joiner signs with its identity key: proves it owns the device record it sends. */
export function joinerSignatureMessage(transcript: Uint8Array): Uint8Array {
  return concatBytes(utf8Encode('clipbridge/pairing-joiner-sig/v1'), transcript);
}
