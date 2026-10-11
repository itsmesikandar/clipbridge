/**
 * Composition of the core: peer management, clip sync, membership exchange and
 * connection diagnosis behind one small API that apps drive (docs/PLAN.md §5).
 */

import { groupTag } from '../crypto/group-key';
import type { IdentityKeyPair } from '../crypto/identity';
import type { Clip, ClipContent } from '../domain/clip';
import { type DeviceRecord, roleOf } from '../domain/device';
import type { AppError } from '../domain/errors';
import type { DeviceId } from '../domain/ids';
import { findMember, type Membership } from '../domain/membership';
import type { NetworkSnapshot } from '../domain/network';
import { ok, type Result } from '../domain/result';
import type { ConnectionStatus, PeerView } from '../domain/status';
import type { ClipboardPort } from '../ports/clipboard';
import type { Cancel, ClockPort } from '../ports/clock';
import type { DiscoveryPort } from '../ports/discovery';
import type { LoggerPort } from '../ports/logger';
import type { LocalNetworkPermission, NetworkInfoPort } from '../ports/network-info';
import type { NotifierPort } from '../ports/notifier';
import type { RandomPort } from '../ports/random';
import type { TransportPort, Unsubscribe } from '../ports/transport';
import { membershipFromWire, membershipToWire } from '../protocol/wire';
import type { HistoryEntry } from './clip-history';
import { diagnose } from './diagnose';
import { decideMembership, isMember } from './membership-service';
import { DEFAULT_LISTEN_PORT, PeerManager } from './peer-manager';
import type { PeerSession } from './peer-session';
import { createStore, type ReadonlyStore } from './store';
import { SyncEngine, type SyncSettings } from './sync-engine';

export interface EnginePorts {
  readonly clock: ClockPort;
  readonly random: RandomPort;
  readonly logger: LoggerPort;
  readonly transport: TransportPort;
  readonly discovery: DiscoveryPort;
  readonly networkInfo: NetworkInfoPort;
  readonly clipboard: ClipboardPort;
  readonly notifier: NotifierPort;
}

export interface EngineSettings extends SyncSettings {
  readonly listenPort: number;
}

export interface LocalDevice {
  readonly device: DeviceRecord;
  readonly identity: IdentityKeyPair;
}

export interface GroupCredentials {
  readonly groupKey: Uint8Array;
  readonly epoch: number;
  readonly membership: Membership;
}

export interface EngineOptions {
  readonly self: LocalDevice;
  readonly group: GroupCredentials;
  readonly ports: EnginePorts;
  readonly settings?: Partial<EngineSettings>;
  /** Called when a newer signed member list was adopted; apps persist it. */
  readonly onMembershipChanged?: (membership: Membership) => void;
}

export interface Engine {
  readonly status: ReadonlyStore<ConnectionStatus>;
  readonly peers: ReadonlyStore<readonly PeerView[]>;
  readonly history: ReadonlyStore<readonly HistoryEntry[]>;
  readonly settings: ReadonlyStore<EngineSettings>;
  /** Last problem sending a clip (e.g. PAYLOAD_TOO_LARGE). */
  readonly lastSendError: ReadonlyStore<AppError | null>;
  /** Port accepting connections (hubs), for diagnostics; null otherwise. */
  readonly listeningPort: number | null;
  start(): Promise<Result<void, AppError>>;
  stop(): Promise<void>;
  /** Sends content the user chose explicitly (phones: share sheet). */
  sendClip(content: ClipContent): Result<Clip, AppError>;
  updateSettings(patch: Partial<EngineSettings>): void;
  clearHistory(): void;
}

/** Re-evaluates time-based status rules (e.g. the search grace period). */
const STATUS_TICK_MS = 2_000;

export function defaultSettings(self: DeviceRecord): EngineSettings {
  const isHub = roleOf(self.platform) === 'hub';
  return {
    sendEnabled: true,
    receiveEnabled: true,
    applyToClipboard: isHub,
    notifyOnReceive: true,
    listenPort: DEFAULT_LISTEN_PORT,
  };
}

export function createEngine(options: EngineOptions): Engine {
  return new ClipBridgeEngine(options);
}

class ClipBridgeEngine implements Engine {
  private readonly selfId: DeviceId;
  private readonly settingsStore: ReturnType<typeof createStore<EngineSettings>>;
  private readonly statusStore = createStore<ConnectionStatus>({
    kind: 'SEARCHING',
    connectedCount: 0,
    peerCount: 0,
    issue: null,
  });
  private readonly peerManager: PeerManager;
  private readonly sync: SyncEngine;
  private membership: Membership;
  private network: NetworkSnapshot | null = null;
  private permission: LocalNetworkPermission = 'unknown';
  private searchingSince = 0;
  private removedFromGroup = false;
  private running = false;
  private cancelTick: Cancel | null = null;
  private readonly subscriptions: Unsubscribe[] = [];

