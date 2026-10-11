/**
 * Turns a raw transport connection into an authenticated, encrypted session
 * with one group member, and keeps it alive with heartbeats.
 */

import type { DeviceRecord } from '../domain/device';
import { type AppError, appError, type ConnectionLostReason } from '../domain/errors';
import type { DeviceId } from '../domain/ids';
import type { Membership } from '../domain/membership';
import { err, ok, type Result } from '../domain/result';
import type { Cancel, ClockPort } from '../ports/clock';
import type { LoggerPort } from '../ports/logger';
import type { RandomPort } from '../ports/random';
import type { TransportConnection, Unsubscribe } from '../ports/transport';
import { decodeFrame, encodeFrame } from '../protocol/codec';
import type { Body, ErrorFrame, HandshakeRole, HelloFrame } from '../protocol/frames';
import {
  createAuth,
  createHello,
  deriveSessionKeys,
  type HandshakeCredentials,
  handshakeTranscript,
  negotiateGroupKey,
  verifyPeerAuth,
} from '../protocol/handshake';
import { SecureChannel } from '../protocol/secure-channel';
import { PROTOCOL_VERSION } from '../protocol/version';

export const SESSION_TIMING = {
  handshakeTimeoutMs: 10_000,
  heartbeatIntervalMs: 15_000,
  /** Two missed heartbeats (plus slack) and the peer is considered gone. */
  deadAfterMs: 35_000,
} as const;

export interface SessionContext {
  readonly credentials: HandshakeCredentials;
  /** Current member list; read at handshake time. */
  readonly membership: () => Membership;
}

export interface SessionDeps {
  readonly clock: ClockPort;
  readonly random: RandomPort;
  readonly logger: LoggerPort;
}

export interface PeerSession {
  readonly peer: DeviceRecord;
  /** Group key epoch this session was authenticated with (may be older than ours). */
  readonly epoch: number;
  readonly remoteAddress: string;
  readonly isClosed: boolean;
  send(body: Body): void;
  onBody(listener: (body: Body) => void): Unsubscribe;
  /** Called once with the reason the session ended. */
  onClose(listener: (reason: AppError) => void): Unsubscribe;
  /** Closes the session. `notifyPeer` sends an ERROR frame first (e.g. REMOVED_FROM_GROUP). */
  close(reason: AppError, notifyPeer?: ErrorFrame['code']): void;
}

