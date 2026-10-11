/**
 * Finds, connects and reconnects group members (docs/PLAN.md §6).
 *
 * - Hubs listen and advertise; between two hubs the smaller id dials.
 * - Clients only dial hubs.
 * - Failures are retried with backoff and recorded per peer as `lastError`,
 *   which the connection-status diagnosis uses to explain problems.
 */

import { type DeviceRecord, type DeviceRole, roleOf } from '../domain/device';
import { type AppError, appError } from '../domain/errors';
import type { DeviceId } from '../domain/ids';
import type { Membership } from '../domain/membership';
import { err, ok, type Result } from '../domain/result';
import type { PeerView } from '../domain/status';
import type { Cancel, ClockPort } from '../ports/clock';
import type { Advertiser, DiscoveredService, DiscoveryPort } from '../ports/discovery';
import type { LoggerPort } from '../ports/logger';
import type { RandomPort } from '../ports/random';
import type {
  Listener,
  PeerAddress,
  TransportConnection,
  TransportPort,
  Unsubscribe,
} from '../ports/transport';
import { encodeFrame } from '../protocol/codec';
import { PROTOCOL_VERSION } from '../protocol/version';
import { backoffDelayMs } from './backoff';
import { establishSession, type PeerSession, type SessionContext } from './peer-session';
import { createStore, type ReadonlyStore } from './store';

export const DEFAULT_LISTEN_PORT = 47821;
export const DIAL_TIMEOUT_MS = 5_000;
/** An incoming connection must say what it wants (HELLO or PAIR_HELLO) within this time. */
const FIRST_FRAME_TIMEOUT_MS = 10_000;

export interface PeerManagerDeps {
  readonly clock: ClockPort;
  readonly random: RandomPort;
  readonly logger: LoggerPort;
  readonly transport: TransportPort;
  readonly discovery: DiscoveryPort;
}

export interface PeerManagerOptions {
  readonly selfId: DeviceId;
  readonly selfRole: DeviceRole;
  readonly session: SessionContext;
  readonly groupTag: () => string;
  readonly listenPort: number;
}

interface PeerRecord {
  member: DeviceRecord;
  services: Map<string, DiscoveredService>;
  lastKnownAddress: PeerAddress | null;
  session: PeerSession | null;
  connecting: boolean;
  handshaking: boolean;
  attempt: number;
  cancelRetry: Cancel | null;
  lastError: AppError | null;
  lastSeenAt: number | null;
  lastSeenSubnet: string | null;
}

export class PeerManager {
  private readonly records = new Map<DeviceId, PeerRecord>();
  private readonly instanceToDevice = new Map<string, DeviceId>();
  private readonly peersStore = createStore<readonly PeerView[]>([]);
  private readonly openedListeners = new Set<(session: PeerSession) => void>();
  private listener: Listener | null = null;
  private advertiser: Advertiser | null = null;
  private stopBrowsing: Unsubscribe | null = null;
  private running = false;
  private currentSubnet: string | null = null;
  private pairingHandler: ((connection: TransportConnection) => void) | null = null;

  constructor(
    private readonly options: PeerManagerOptions,
    private readonly deps: PeerManagerDeps,
  ) {
    this.syncMembers(options.session.membership());
  }

  get peers(): ReadonlyStore<readonly PeerView[]> {
    return this.peersStore;
  }

  /** Port this hub accepts connections on; null for clients or when not running. */
  get listeningPort(): number | null {
    return this.listener?.port ?? null;
  }

  /** Called for every new authenticated session (dialed or accepted). */
  onSessionOpened(listener: (session: PeerSession) => void): Unsubscribe {
    this.openedListeners.add(listener);
    return () => this.openedListeners.delete(listener);
  }

  activeSessions(): readonly PeerSession[] {
    const sessions: PeerSession[] = [];
    for (const record of this.records.values()) {
      if (record.session && !record.session.isClosed) sessions.push(record.session);
    }
    return sessions;
  }

