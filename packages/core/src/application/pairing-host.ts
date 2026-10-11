/**
 * Host side of pairing: a computer that is already in the group lets a new
 * device join after the user approves it (docs/PLAN.md §8.2, M3).
 */

import {
  boxPublicKeyOf,
  deviceIdFromSignPublicKey,
  type IdentityKeyPair,
  sharedSecret,
  verifySignature,
} from '../crypto/identity';
import { aeadDecrypt, aeadEncrypt, KEY_LENGTH } from '../crypto/primitives';
import type { DevicePlatform, DeviceRecord } from '../domain/device';
import { type AppError, appError } from '../domain/errors';
import type { DeviceId } from '../domain/ids';
import type { Membership } from '../domain/membership';
import type { Result } from '../domain/result';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import { constantTimeEqual } from '../lib/bytes';
import { utf8Decode, utf8Encode } from '../lib/utf8';
import type { Cancel, ClockPort } from '../ports/clock';
import type { LoggerPort } from '../ports/logger';
import type { RandomPort } from '../ports/random';
import type { TransportConnection } from '../ports/transport';
import { decodeFrame, encodeFrame } from '../protocol/codec';
import {
  type PairChallengeFrame,
  type PairErrorFrame,
  type PairHelloFrame,
  pairingProofPayloadSchema,
} from '../protocol/frames';
import {
  buildPairingLink,
  formatPairingCode,
  generatePairingCode,
  joinerSignatureMessage,
  pairingKey,
  pairingMac,
  pairingPayloadLabel,
  pairingSecret,
  pairingTranscript,
} from '../protocol/pairing';
import { PROTOCOL_VERSION } from '../protocol/version';
import { deviceFromWire, membershipToWire } from '../protocol/wire';
import { createStore, type ReadonlyStore } from './store';

export const PAIRING_TIMING = {
  /** How long the code / QR stays valid. */
  durationMs: 2 * 60 * 1000,
  /** Wrong codes allowed before the session is cancelled. */
  maxAttempts: 3,
} as const;

export interface JoinRequest {
  readonly deviceId: DeviceId;
  readonly name: string;
  readonly platform: DevicePlatform;
}

export type PairingHostState =
  | { readonly kind: 'waiting'; readonly attemptsLeft: number }
  | { readonly kind: 'awaiting-approval'; readonly request: JoinRequest }
  | { readonly kind: 'completed'; readonly device: DeviceRecord }
  | { readonly kind: 'failed'; readonly error: AppError }
  | { readonly kind: 'cancelled' };

export interface GroupForJoiner {
  readonly groupId: string;
  readonly groupKey: Uint8Array;
  readonly epoch: number;
  readonly membership: Membership;
}

export interface PairingHostOptions {
  readonly self: { readonly device: DeviceRecord; readonly identity: IdentityKeyPair };
  /** LAN addresses and port put into the QR code. */
  readonly hosts: readonly string[];
  readonly port: number;
  /** Called when the user approved: adds the device to the group, returns what to send it. */
  readonly addMember: (device: DeviceRecord) => Result<GroupForJoiner, AppError>;
  /** Called once when the session ends for any reason. */
  readonly onEnded: () => void;
}

export interface PairingHostDeps {
  readonly clock: ClockPort;
  readonly random: RandomPort;
  readonly logger: LoggerPort;
}

interface PendingJoin {
  readonly connection: TransportConnection;
  readonly device: DeviceRecord;
  readonly key: Uint8Array;
  readonly secret: Uint8Array;
  readonly transcript: Uint8Array;
}

export class PairingHostSession {
  /** Formatted code to show, e.g. `K7QM-2XPA-9FRT`. */
  readonly code: string;
  /** Link encoded in the QR code. */
  readonly qrLink: string;
  readonly expiresAt: number;

  private readonly rawCode: string;
  private readonly token: Uint8Array;
  private readonly stateStore: ReturnType<typeof createStore<PairingHostState>>;
  private attempts = 0;
  private pending: PendingJoin | null = null;
  private readonly connections = new Set<TransportConnection>();
  private readonly cancelExpiry: Cancel;

  constructor(
    private readonly options: PairingHostOptions,
    private readonly deps: PairingHostDeps,
  ) {
    this.rawCode = generatePairingCode(deps.random);
    this.code = formatPairingCode(this.rawCode);
    this.token = deps.random.randomBytes(KEY_LENGTH);
    this.qrLink = buildPairingLink({
      hosts: options.hosts,
      port: options.port,
      token: this.token,
      hostSignPublicKey: options.self.device.signPublicKey,
    });
    this.expiresAt = deps.clock.now() + PAIRING_TIMING.durationMs;
    this.stateStore = createStore<PairingHostState>({
      kind: 'waiting',
      attemptsLeft: PAIRING_TIMING.maxAttempts,
    });
    this.cancelExpiry = deps.clock.schedule(PAIRING_TIMING.durationMs, () => {
      this.fail(appError('PAIRING_EXPIRED', 'pairing time is over', {}), 'PAIRING_EXPIRED');
    });
  }