/** Runs the handshake (docs/PLAN.md §8.3) and resolves with an established session. */
export function establishSession(
  connection: TransportConnection,
  role: HandshakeRole,
  context: SessionContext,
  deps: SessionDeps,
): Promise<Result<PeerSession, AppError>> {
  return new Promise((resolve) => {
    const { credentials } = context;
    const ownHello = createHello(credentials, role, deps.random);
    let peerHello: HelloFrame | null = null;
    let transcript: Uint8Array | null = null;
    let negotiated: { readonly epoch: number; readonly key: Uint8Array } | null = null;
    let settled = false;
    const subscriptions: Unsubscribe[] = [];

    const finish = (result: Result<PeerSession, AppError>): void => {
      if (settled) return;
      settled = true;
      cancelTimeout();
      for (const unsubscribe of subscriptions) unsubscribe();
      resolve(result);
    };

    const fail = (error: AppError, notifyPeer?: ErrorFrame['code']): void => {
      if (settled) return;
      if (notifyPeer) connection.send(encodeFrame(errorFrame(notifyPeer, error.message)));
      finish(err(error));
      connection.close(error.code);
    };

    const cancelTimeout: Cancel = deps.clock.schedule(SESSION_TIMING.handshakeTimeoutMs, () => {
      fail(connectionLost(peerHello?.deviceId ?? null, 'handshake-timeout'));
    });

    subscriptions.push(
      connection.onClose(() => {
        finish(err(connectionLost(peerHello?.deviceId ?? null, 'closed')));
      }),
      connection.onMessage((raw) => {
        const decoded = decodeFrame(raw);
        if (!decoded.ok) {
          const error = withPeerId(decoded.error, peerHello?.deviceId ?? null);
          fail(error, error.code === 'VERSION_MISMATCH' ? 'VERSION_MISMATCH' : 'PROTOCOL_ERROR');
          return;
        }
        const frame = decoded.value;
        switch (frame.t) {
          case 'ERROR':
            fail(errorFromPeer(frame, peerHello?.deviceId ?? null));
            return;
          case 'HELLO': {
            const problem = checkPeerHello(frame, role, credentials.deviceId, peerHello !== null);
            if (problem) {
              fail(problem, 'PROTOCOL_ERROR');
              return;
            }
            peerHello = frame;
            if (role === 'responder') connection.send(encodeFrame(ownHello));
            negotiated = negotiateGroupKey(credentials.keys, frame.epoch);
            if (!negotiated) {
              fail(
                appError('AUTH_FAILED', `no key for epoch ${frame.epoch}`, {
                  peerId: frame.deviceId,
                  reason: 'epoch-mismatch',
                }),
                'AUTH_FAILED',
              );
              return;
            }
            transcript =
              role === 'initiator'
                ? handshakeTranscript(ownHello, frame)
                : handshakeTranscript(frame, ownHello);
            connection.send(encodeFrame(createAuth(credentials, role, transcript, negotiated.key)));
            return;
          }
          case 'AUTH': {
            if (!peerHello || !transcript || !negotiated) {
              fail(protocolError('AUTH before HELLO'), 'PROTOCOL_ERROR');
              return;
            }
            const verified = verifyPeerAuth({
              groupKey: negotiated.key,
              membership: context.membership(),
              transcript,
              peerHello,
              peerAuth: frame,
            });
            if (!verified.ok) {
              fail(verified.error, 'AUTH_FAILED');
              return;
            }
            const keys = deriveSessionKeys(negotiated.key, transcript, role);
            const session = new EstablishedSession(
              connection,
              verified.value,
              negotiated.epoch,
              keys,
              deps,
            );
            finish(ok(session));
            return;
          }
          default:
            fail(protocolError(`unexpected ${frame.t} during handshake`), 'PROTOCOL_ERROR');
            return;
        }
      }),
    );

    if (role === 'initiator') connection.send(encodeFrame(ownHello));
  });
}

class EstablishedSession implements PeerSession {
  private readonly channel: SecureChannel;
  private readonly bodyListeners = new Set<(body: Body) => void>();
  private readonly closeListeners = new Set<(reason: AppError) => void>();
  private readonly subscriptions: Unsubscribe[] = [];
  private lastReceivedAt: number;
  private cancelHeartbeat: Cancel = () => undefined;
  private closeReason: AppError | null = null;

  constructor(
    private readonly connection: TransportConnection,
    readonly peer: DeviceRecord,
    readonly epoch: number,
    keys: ReturnType<typeof deriveSessionKeys>,
    private readonly deps: SessionDeps,
  ) {
    this.channel = new SecureChannel(keys, deps.random);
    this.lastReceivedAt = deps.clock.now();
    this.subscriptions.push(
      connection.onMessage((raw) => {
        this.handleRaw(raw);
      }),
      connection.onClose(() => {
        this.terminate(connectionLost(peer.id, 'closed'));
      }),
    );
    this.scheduleHeartbeat();
  }

  get remoteAddress(): string {
    return this.connection.remoteAddress;
  }

  get isClosed(): boolean {
    return this.closeReason !== null;
  }

  send(body: Body): void {
    if (this.isClosed) return;
    this.connection.send(encodeFrame(this.channel.seal(body)));
  }

  onBody(listener: (body: Body) => void): Unsubscribe {
    this.bodyListeners.add(listener);
    return () => this.bodyListeners.delete(listener);
  }

