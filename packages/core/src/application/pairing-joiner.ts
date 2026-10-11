/**
 * Joiner side of pairing: a new device connects to a host that shows a code or
 * QR, proves it knows the secret, waits for the user's approval and receives
 * the group (docs/PLAN.md §8.2).
 */

import {
  boxPublicKeyOf,
  deviceIdFromSignPublicKey,
  type IdentityKeyPair,
  sharedSecret,
  sign,
} from '../crypto/identity';
import { aeadDecrypt, aeadEncrypt, KEY_LENGTH } from '../crypto/primitives';
import type { DeviceRecord } from '../domain/device';
import { type AppError, appError } from '../domain/errors';
import { findMember, type Membership } from '../domain/membership';
import { err, ok, type Result } from '../domain/result';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import { constantTimeEqual } from '../lib/bytes';
import { utf8Decode, utf8Encode } from '../lib/utf8';
import type { ClockPort } from '../ports/clock';
import type { LoggerPort } from '../ports/logger';
import type { RandomPort } from '../ports/random';
import type { PeerAddress, TransportConnection, TransportPort } from '../ports/transport';
import { decodeFrame, encodeFrame } from '../protocol/codec';
import {
  type PairAcceptFrame,
  type PairChallengeFrame,
  type PairErrorFrame,
  type PairHelloFrame,
  pairingAcceptPayloadSchema,
  type PairingMethod,
} from '../protocol/frames';
import {
  joinerSignatureMessage,
  pairingKey,
  pairingMac,
  pairingPayloadLabel,
  pairingTranscript,
} from '../protocol/pairing';
import { PROTOCOL_VERSION } from '../protocol/version';
import { deviceToWire, membershipFromWire } from '../protocol/wire';
import { isMembershipSignedByTrustedMember } from './membership-service';
import { PAIRING_TIMING } from './pairing-host';
import { createStore, type ReadonlyStore } from './store';

export type JoinState =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'verifying' }
  | { readonly kind: 'awaiting-approval' }
  | { readonly kind: 'joined' }
  | { readonly kind: 'failed'; readonly error: AppError };

export interface JoinedGroup {
  readonly groupId: string;
  readonly groupKey: Uint8Array;
  readonly epoch: number;
  readonly membership: Membership;
}

export interface JoinOptions {
  readonly self: { readonly device: DeviceRecord; readonly identity: IdentityKeyPair };
  readonly addresses: readonly PeerAddress[];
  readonly method: PairingMethod;
  /** Normalized code bytes or QR token (see `pairingSecret`). */
  readonly secret: Uint8Array;
  /** From the QR code: the host must present exactly this key. */
  readonly expectedHostSignPublicKey?: string;
}

export interface JoinDeps {
  readonly transport: TransportPort;
  readonly clock: ClockPort;
  readonly random: RandomPort;
  readonly logger: LoggerPort;
}

export interface JoinAttempt {
  readonly state: ReadonlyStore<JoinState>;
  readonly result: Promise<Result<JoinedGroup, AppError>>;
  cancel(): void;
}

const DIAL_TIMEOUT_MS = 5_000;

export function joinGroup(options: JoinOptions, deps: JoinDeps): JoinAttempt {
  const state = createStore<JoinState>({ kind: 'connecting' });
  let connection: TransportConnection | null = null;
  let cancelled = false;
  let settle: (result: Result<JoinedGroup, AppError>) => void = () => undefined;

  const result = new Promise<Result<JoinedGroup, AppError>>((resolve) => {
    const cancelTimeout = deps.clock.schedule(PAIRING_TIMING.durationMs + 10_000, () => {
      finish(err(appError('PAIRING_EXPIRED', 'no answer from the host', {})));
    });
    const finish = (outcome: Result<JoinedGroup, AppError>): void => {
      if (state.get().kind === 'joined' || state.get().kind === 'failed') return;
      cancelTimeout();
      state.set(outcome.ok ? { kind: 'joined' } : { kind: 'failed', error: outcome.error });
      connection?.close(outcome.ok ? 'joined' : outcome.error.code);
      resolve(outcome);
    };
    settle = finish;

    void connect(options.addresses, deps).then((dialed) => {
      if (cancelled) {
        if (dialed.ok) dialed.value.close('cancelled');
        return;
      }
      if (!dialed.ok) {
        finish(dialed);
        return;
      }
      connection = dialed.value;
      runProtocol(dialed.value, options, deps, state, finish);
    });
  });

  return {
    state,
    result,
    cancel: () => {
      cancelled = true;
      settle(err(appError('PAIRING_EXPIRED', 'cancelled by the user', {})));
    },
  };
}

