/**
 * Composition of the core: peer management, clip sync, group membership
 * (add / remove / rename / key rotation), pairing and connection diagnosis
 * behind one small API that apps drive (docs/PLAN.md §5).
 */

import { generateGroupKey, groupTag } from '../crypto/group-key';
import type { IdentityKeyPair } from '../crypto/identity';
import { openSealed, sealTo } from '../crypto/sealed-box';
import type { Clip, ClipContent } from '../domain/clip';
import { DEVICE_NAME_MAX_LENGTH, type DeviceRecord, roleOf } from '../domain/device';
import { type AppError, appError } from '../domain/errors';
import type { DeviceId } from '../domain/ids';
import { findMember, type Membership } from '../domain/membership';
import { hasLanConnection, type NetworkSnapshot } from '../domain/network';
import { err, ok, type Result } from '../domain/result';
import type { ConnectionStatus, PeerView } from '../domain/status';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import type { ClipboardPort } from '../ports/clipboard';
import type { Cancel, ClockPort } from '../ports/clock';
import type { DiscoveryPort } from '../ports/discovery';
import type { LoggerPort } from '../ports/logger';
import type { LocalNetworkPermission, NetworkInfoPort } from '../ports/network-info';
import type { NotifierPort } from '../ports/notifier';
import type { RandomPort } from '../ports/random';
import type { TransportPort, Unsubscribe } from '../ports/transport';
import type { Body, SealedKey } from '../protocol/frames';
import { membershipFromWire, membershipToWire } from '../protocol/wire';
import type { HistoryEntry } from './clip-history';
import { diagnose } from './diagnose';
import { type EpochKey, GroupKeys } from './group-keys';
import { decideMembership, isMember, signMembership } from './membership-service';
import { type GroupForJoiner, PairingHostSession } from './pairing-host';
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
  /** Current group key. */
  readonly groupKey: Uint8Array;
  readonly epoch: number;
  readonly membership: Membership;
  /** Recent previous keys (newest first); lets lagging devices catch up. */
  readonly previousKeys?: readonly EpochKey[];
}

export interface EngineOptions {
  readonly self: LocalDevice;
  readonly group: GroupCredentials;
  readonly ports: EnginePorts;
  readonly settings?: Partial<EngineSettings>;
  /** Called whenever the member list or key changed; apps persist the new credentials. */
  readonly onGroupChanged?: (group: GroupCredentials) => void;
}

export interface Engine {
  readonly status: ReadonlyStore<ConnectionStatus>;
  readonly peers: ReadonlyStore<readonly PeerView[]>;
  readonly history: ReadonlyStore<readonly HistoryEntry[]>;
  readonly settings: ReadonlyStore<EngineSettings>;
  readonly membership: ReadonlyStore<Membership>;
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
  /** Shows a code / QR so a new device can join (computers only). */
  startPairing(): Result<PairingHostSession, AppError>;
  /** Removes a device and rotates the group key so it cannot read anything anymore. */
  removeMember(id: DeviceId): Result<void, AppError>;
  renameMember(id: DeviceId, name: string): Result<void, AppError>;
}