  async start(): Promise<Result<void, AppError>> {
    if (this.running) return ok(undefined);
    this.running = true;

    if (this.options.selfRole === 'hub') {
      const listening = await this.startListening();
      if (!listening.ok) {
        await this.stop();
        return listening;
      }
    }

    const browsing = await this.deps.discovery.browse({
      onUp: (service) => {
        this.handleServiceUp(service);
      },
      onDown: (instanceId) => {
        this.handleServiceDown(instanceId);
      },
    });
    if (!browsing.ok) {
      await this.stop();
      return browsing;
    }
    this.stopBrowsing = browsing.value;

    for (const record of this.records.values()) this.connect(record);
    return ok(undefined);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopBrowsing?.();
    this.stopBrowsing = null;
    for (const record of this.records.values()) {
      record.cancelRetry?.();
      record.cancelRetry = null;
      record.session?.close(
        appError('CONNECTION_LOST', 'stopped', { peerId: record.member.id, reason: 'closed' }),
      );
      record.session = null;
    }
    await this.advertiser?.stop();
    this.advertiser = null;
    await this.listener?.close();
    this.listener = null;
    this.publish();
  }

  /** Applies a new member list: adds new peers, disconnects removed ones. */
  syncMembers(membership: Membership): void {
    const memberIds = new Set<DeviceId>();
    for (const member of membership.members) {
      if (member.id === this.options.selfId) continue;
      memberIds.add(member.id);
      const existing = this.records.get(member.id);
      if (existing) {
        existing.member = member;
      } else {
        this.records.set(member.id, createRecord(member));
      }
    }
    for (const [id, record] of this.records) {
      if (memberIds.has(id)) continue;
      record.cancelRetry?.();
      record.session?.close(
        appError('REMOVED_FROM_GROUP', 'peer removed from group', {}),
        'REMOVED_FROM_GROUP',
      );
      this.records.delete(id);
    }
    if (this.running) {
      for (const record of this.records.values()) this.connect(record);
    }
    this.publish();
  }

  /** Network changed: retry everyone now instead of waiting for backoff. */
  handleNetworkChanged(subnet: string | null): void {
    this.currentSubnet = subnet;
    if (!this.running) return;
    for (const record of this.records.values()) {
      record.cancelRetry?.();
      record.cancelRetry = null;
      record.attempt = 0;
      this.connect(record);
    }
    this.publish();
  }

  /**
   * Routes incoming pairing connections to `handler` and advertises pairing
   * mode (`pm=1`) while set; pass null to stop.
   */
  async setPairingHandler(
    handler: ((connection: TransportConnection) => void) | null,
  ): Promise<void> {
    this.pairingHandler = handler;
    await this.refreshAdvertisement();
  }

  /** Closes every session so peers reconnect (used after a key rotation). */
  reconnectAll(reason: AppError): void {
    for (const record of this.records.values()) {
      record.session?.close(reason);
    }
  }

  /** Re-publishes the advertisement (e.g. after the group key changed). */
  async refreshAdvertisement(): Promise<void> {
    if (!this.advertiser || !this.listener) return;
    await this.advertiser.update(this.advertisement(this.listener.port));
  }

  // ------------------------------------------------------------------ internals

  private async startListening(): Promise<Result<void, AppError>> {
    const { transport, discovery } = this.deps;
    if (!transport.listen) {
      return err(
        appError('PORT_IN_USE', 'transport cannot listen', { port: this.options.listenPort }),
      );
    }
    const listening = await transport.listen(this.options.listenPort, (connection) => {
      void this.acceptConnection(connection);
    });
    if (!listening.ok) return listening;
    this.listener = listening.value;

    if (discovery.advertise) {
      const advertised = await discovery.advertise(this.advertisement(listening.value.port));
      if (!advertised.ok) return advertised;
      this.advertiser = advertised.value;
    }
    return ok(undefined);
  }

  private advertisement(port: number): Parameters<NonNullable<DiscoveryPort['advertise']>>[0] {
    return {
      deviceId: this.options.selfId,
      port,
      groupTag: this.options.groupTag(),
      pairingMode: this.pairingHandler !== null,
      protocolVersion: PROTOCOL_VERSION,
    };
  }

  private handleServiceUp(service: DiscoveredService): void {
    if (service.groupTag !== this.options.groupTag()) return;
    const record = this.records.get(service.deviceId as DeviceId);
    if (!record) return;
    record.services.set(service.instanceId, service);
    this.instanceToDevice.set(service.instanceId, record.member.id);
    record.lastSeenAt = this.deps.clock.now();
    if (!record.session && !record.connecting && this.shouldDial(record)) {
      record.cancelRetry?.();
      record.cancelRetry = null;
      this.connect(record);
    }
    this.publish();
  }