  get state(): ReadonlyStore<PairingHostState> {
    return this.stateStore;
  }

  get isActive(): boolean {
    const kind = this.stateStore.get().kind;
    return kind === 'waiting' || kind === 'awaiting-approval';
  }

  /** The user clicked "Allow". */
  approve(): void {
    const pending = this.pending;
    if (!pending || this.stateStore.get().kind !== 'awaiting-approval') return;
    const added = this.options.addMember(pending.device);
    if (!added.ok) {
      this.fail(added.error, 'PROTOCOL_ERROR');
      return;
    }
    const group = added.value;
    const payload = {
      groupId: group.groupId,
      groupKey: bytesToBase64(group.groupKey),
      epoch: group.epoch,
      membership: membershipToWire(group.membership),
    };
    const sealed = aeadEncrypt(
      pending.key,
      utf8Encode(JSON.stringify(payload)),
      pairingPayloadLabel('PAIR_ACCEPT'),
      this.deps.random,
    );
    pending.connection.send(
      encodeFrame({
        v: PROTOCOL_VERSION,
        t: 'PAIR_ACCEPT',
        mac: bytesToBase64(pairingMac(pending.secret, 'host', pending.transcript)),
        n: bytesToBase64(sealed.nonce),
        c: bytesToBase64(sealed.ciphertext),
      }),
    );
    this.deps.logger.info('device paired', { deviceId: pending.device.id });
    this.end({ kind: 'completed', device: pending.device });
  }

  /** The user clicked "Deny". */
  deny(): void {
    if (this.stateStore.get().kind !== 'awaiting-approval') return;
    this.fail(appError('PAIRING_REJECTED', 'the user denied the request', {}), 'PAIRING_REJECTED');
  }

  /** The user closed the dialog. */
  cancel(): void {
    if (!this.isActive) return;
    this.sendErrorToAll('PAIRING_EXPIRED');
    this.end({ kind: 'cancelled' });
  }

  /** Takes an incoming connection whose first frame is a pairing frame. */
  handleConnection(connection: TransportConnection): void {
    if (!this.isActive) {
      connection.send(encodeFrame(pairError('PAIRING_EXPIRED', 0)));
      connection.close('pairing not active');
      return;
    }
    this.connections.add(connection);
    let step: 'hello' | 'proof' | 'done' = 'hello';
    let context: {
      hello: PairHelloFrame;
      challenge: PairChallengeFrame;
      key: Uint8Array;
      secret: Uint8Array;
      transcript: Uint8Array;
    } | null = null;

    connection.onClose(() => {
      this.connections.delete(connection);
      if (
        this.pending?.connection === connection &&
        this.stateStore.get().kind === 'awaiting-approval'
      ) {
        // The joiner gave up; wait for another attempt.
        this.pending = null;
        this.stateStore.set({ kind: 'waiting', attemptsLeft: this.attemptsLeft() });
      }
    });

    connection.onMessage((raw) => {
      const decoded = decodeFrame(raw);
      if (!decoded.ok) {
        this.reject(connection, 'PROTOCOL_ERROR');
        return;
      }
      const frame = decoded.value;
      if (step === 'hello' && frame.t === 'PAIR_HELLO') {
        if (this.stateStore.get().kind !== 'waiting') {
          this.reject(connection, 'PAIRING_REJECTED'); // already busy with another device
          return;
        }
        const ephemeralSecret = this.deps.random.randomBytes(KEY_LENGTH);
        const challenge: PairChallengeFrame = {
          v: PROTOCOL_VERSION,
          t: 'PAIR_CHALLENGE',
          ephPublicKey: bytesToBase64(boxPublicKeyOf(ephemeralSecret)),
          nonce: bytesToBase64(this.deps.random.randomBytes(KEY_LENGTH)),
          hostDeviceId: this.options.self.device.id,
          hostSignPublicKey: this.options.self.device.signPublicKey,
        };
        const joinerKey = base64ToBytes(frame.ephPublicKey);
        let shared: Uint8Array;
        try {
          shared = sharedSecret(ephemeralSecret, joinerKey ?? new Uint8Array(0));
        } catch {
          this.reject(connection, 'PROTOCOL_ERROR');
          return;
        }
        const secret =
          frame.method === 'qr'
            ? pairingSecret('qr', this.token)
            : pairingSecret('code', this.rawCode);
        const transcript = pairingTranscript(frame, challenge);
        context = {
          hello: frame,
          challenge,
          secret,
          transcript,
          key: pairingKey(shared, secret, transcript),
        };
        step = 'proof';
        connection.send(encodeFrame(challenge));
        return;
      }
      if (step === 'proof' && frame.t === 'PAIR_PROOF' && context) {
        step = 'done';
        this.handleProof(connection, context, frame.mac, frame.n, frame.c);
        return;
      }
      this.reject(connection, 'PROTOCOL_ERROR');
    });
  }