/** Re-evaluates time-based status rules (e.g. the search grace period). */
const STATUS_TICK_MS = 2_000;
/** Time for MEMBERSHIP / KEY_ROTATE to be forwarded before sessions re-handshake. */
const REKEY_DELAY_MS = 500;

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
  private readonly membershipStore: ReturnType<typeof createStore<Membership>>;
  private readonly keys: GroupKeys;
  private readonly peerManager: PeerManager;
  private readonly sync: SyncEngine;
  private network: NetworkSnapshot | null = null;
  private permission: LocalNetworkPermission = 'unknown';
  private searchingSince = 0;
  private removedFromGroup = false;
  private running = false;
  private cancelTick: Cancel | null = null;
  private cancelRekey: Cancel | null = null;
  private pairing: PairingHostSession | null = null;
  private readonly subscriptions: Unsubscribe[] = [];

  constructor(private readonly options: EngineOptions) {
    const { self, group, ports } = options;
    this.selfId = self.device.id;
    this.membershipStore = createStore(group.membership);
    this.keys = new GroupKeys(
      { epoch: group.epoch, key: group.groupKey },
      group.previousKeys ?? [],
    );
    this.settingsStore = createStore({ ...defaultSettings(self.device), ...options.settings });
    // A device removed while it was off learns it from its saved member list.
    this.removedFromGroup = !isMember(group.membership, this.selfId);

    const tag = groupTag(group.membership.groupId);
    this.peerManager = new PeerManager(
      {
        selfId: this.selfId,
        selfRole: roleOf(self.device.platform),
        groupTag: () => tag,
        listenPort: this.settingsStore.get().listenPort,
        session: {
          credentials: { deviceId: this.selfId, identity: self.identity, keys: this.keys },
          membership: () => this.membershipStore.get(),
        },
      },
      ports,
    );
    this.sync = new SyncEngine(
      {
        selfId: this.selfId,
        settings: () => this.settingsStore.get(),
        findMember: (id) => findMember(this.membershipStore.get(), id),
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

  get membership(): ReadonlyStore<Membership> {
    return this.membershipStore;
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
    if (this.removedFromGroup) {
      this.refreshStatus();
      return ok(undefined);
    }
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
    logger.info('engine started', { deviceId: this.selfId, epoch: this.keys.epoch });
    return ok(undefined);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.pairing?.cancel();
    this.cancelTick?.();
    this.cancelTick = null;
    this.cancelRekey?.();
    this.cancelRekey = null;
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

  // ------------------------------------------------------------------ group management

  startPairing(): Result<PairingHostSession, AppError> {
    if (this.pairing?.isActive) return ok(this.pairing);
    if (roleOf(this.options.self.device.platform) !== 'hub') {
      return err(protocolError('only computers can add devices'));
    }
    const network = this.network;
    if (!network || !hasLanConnection(network) || !network.ipv4) {
      return err(
        appError('NO_NETWORK', 'cannot pair without a LAN', {
          networkKind: network?.kind ?? 'none',
        }),
      );
    }
    const port = this.peerManager.listeningPort;
    if (port === null) {
      return err(
        appError('PORT_IN_USE', 'not accepting connections', {
          port: this.settingsStore.get().listenPort,
        }),
      );
    }
    const session = new PairingHostSession(
      {
        self: this.options.self,
        hosts: [network.ipv4],
        port,
        addMember: (device) => this.addMember(device),
        onEnded: () => {
          if (this.pairing === session) this.pairing = null;
          void this.peerManager.setPairingHandler(null);
        },
      },
      this.options.ports,
    );
    this.pairing = session;
    void this.peerManager.setPairingHandler((connection) => {
      session.handleConnection(connection);
    });
    return ok(session);
  }

  removeMember(id: DeviceId): Result<void, AppError> {
    if (id === this.selfId) return err(protocolError('a device cannot remove itself'));
    const current = this.membershipStore.get();
    if (!findMember(current, id)) return ok(undefined);

    const next = this.signNext(current.members.filter((member) => member.id !== id));
    const newKey: EpochKey = {
      epoch: this.keys.epoch + 1,
      key: generateGroupKey(this.options.ports.random),
    };
    const rotation: Body = {
      t: 'KEY_ROTATE',
      groupId: current.groupId,
      epoch: newKey.epoch,
      sealed: next.members
        .filter((member) => member.id !== this.selfId)
        .map((member) => this.sealKeyFor(member, newKey.key)),
    };

    // Everyone (including the removed device) learns the new list first; only
    // remaining members get the new key.
    const sessions = this.peerManager.activeSessions();
    for (const session of sessions)
      session.send({ t: 'MEMBERSHIP', membership: membershipToWire(next) });
    if (rotation.sealed.length > 0) {
      for (const session of sessions) if (session.peer.id !== id) session.send(rotation);
    }

    this.keys.rotate(newKey);
    this.membershipStore.set(next);
    this.peerManager.syncMembers(next);
    this.notifyGroupChanged();
    this.options.ports.logger.info('removed device and rotated key', {
      deviceId: id,
      epoch: newKey.epoch,
    });
    this.scheduleRekey();
    return ok(undefined);
  }

  renameMember(id: DeviceId, name: string): Result<void, AppError> {
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > DEVICE_NAME_MAX_LENGTH) {
      return err(protocolError(`names must be 1–${DEVICE_NAME_MAX_LENGTH} characters`));
    }
    const current = this.membershipStore.get();
    if (!findMember(current, id)) return err(protocolError('unknown device'));
    this.applyLocalMembership(
      this.signNext(
        current.members.map((member) => (member.id === id ? { ...member, name: trimmed } : member)),
      ),
    );
    return ok(undefined);
  }

  /** Used by pairing after the user approved a new device. */
  private addMember(device: DeviceRecord): Result<GroupForJoiner, AppError> {
    const current = this.membershipStore.get();
    const others = current.members.filter((member) => member.id !== device.id);
    const next = this.signNext([...others, device]);
    this.applyLocalMembership(next);
    return ok({
      groupId: next.groupId,
      groupKey: this.keys.current.key,
      epoch: this.keys.epoch,
      membership: next,
    });
  }

  private signNext(members: readonly DeviceRecord[]): Membership {
    const current = this.membershipStore.get();
    return signMembership(
      {
        groupId: current.groupId,
        version: current.version + 1,
        members,
        updatedBy: this.selfId,
        updatedAt: this.options.ports.clock.now(),
      },
      this.options.self.identity,
    );
  }

  private applyLocalMembership(next: Membership): void {
    this.membershipStore.set(next);
    for (const session of this.peerManager.activeSessions()) {
      session.send({ t: 'MEMBERSHIP', membership: membershipToWire(next) });
    }
    this.peerManager.syncMembers(next);
    this.notifyGroupChanged();
  }

  private sealKeyFor(member: DeviceRecord, key: Uint8Array): SealedKey {
    const boxKey = base64ToBytes(member.boxPublicKey) ?? new Uint8Array(0);
    const sealed = sealTo(boxKey, key, this.options.ports.random);
    return {
      deviceId: member.id,
      e: bytesToBase64(sealed.ephemeralPublicKey),
      n: bytesToBase64(sealed.nonce),
      c: bytesToBase64(sealed.ciphertext),
    };
  }

  private notifyGroupChanged(): void {
    this.options.onGroupChanged?.({
      groupKey: this.keys.current.key,
      epoch: this.keys.epoch,
      membership: this.membershipStore.get(),
      previousKeys: this.keys.previous,
    });
  }

  // ------------------------------------------------------------------ sessions

  private handleSessionOpened(session: PeerSession): void {
    this.sync.attach(session);
    session.onBody((body) => {
      if (body.t === 'MEMBERSHIP')
        this.handleIncomingMembership(membershipFromWire(body.membership));
      if (body.t === 'KEY_ROTATE') this.handleKeyRotate(body, session);
    });
    session.send({ t: 'MEMBERSHIP', membership: membershipToWire(this.membershipStore.get()) });

    // The peer authenticated with an older key: it missed a rotation. Hand it the current key.
    if (session.epoch < this.keys.epoch) {
      session.send({
        t: 'KEY_ROTATE',
        groupId: this.membershipStore.get().groupId,
        epoch: this.keys.epoch,
        sealed: [this.sealKeyFor(session.peer, this.keys.current.key)],
      });
    }
  }

  private handleIncomingMembership(incoming: Membership): void {
    const decision = decideMembership(this.membershipStore.get(), incoming);
    if (decision !== 'adopt') return;
    this.membershipStore.set(incoming);
    this.options.ports.logger.info('adopted member list', { version: incoming.version });
    this.notifyGroupChanged();

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

  private handleKeyRotate(body: Extract<Body, { t: 'KEY_ROTATE' }>, source: PeerSession): void {
    if (body.groupId !== this.membershipStore.get().groupId || body.epoch <= this.keys.epoch)
      return;
    const mine = body.sealed.find((entry) => entry.deviceId === this.selfId);
    if (!mine) return;
    const ephemeralPublicKey = base64ToBytes(mine.e);
    const nonce = base64ToBytes(mine.n);
    const ciphertext = base64ToBytes(mine.c);
    const key =
      ephemeralPublicKey && nonce && ciphertext
        ? openSealed(this.options.self.identity.boxSecretKey, {
            ephemeralPublicKey,
            nonce,
            ciphertext,
          })
        : null;
    if (key?.length !== 32) {
      this.options.ports.logger.warn('could not open rotated key', { from: source.peer.id });
      return;
    }
    this.keys.rotate({ epoch: body.epoch, key });
    this.notifyGroupChanged();
    this.options.ports.logger.info('received new group key', { epoch: body.epoch });
    for (const session of this.peerManager.activeSessions()) {
      if (session !== source) session.send(body);
    }
    this.scheduleRekey();
  }

  /** Re-handshakes every session with the new key once rotation messages are out. */
  private scheduleRekey(): void {
    this.cancelRekey?.();
    this.cancelRekey = this.options.ports.clock.schedule(REKEY_DELAY_MS, () => {
      this.cancelRekey = null;
      if (!this.running) return;
      this.searchingSince = this.options.ports.clock.now();
      this.peerManager.reconnectAll(
        appError('CONNECTION_LOST', 'reconnecting with the new group key', {
          peerId: null,
          reason: 'rekey',
        }),
      );
    });
  }

  // ------------------------------------------------------------------ status

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

function protocolError(reason: string): AppError<'PROTOCOL_ERROR'> {
  return appError('PROTOCOL_ERROR', reason, { reason });
}