  private handleServiceDown(instanceId: string): void {
    const deviceId = this.instanceToDevice.get(instanceId);
    if (!deviceId) return;
    this.instanceToDevice.delete(instanceId);
    this.records.get(deviceId)?.services.delete(instanceId);
    this.publish();
  }

  private isRunning(): boolean {
    return this.running;
  }

  private shouldDial(record: PeerRecord): boolean {
    const peerRole = roleOf(record.member.platform);
    if (this.options.selfRole === 'client') return peerRole === 'hub';
    return peerRole === 'hub' && this.options.selfId < record.member.id;
  }

  private candidateAddresses(record: PeerRecord): PeerAddress[] {
    const addresses: PeerAddress[] = [];
    for (const service of record.services.values()) addresses.push(...service.addresses);
    if (record.lastKnownAddress) {
      const known = record.lastKnownAddress;
      if (!addresses.some((a) => a.host === known.host && a.port === known.port))
        addresses.push(known);
    }
    return addresses;
  }

  private connect(record: PeerRecord): void {
    if (!this.running || record.session || record.connecting || !this.shouldDial(record)) return;
    const addresses = this.candidateAddresses(record);
    if (addresses.length === 0) return;
    record.connecting = true;
    this.publish();
    void this.dialAddresses(record, addresses);
  }

  private async dialAddresses(
    record: PeerRecord,
    addresses: readonly PeerAddress[],
  ): Promise<void> {
    let lastError: AppError | null = null;
    for (const address of addresses) {
      if (!this.running || this.records.get(record.member.id) !== record) break;
      const dialed = await this.deps.transport.dial(address, DIAL_TIMEOUT_MS);
      if (!dialed.ok) {
        lastError = withPeer(dialed.error, record.member, address);
        continue;
      }
      record.handshaking = true;
      this.publish();
      const established = await establishSession(
        dialed.value,
        'initiator',
        this.options.session,
        this.deps,
      );
      record.handshaking = false;
      if (established.ok) {
        record.connecting = false;
        record.lastKnownAddress = address;
        this.attach(record, established.value);
        return;
      }
      lastError = established.error;
      // Authentication problems will not be fixed by trying another address.
      if (lastError.code !== 'CONNECTION_LOST') break;
    }
    record.connecting = false;
    if (lastError) {
      record.lastError = lastError;
      this.deps.logger.info('could not connect to peer', {
        peerId: record.member.id,
        code: lastError.code,
      });
    }
    this.scheduleRetry(record);
    this.publish();
  }

  private async acceptConnection(raw: TransportConnection): Promise<void> {
    if (!this.running) {
      raw.close('not running');
      return;
    }
    const first = await readFirstFrameType(raw, FIRST_FRAME_TIMEOUT_MS, this.deps.clock);
    if (!first) return;
    const connection = replayFirstMessage(raw, first.raw);
    if (first.type.startsWith('PAIR_')) {
      if (this.pairingHandler) this.pairingHandler(connection);
      else {
        connection.send(
          encodeFrame({
            v: PROTOCOL_VERSION,
            t: 'PAIR_ERROR',
            code: 'PAIRING_EXPIRED',
            attemptsLeft: 0,
          }),
        );
        connection.close('not in pairing mode');
      }
      return;
    }
    const established = await establishSession(
      connection,
      'responder',
      this.options.session,
      this.deps,
    );
    if (!established.ok) {
      this.deps.logger.info('rejected incoming connection', {
        from: connection.remoteAddress,
        code: established.error.code,
      });
      return;
    }
    const session = established.value;
    const record = this.records.get(session.peer.id);
    // `running` may have changed while the handshake was awaited.
    if (!record || !this.isRunning()) {
      session.close(
        appError('AUTH_FAILED', 'unknown peer', {
          peerId: session.peer.id,
          reason: 'not-a-member',
        }),
      );
      return;
    }
    this.attach(record, session);
  }