  constructor(private readonly options: EngineOptions) {
    const { self, group, ports } = options;
    this.selfId = self.device.id;
    this.membership = group.membership;
    this.settingsStore = createStore({ ...defaultSettings(self.device), ...options.settings });

    const tag = groupTag(group.groupKey);
    this.peerManager = new PeerManager(
      {
        selfId: this.selfId,
        selfRole: roleOf(self.device.platform),
        groupTag: () => tag,
        listenPort: this.settingsStore.get().listenPort,
        session: {
          credentials: {
            deviceId: this.selfId,
            identity: self.identity,
            groupKey: group.groupKey,
            epoch: group.epoch,
          },
          membership: () => this.membership,
        },
      },
      ports,
    );
    this.sync = new SyncEngine(
      {
        selfId: this.selfId,
        settings: () => this.settingsStore.get(),
        findMember: (id) => findMember(this.membership, id),
      },
      ports,
    );
  }

  get status(): ReadonlyStore<ConnectionStatus> {
    return this.statusStore;
  }

  get peers(): ReadonlyStore<readonly PeerView[]> {
    return this.peerManager.peers;
  }

  get history(): ReadonlyStore<readonly HistoryEntry[]> {
    return this.sync.recentClips;
  }

  get settings(): ReadonlyStore<EngineSettings> {
    return this.settingsStore;
  }

  get lastSendError(): ReadonlyStore<AppError | null> {
    return this.sync.lastError;
  }

  get listeningPort(): number | null {
    return this.peerManager.listeningPort;
  }

  async start(): Promise<Result<void, AppError>> {
    if (this.running) return ok(undefined);
    const { networkInfo, clock, logger } = this.options.ports;
    this.running = true;
    this.searchingSince = clock.now();

    this.network = await networkInfo.current();
    this.permission = await networkInfo.localNetworkPermission();
    this.peerManager.handleNetworkChanged(this.network.subnet);

    this.subscriptions.push(
      networkInfo.onChange((snapshot) => {
        this.handleNetworkChange(snapshot);
      }),
      this.peerManager.peers.subscribe(() => {
        this.refreshStatus();
      }),
      this.peerManager.onSessionOpened((session) => {
        this.handleSessionOpened(session);
      }),
    );

    const started = await this.peerManager.start();
    if (!started.ok) {
      logger.error('engine failed to start', { code: started.error.code });
      await this.stop();
      return started;
    }
    this.sync.start();
    this.scheduleTick();
    this.refreshStatus();
    logger.info('engine started', { deviceId: this.selfId });
    return ok(undefined);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.cancelTick?.();
    this.cancelTick = null;
    for (const unsubscribe of this.subscriptions.splice(0)) unsubscribe();
    this.sync.stop();
    await this.peerManager.stop();
  }

  sendClip(content: ClipContent): Result<Clip, AppError> {
    return this.sync.sendClip(content);
  }

  updateSettings(patch: Partial<EngineSettings>): void {
    this.settingsStore.update((current) => ({ ...current, ...patch }));
  }

  clearHistory(): void {
    this.sync.clearHistory();
  }

  // ------------------------------------------------------------------ internals

  private handleSessionOpened(session: PeerSession): void {
    this.sync.attach(session);
    session.onBody((body) => {
      if (body.t === 'MEMBERSHIP')
        this.handleIncomingMembership(membershipFromWire(body.membership));
    });
    session.send({ t: 'MEMBERSHIP', membership: membershipToWire(this.membership) });
  }

  private handleIncomingMembership(incoming: Membership): void {
    const decision = decideMembership(this.membership, incoming);
    if (decision !== 'adopt') return;
    this.membership = incoming;
    this.options.ports.logger.info('adopted member list', { version: incoming.version });
    this.options.onMembershipChanged?.(incoming);

    // Tell everyone (including devices about to be removed) before disconnecting anyone.
    for (const session of this.peerManager.activeSessions()) {
      session.send({ t: 'MEMBERSHIP', membership: membershipToWire(incoming) });
    }
    if (!isMember(incoming, this.selfId)) {
      this.removedFromGroup = true;
      this.refreshStatus();
      void this.stop();
      return;
    }
    this.peerManager.syncMembers(incoming);
  }

  private handleNetworkChange(snapshot: NetworkSnapshot): void {
    const changed = snapshot.subnet !== this.network?.subnet || snapshot.kind !== this.network.kind;
    this.network = snapshot;
    if (changed) {
      this.searchingSince = this.options.ports.clock.now();
      this.peerManager.handleNetworkChanged(snapshot.subnet);
    }
    this.refreshStatus();
  }

  private scheduleTick(): void {
    this.cancelTick = this.options.ports.clock.schedule(STATUS_TICK_MS, () => {
      if (!this.running) return;
      this.sync.prune();
      this.refreshStatus();
      this.scheduleTick();
    });
  }

  private refreshStatus(): void {
    const next = diagnose({
      selfRole: roleOf(this.options.self.device.platform),
      network: this.network,
      permission: this.permission,
      peers: this.peerManager.peers.get(),
      searchingForMs: this.options.ports.clock.now() - this.searchingSince,
      removedFromGroup: this.removedFromGroup,
    });
    const current = this.statusStore.get();
    if (
      current.kind !== next.kind ||
      current.connectedCount !== next.connectedCount ||
      current.peerCount !== next.peerCount ||
      JSON.stringify(current.issue) !== JSON.stringify(next.issue)
    ) {
      this.statusStore.set(next);
    }
  }
}