async function connect(
  addresses: readonly PeerAddress[],
  deps: JoinDeps,
): Promise<Result<TransportConnection, AppError>> {
  let lastError: AppError = appError('PEER_UNREACHABLE', 'no address to try', {
    peerId: null,
    peerName: null,
    address: null,
    cause: 'unreachable',
  });
  for (const address of addresses) {
    const dialed = await deps.transport.dial(address, DIAL_TIMEOUT_MS);
    if (dialed.ok) return dialed;
    lastError = dialed.error;
  }
  return err(lastError);
}

function runProtocol(
  connection: TransportConnection,
  options: JoinOptions,
  deps: JoinDeps,
  state: ReturnType<typeof createStore<JoinState>>,
  finish: (outcome: Result<JoinedGroup, AppError>) => void,
): void {
  const ephemeralSecret = deps.random.randomBytes(KEY_LENGTH);
  const hello: PairHelloFrame = {
    v: PROTOCOL_VERSION,
    t: 'PAIR_HELLO',
    method: options.method,
    ephPublicKey: bytesToBase64(boxPublicKeyOf(ephemeralSecret)),
    nonce: bytesToBase64(deps.random.randomBytes(KEY_LENGTH)),
  };
  let exchange: { challenge: PairChallengeFrame; key: Uint8Array; transcript: Uint8Array } | null =
    null;
  const protocolError = (reason: string): void => {
    finish(err(appError('PROTOCOL_ERROR', reason, { reason })));
  };

  connection.onClose(() => {
    finish(
      err(
        appError('CONNECTION_LOST', 'host closed the connection', {
          peerId: null,
          reason: 'closed',
        }),
      ),
    );
  });

  connection.onMessage((raw) => {
    const decoded = decodeFrame(raw);
    if (!decoded.ok) {
      finish(err(decoded.error));
      return;
    }
    const frame = decoded.value;
    switch (frame.t) {
      case 'PAIR_ERROR':
        finish(err(errorFromHost(frame)));
        return;
      case 'PAIR_CHALLENGE': {
        if (exchange) {
          protocolError('duplicate challenge');
          return;
        }
        const checked = checkChallenge(frame, options);
        if (checked) {
          protocolError(checked);
          return;
        }
        let shared: Uint8Array;
        try {
          shared = sharedSecret(
            ephemeralSecret,
            base64ToBytes(frame.ephPublicKey) ?? new Uint8Array(0),
          );
        } catch {
          protocolError('invalid host key');
          return;
        }
        const transcript = pairingTranscript(hello, frame);
        const key = pairingKey(shared, options.secret, transcript);
        exchange = { challenge: frame, key, transcript };
        const payload = {
          device: deviceToWire(options.self.device),
          sig: bytesToBase64(
            sign(joinerSignatureMessage(transcript), options.self.identity.signSecretKey),
          ),
        };
        const sealed = aeadEncrypt(
          key,
          utf8Encode(JSON.stringify(payload)),
          pairingPayloadLabel('PAIR_PROOF'),
          deps.random,
        );
        connection.send(
          encodeFrame({
            v: PROTOCOL_VERSION,
            t: 'PAIR_PROOF',
            mac: bytesToBase64(pairingMac(options.secret, 'joiner', transcript)),
            n: bytesToBase64(sealed.nonce),
            c: bytesToBase64(sealed.ciphertext),
          }),
        );
        state.set({ kind: 'verifying' });
        return;
      }
      case 'PAIR_PENDING':
        if (exchange) state.set({ kind: 'awaiting-approval' });
        return;
      case 'PAIR_ACCEPT': {
        if (!exchange) {
          protocolError('accept before challenge');
          return;
        }
        const joined = openAccept(frame, exchange, options);
        if (!joined.ok) {
          finish(joined);
          return;
        }
        deps.logger.info('joined group', { groupId: joined.value.groupId });
        finish(joined);
        return;
      }
      default:
        protocolError(`unexpected ${frame.t}`);
    }
  });

  connection.send(encodeFrame(hello));
}