  onClose(listener: (reason: AppError) => void): Unsubscribe {
    if (this.closeReason) {
      listener(this.closeReason);
      return () => undefined;
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(reason: AppError, notifyPeer?: ErrorFrame['code']): void {
    if (this.isClosed) return;
    if (notifyPeer) this.connection.send(encodeFrame(errorFrame(notifyPeer, reason.message)));
    this.terminate(reason);
    this.connection.close(reason.code);
  }

  private handleRaw(raw: string): void {
    const decoded = decodeFrame(raw);
    if (!decoded.ok) {
      this.close(withPeerId(decoded.error, this.peer.id), 'PROTOCOL_ERROR');
      return;
    }
    const frame = decoded.value;
    if (frame.t === 'ERROR') {
      this.close(errorFromPeer(frame, this.peer.id));
      return;
    }
    if (frame.t !== 'SEC') {
      this.close(protocolError(`unexpected ${frame.t} after handshake`), 'PROTOCOL_ERROR');
      return;
    }
    const opened = this.channel.open(frame);
    if (!opened.ok) {
      this.close(opened.error, 'PROTOCOL_ERROR');
      return;
    }
    this.lastReceivedAt = this.deps.clock.now();
    const body = opened.value;
    if (body.t === 'PING') {
      this.send({ t: 'PONG', ts: body.ts });
      return;
    }
    if (body.t === 'PONG') return;
    for (const listener of [...this.bodyListeners]) listener(body);
  }

  private scheduleHeartbeat(): void {
    this.cancelHeartbeat = this.deps.clock.schedule(SESSION_TIMING.heartbeatIntervalMs, () => {
      if (this.isClosed) return;
      if (this.deps.clock.now() - this.lastReceivedAt > SESSION_TIMING.deadAfterMs) {
        this.deps.logger.info('peer heartbeat timeout', { peerId: this.peer.id });
        this.close(connectionLost(this.peer.id, 'heartbeat-timeout'));
        return;
      }
      this.send({ t: 'PING', ts: this.deps.clock.now() });
      this.scheduleHeartbeat();
    });
  }

  private terminate(reason: AppError): void {
    if (this.closeReason) return;
    this.closeReason = reason;
    this.cancelHeartbeat();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.bodyListeners.clear();
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    for (const listener of listeners) listener(reason);
  }
}

function checkPeerHello(
  hello: HelloFrame,
  ownRole: HandshakeRole,
  ownId: DeviceId,
  alreadyReceived: boolean,
): AppError | null {
  if (alreadyReceived) return protocolError('duplicate HELLO');
  if (hello.role === ownRole) return protocolError('both sides claim the same role');
  if (hello.deviceId === ownId) return protocolError('connected to itself');
  return null;
}

function errorFrame(code: ErrorFrame['code'], message: string): ErrorFrame {
  return { v: PROTOCOL_VERSION, t: 'ERROR', code, message: message.slice(0, 500) };
}

/** Maps an ERROR frame sent by the peer to the error we show locally. */
function errorFromPeer(frame: ErrorFrame, peerId: string | null): AppError {
  switch (frame.code) {
    case 'AUTH_FAILED':
      return appError('AUTH_FAILED', `peer rejected us: ${frame.message}`, {
        peerId,
        reason: 'rejected-by-peer',
      });
    case 'VERSION_MISMATCH':
      return appError('VERSION_MISMATCH', `peer reported version mismatch: ${frame.message}`, {
        peerId,
        localVersion: PROTOCOL_VERSION,
        remoteVersion: null,
      });
    case 'REMOVED_FROM_GROUP':
      return appError('REMOVED_FROM_GROUP', 'peer says this device was removed', {});
    case 'PROTOCOL_ERROR':
      return protocolError(`peer reported protocol error: ${frame.message}`);
  }
}

function withPeerId(error: AppError, peerId: string | null): AppError {
  return error.code === 'VERSION_MISMATCH'
    ? { ...error, details: { ...error.details, peerId } }
    : error;
}

function connectionLost(
  peerId: string | null,
  reason: ConnectionLostReason,
): AppError<'CONNECTION_LOST'> {
  return appError('CONNECTION_LOST', `connection lost: ${reason}`, { peerId, reason });
}

function protocolError(reason: string): AppError<'PROTOCOL_ERROR'> {
  return appError('PROTOCOL_ERROR', reason, { reason });
}
