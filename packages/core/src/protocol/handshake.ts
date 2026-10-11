/**
 * Mutual authentication of two group members (docs/PLAN.md §8.3).
 *
 *   initiator → HELLO(nonceA)          responder → HELLO(nonceB)
 *   both      → AUTH{ mac: HMAC(groupKey, transcript), sig: Ed25519(transcript) }
 *
 * The MAC proves group membership (holds the group key); the signature proves
 * the device identity listed in the signed member list. Both sides then derive
 * one key per direction from the group key and the transcript.
 */

import {
  deviceIdFromSignPublicKey,
  type IdentityKeyPair,
  sign,
  verifySignature,
} from '../crypto/identity';
import { hkdfSha256, hmacSha256, KEY_LENGTH, sha256 } from '../crypto/primitives';
import type { DeviceRecord } from '../domain/device';
import { type AppError, appError, type AuthFailureReason } from '../domain/errors';
import type { DeviceId } from '../domain/ids';
import { findMember, type Membership } from '../domain/membership';
import { err, ok, type Result } from '../domain/result';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import { concatBytes, constantTimeEqual, lengthPrefixed } from '../lib/bytes';
import { utf8Encode } from '../lib/utf8';
import type { RandomPort } from '../ports/random';
import type { AuthFrame, HandshakeRole, HelloFrame } from './frames';
import { PROTOCOL_VERSION } from './version';

export interface HandshakeCredentials {
  readonly deviceId: DeviceId;
  readonly identity: IdentityKeyPair;
  readonly groupKey: Uint8Array;
  readonly epoch: number;
}

export interface SessionKeys {
  readonly sendKey: Uint8Array;
  readonly receiveKey: Uint8Array;
}

const TRANSCRIPT_LABEL = utf8Encode('clipbridge/handshake/v1');
const MAC_LABEL = utf8Encode('clipbridge/auth-mac/v1');
const SIG_LABEL = utf8Encode('clipbridge/auth-sig/v1');
const SESSION_LABEL = utf8Encode('clipbridge/session/v1');

export function createHello(
  credentials: HandshakeCredentials,
  role: HandshakeRole,
  random: RandomPort,
): HelloFrame {
  return {
    v: PROTOCOL_VERSION,
    t: 'HELLO',
    deviceId: credentials.deviceId,
    signPublicKey: bytesToBase64(credentials.identity.signPublicKey),
    nonce: bytesToBase64(random.randomBytes(KEY_LENGTH)),
    epoch: credentials.epoch,
    role,
  };
}

/** Hash of both HELLO frames in a fixed order, so both sides compute the same bytes. */
export function handshakeTranscript(initiator: HelloFrame, responder: HelloFrame): Uint8Array {
  const fields = [initiator, responder].flatMap((hello) => [
    utf8Encode(hello.deviceId),
    utf8Encode(hello.signPublicKey),
    utf8Encode(hello.nonce),
    utf8Encode(String(hello.epoch)),
  ]);
  return sha256(concatBytes(TRANSCRIPT_LABEL, ...fields.map(lengthPrefixed)));
}

export function createAuth(
  credentials: HandshakeCredentials,
  role: HandshakeRole,
  transcript: Uint8Array,
): AuthFrame {
  return {
    v: PROTOCOL_VERSION,
    t: 'AUTH',
    mac: bytesToBase64(hmacSha256(credentials.groupKey, authMessage(MAC_LABEL, role, transcript))),
    sig: bytesToBase64(
      sign(authMessage(SIG_LABEL, role, transcript), credentials.identity.signSecretKey),
    ),
  };
}

export interface VerifyAuthInput {
  readonly groupKey: Uint8Array;
  readonly epoch: number;
  readonly membership: Membership;
  readonly transcript: Uint8Array;
  readonly peerHello: HelloFrame;
  readonly peerAuth: AuthFrame;
}

/** Verifies the peer's AUTH and returns its member record. */
export function verifyPeerAuth(
  input: VerifyAuthInput,
): Result<DeviceRecord, AppError<'AUTH_FAILED'>> {
  const { peerHello, peerAuth } = input;
  const fail = (reason: AuthFailureReason): Result<never, AppError<'AUTH_FAILED'>> =>
    err(
      appError('AUTH_FAILED', `peer authentication failed: ${reason}`, {
        peerId: peerHello.deviceId,
        reason,
      }),
    );

  if (peerHello.epoch !== input.epoch) return fail('epoch-mismatch');

  const signPublicKey = base64ToBytes(peerHello.signPublicKey);
  if (!signPublicKey || deviceIdFromSignPublicKey(signPublicKey) !== peerHello.deviceId) {
    return fail('key-mismatch');
  }

  const member = findMember(input.membership, peerHello.deviceId as DeviceId);
  if (!member) return fail('not-a-member');
  if (member.signPublicKey !== peerHello.signPublicKey) return fail('key-mismatch');

  const mac = base64ToBytes(peerAuth.mac);
  const expectedMac = hmacSha256(
    input.groupKey,
    authMessage(MAC_LABEL, peerHello.role, input.transcript),
  );
  if (!mac || !constantTimeEqual(mac, expectedMac)) return fail('bad-mac');

  const signature = base64ToBytes(peerAuth.sig);
  const signedMessage = authMessage(SIG_LABEL, peerHello.role, input.transcript);
  if (!signature || !verifySignature(signature, signedMessage, signPublicKey)) {
    return fail('bad-signature');
  }

  return ok(member);
}

/** One key per direction, so a frame can never be reflected back to its sender. */
export function deriveSessionKeys(
  groupKey: Uint8Array,
  transcript: Uint8Array,
  role: HandshakeRole,
): SessionKeys {
  const material = hkdfSha256(groupKey, transcript, SESSION_LABEL, KEY_LENGTH * 2);
  const initiatorToResponder = material.slice(0, KEY_LENGTH);
  const responderToInitiator = material.slice(KEY_LENGTH);
  return role === 'initiator'
    ? { sendKey: initiatorToResponder, receiveKey: responderToInitiator }
    : { sendKey: responderToInitiator, receiveKey: initiatorToResponder };
}

function authMessage(label: Uint8Array, role: HandshakeRole, transcript: Uint8Array): Uint8Array {
  return concatBytes(label, utf8Encode(role), transcript);
}