/** Rejects hosts whose id does not match their key, or that differ from the scanned QR. */
function checkChallenge(challenge: PairChallengeFrame, options: JoinOptions): string | null {
  const hostKey = base64ToBytes(challenge.hostSignPublicKey);
  if (!hostKey || deviceIdFromSignPublicKey(hostKey) !== challenge.hostDeviceId)
    return 'host id does not match its key';
  if (
    options.expectedHostSignPublicKey &&
    options.expectedHostSignPublicKey !== challenge.hostSignPublicKey
  ) {
    return 'host is not the device from the QR code';
  }
  return null;
}

function openAccept(
  frame: PairAcceptFrame,
  exchange: { challenge: PairChallengeFrame; key: Uint8Array; transcript: Uint8Array },
  options: JoinOptions,
): Result<JoinedGroup, AppError> {
  const fail = (reason: string): Result<never, AppError> =>
    err(appError('PROTOCOL_ERROR', reason, { reason }));

  const mac = base64ToBytes(frame.mac);
  if (!mac || !constantTimeEqual(mac, pairingMac(options.secret, 'host', exchange.transcript))) {
    return fail('host could not prove it knows the code');
  }
  const nonce = base64ToBytes(frame.n);
  const ciphertext = base64ToBytes(frame.c);
  if (!nonce || !ciphertext) return fail('invalid accept payload');
  const plaintext = aeadDecrypt(
    exchange.key,
    { nonce, ciphertext },
    pairingPayloadLabel('PAIR_ACCEPT'),
  );
  if (!plaintext) return fail('accept payload failed authentication');

  let json: unknown;
  try {
    json = JSON.parse(utf8Decode(plaintext));
  } catch {
    return fail('accept payload is not JSON');
  }
  const parsed = pairingAcceptPayloadSchema.safeParse(json);
  if (!parsed.success) return fail('accept payload has the wrong shape');

  const membership = membershipFromWire(parsed.data.membership);
  const groupKey = base64ToBytes(parsed.data.groupKey);
  if (groupKey?.length !== KEY_LENGTH) return fail('invalid group key');

  // The member list must be signed by the host we just authenticated and include us.
  const host = findMember(membership, exchange.challenge.hostDeviceId as DeviceRecord['id']);
  const me = findMember(membership, options.self.device.id);
  if (membership.updatedBy !== exchange.challenge.hostDeviceId)
    return fail('member list not signed by host');
  if (host?.signPublicKey !== exchange.challenge.hostSignPublicKey)
    return fail('host missing from member list');
  if (!isMembershipSignedByTrustedMember(membership, membership))
    return fail('member list signature invalid');
  if (me?.signPublicKey !== options.self.device.signPublicKey)
    return fail('this device is not in the member list');
  if (membership.groupId !== parsed.data.groupId) return fail('group id mismatch');

  return ok({ groupId: parsed.data.groupId, groupKey, epoch: parsed.data.epoch, membership });
}

function errorFromHost(frame: PairErrorFrame): AppError {
  switch (frame.code) {
    case 'PAIRING_CODE_INVALID':
      return appError('PAIRING_CODE_INVALID', 'the host rejected the code', {
        attemptsLeft: frame.attemptsLeft,
      });
    case 'PAIRING_REJECTED':
      return appError('PAIRING_REJECTED', 'the host denied the request', {});
    case 'PAIRING_EXPIRED':
      return appError('PAIRING_EXPIRED', 'pairing is no longer active on the host', {});
    case 'PROTOCOL_ERROR':
      return appError('PROTOCOL_ERROR', 'the host reported a protocol error', { reason: 'host' });
  }
}