  private attach(record: PeerRecord, session: PeerSession): void {
    const previous = record.session;
    record.session = session;
    if (previous && !previous.isClosed) {
      previous.close(
        appError('CONNECTION_LOST', 'replaced by a newer connection', {
          peerId: record.member.id,
          reason: 'replaced',
        }),
      );
    }
    record.cancelRetry?.();
    record.cancelRetry = null;
    record.attempt = 0;
    record.lastError = null;
    record.lastSeenAt = this.deps.clock.now();
    record.lastSeenSubnet = this.currentSubnet;

    session.onClose((reason) => {
      if (record.session !== session) return;
      record.session = null;
      record.lastSeenAt = this.deps.clock.now();
      if (this.running && reason.code !== 'REMOVED_FROM_GROUP') record.lastError = reason;
      this.scheduleRetry(record);
      this.publish();
    });

    this.deps.logger.info('peer connected', { peerId: record.member.id });
    this.publish();
    for (const listener of [...this.openedListeners]) listener(session);
  }

  private scheduleRetry(record: PeerRecord): void {
    if (!this.running || record.session || record.cancelRetry || !this.shouldDial(record)) return;
    if (this.records.get(record.member.id) !== record) return;
    if (this.candidateAddresses(record).length === 0) return;
    const delay = backoffDelayMs(record.attempt, this.deps.random);
    record.attempt += 1;
    record.cancelRetry = this.deps.clock.schedule(delay, () => {
      record.cancelRetry = null;
      this.connect(record);
    });
  }

  private publish(): void {
    const views: PeerView[] = [];
    for (const record of this.records.values()) views.push(toView(record));
    views.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
    this.peersStore.set(views);
  }
}

function createRecord(member: DeviceRecord): PeerRecord {
  return {
    member,
    services: new Map(),
    lastKnownAddress: null,
    session: null,
    connecting: false,
    handshaking: false,
    attempt: 0,
    cancelRetry: null,
    lastError: null,
    lastSeenAt: null,
    lastSeenSubnet: null,
  };
}

function toView(record: PeerRecord): PeerView {
  const connected = record.session !== null && !record.session.isClosed;
  return {
    id: record.member.id,
    name: record.member.name,
    platform: record.member.platform,
    role: roleOf(record.member.platform),
    state: connected
      ? 'connected'
      : record.handshaking
        ? 'handshaking'
        : record.connecting
          ? 'connecting'
          : 'offline',
    discovered: record.services.size > 0,
    lastSeenAt: record.lastSeenAt,
    lastSeenSubnet: record.lastSeenSubnet,
    lastError: connected ? null : record.lastError,
  };
}

/** Adds peer identity to transport errors, which only know the address. */
function withPeer(error: AppError, member: DeviceRecord, address: PeerAddress): AppError {
  if (error.code !== 'PEER_UNREACHABLE') return error;
  return {
    ...error,
    details: {
      ...error.details,
      peerId: member.id,
      peerName: member.name,
      address: `${address.host}:${address.port}`,
    },
  };
}

/** Waits for the first frame to decide between a session handshake and pairing. */
function readFirstFrameType(
  connection: TransportConnection,
  timeoutMs: number,
  clock: ClockPort,
): Promise<{ readonly raw: string; readonly type: string } | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: { raw: string; type: string } | null): void => {
      if (done) return;
      done = true;
      cancelTimer();
      unsubscribeMessage();
      unsubscribeClose();
      resolve(value);
    };
    const cancelTimer = clock.schedule(timeoutMs, () => {
      connection.close('no first frame');
      finish(null);
    });
    const unsubscribeClose = connection.onClose(() => {
      finish(null);
    });
    const unsubscribeMessage = connection.onMessage((raw) => {
      let type: unknown;
      try {
        type = (JSON.parse(raw) as { t?: unknown }).t;
      } catch {
        type = undefined;
      }
      if (typeof type !== 'string') {
        connection.close('invalid first frame');
        finish(null);
        return;
      }
      finish({ raw, type });
    });
  });
}

/**
 * Wraps a connection so its first message (already read by the router) is
 * delivered again to the first listener. Safe because both protocols wait
 * for an answer after their first frame, so nothing else is in flight.
 */
function replayFirstMessage(connection: TransportConnection, first: string): TransportConnection {
  let pending: string | null = first;
  return {
    remoteAddress: connection.remoteAddress,
    send: (data) => {
      connection.send(data);
    },
    close: (reason) => {
      connection.close(reason);
    },
    onClose: (listener) => connection.onClose(listener),
    onMessage: (listener) => {
      let active = true;
      const unsubscribe = connection.onMessage(listener);
      if (pending !== null) {
        const message = pending;
        pending = null;
        void Promise.resolve().then(() => {
          if (active) listener(message);
        });
      }
      return () => {
        active = false;
        unsubscribe();
      };
    },
  };
}