  private handleProof(
    connection: TransportConnection,
    context: { key: Uint8Array; secret: Uint8Array; transcript: Uint8Array },
    mac: string,
    nonce: string,
    ciphertext: string,
  ): void {
    const expected = pairingMac(context.secret, 'joiner', context.transcript);
    const received = base64ToBytes(mac);
    if (!received || !constantTimeEqual(received, expected)) {
      this.attempts += 1;
      const attemptsLeft = this.attemptsLeft();
      this.deps.logger.warn('wrong pairing code', { attemptsLeft });
      connection.send(encodeFrame(pairError('PAIRING_CODE_INVALID', attemptsLeft)));
      connection.close('wrong code');
      if (attemptsLeft === 0) {
        this.fail(
          appError('PAIRING_CODE_INVALID', 'too many wrong codes', { attemptsLeft: 0 }),
          'PAIRING_EXPIRED',
        );
      } else {
        this.stateStore.set({ kind: 'waiting', attemptsLeft });
      }
      return;
    }

    const device = this.openJoinerPayload(context, nonce, ciphertext);
    if (!device) {
      this.reject(connection, 'PROTOCOL_ERROR');
      return;
    }
    this.pending = { connection, device, ...context };
    connection.send(encodeFrame({ v: PROTOCOL_VERSION, t: 'PAIR_PENDING' }));
    this.stateStore.set({
      kind: 'awaiting-approval',
      request: { deviceId: device.id, name: device.name, platform: device.platform },
    });
  }

  /** Decrypts the joiner's device record and checks it owns the keys it claims. */
  private openJoinerPayload(
    context: { key: Uint8Array; transcript: Uint8Array },
    nonce: string,
    ciphertext: string,
  ): DeviceRecord | null {
    const n = base64ToBytes(nonce);
    const c = base64ToBytes(ciphertext);
    if (!n || !c) return null;
    const plaintext = aeadDecrypt(
      context.key,
      { nonce: n, ciphertext: c },
      pairingPayloadLabel('PAIR_PROOF'),
    );
    if (!plaintext) return null;
    let json: unknown;
    try {
      json = JSON.parse(utf8Decode(plaintext));
    } catch {
      return null;
    }
    const parsed = pairingProofPayloadSchema.safeParse(json);
    if (!parsed.success) return null;
    const device = deviceFromWire(parsed.data.device);
    const signKey = base64ToBytes(device.signPublicKey);
    const signature = base64ToBytes(parsed.data.sig);
    if (!signKey || !signature || deviceIdFromSignPublicKey(signKey) !== device.id) return null;
    if (!verifySignature(signature, joinerSignatureMessage(context.transcript), signKey))
      return null;
    if (device.id === this.options.self.device.id) return null;
    return { ...device, addedAt: this.deps.clock.now() };
  }

  private attemptsLeft(): number {
    return Math.max(0, PAIRING_TIMING.maxAttempts - this.attempts);
  }

  private reject(connection: TransportConnection, code: PairErrorFrame['code']): void {
    connection.send(encodeFrame(pairError(code, this.attemptsLeft())));
    connection.close(code);
  }

  private fail(error: AppError, notify: PairErrorFrame['code']): void {
    if (!this.isActive) return;
    this.sendErrorToAll(notify);
    this.end({ kind: 'failed', error });
  }

  private sendErrorToAll(code: PairErrorFrame['code']): void {
    for (const connection of [...this.connections]) {
      connection.send(encodeFrame(pairError(code, this.attemptsLeft())));
      connection.close(code);
    }
  }

  private end(state: PairingHostState): void {
    this.cancelExpiry();
    this.pending = null;
    for (const connection of [...this.connections]) connection.close('pairing ended');
    this.connections.clear();
    this.stateStore.set(state);
    this.options.onEnded();
  }
}

function pairError(code: PairErrorFrame['code'], attemptsLeft: number): PairErrorFrame {
  return { v: PROTOCOL_VERSION, t: 'PAIR_ERROR', code, attemptsLeft };
}
