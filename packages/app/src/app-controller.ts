/**
 * Application layer of the desktop main process: owns the engine lifecycle,
 * pairing (host and join), group changes, persistence, and turns everything
 * into the snapshot the UI renders. Has no Electron imports, so it is tested
 * with core's in-memory network.
 */

import {
  type AppError,
  type Clip,
  type ClipContent,
  CORE_VERSION,
  createEngine as createCoreEngine,
  type DevicePlatform,
  type DiscoveredService,
  type Engine,
  type EnginePorts,
  findMember,
  generateGroupId,
  generateGroupKey,
  type GroupCredentials,
  type HistoryEntry,
  isDeviceId,
  type JoinAttempt,
  joinGroup,
  type JoinOptions,
  type LocalDevice,
  type LoggerPort,
  normalizePairingCode,
  type PairingHostSession,
  pairingSecret,
  parsePairingLink,
  type PeerAddress,
  PROTOCOL_VERSION,
  type ReadonlyStore,
  roleOf,
  signMembership,
  type StoragePort,
  type Unsubscribe,
} from '@clipbridge/core';
import { z } from 'zod';

import type { CredentialStore } from './credential-store';
import { createSimpleStore, type SimpleStore } from './simple-store';
import type {
  ActionResult,
  AppSnapshot,
  DiagnosticsView,
  HistoryItemView,
  HostingView,
  JoiningView,
  JoinRequestInput,
  SettingsPatch,
  SettingsView,
} from './view-types';

const SETTINGS_KEY = 'settings';
const PREVIEW_LENGTH = 300;
const DEFAULT_PORT = 47821;

const DEFAULT_SETTINGS: SettingsView = {
  sendEnabled: true,
  receiveEnabled: true,
  notifyOnReceive: true,
};

const storedSettingsSchema = z.object({
  sendEnabled: z.boolean(),
  receiveEnabled: z.boolean(),
  notifyOnReceive: z.boolean(),
});

export interface AppControllerDeps {
  readonly ports: EnginePorts;
  readonly credentials: CredentialStore;
  readonly storage: StoragePort;
  readonly logger: LoggerPort;
  readonly platform: DevicePlatform;
  readonly defaultDeviceName: string;
  readonly appVersion: string;
  readonly logFile: string;
  /** Renders a QR code (SVG markup) for the pairing link. */
  readonly renderQr: (text: string) => Promise<string>;
  /**
   * Small preview (data URL) of a received or copied image for the history list.
   * Optional; without it images show as "Image · 1.2 MB".
   */
  readonly makeThumbnail?: (
    image: Extract<ClipContent, { kind: 'image' }>,
  ) => Promise<string | null>;
  /** Asks the user to look at the app (a device wants to join). */
  readonly requestAttention?: (message: string) => void;
  readonly createEngine?: typeof createCoreEngine;
}

interface Hosting {
  readonly session: PairingHostSession;
  readonly qrSvg: string;
  readonly unsubscribe: Unsubscribe;
}

const notPairedStatus: AppSnapshot['status'] = {
  kind: 'NOT_PAIRED',
  connectedCount: 0,
  peerCount: 0,
  issue: null,
};
const idleJoin: JoiningView = { searching: false, hosts: [], state: 'idle', error: null };
const done: ActionResult<void> = { ok: true, value: undefined };

function fail(message: string, issue?: AppError): { ok: false; message: string; issue?: AppError } {
  return issue ? { ok: false, message, issue } : { ok: false, message };
}

export class AppController {
  private self: LocalDevice | null = null;
  private group: GroupCredentials | null = null;
  private engine: Engine | null = null;
  private settings: SettingsView = DEFAULT_SETTINGS;
  private startError: AppError | null = null;
  private engineSubscriptions: Unsubscribe[] = [];
  private hosting: Hosting | null = null;
  private stopSearch: Unsubscribe | null = null;
  private readonly pairingHosts = new Map<string, DiscoveredService>();
  private joinAttempt: JoinAttempt | null = null;
  private joinView: JoiningView = idleJoin;
  private readonly store: SimpleStore<AppSnapshot>;
  private initialized: Promise<void> | null = null;
  /** Thumbnails by clip id; null while one is being made or when none could be made. */
  private readonly thumbnails = new Map<string, string | null>();
  private applyToClipboardOverride = false;

  constructor(private readonly deps: AppControllerDeps) {
    this.store = createSimpleStore(this.buildSnapshot());
  }

  get snapshot(): ReadonlyStore<AppSnapshot> {
    return this.store;
  }

  /**
   * Loads identity and group and starts syncing. Safe to call more than once
   * (e.g. Android recreates the activity while the JS runtime keeps running):
   * later calls return the first call's promise instead of starting a second engine.
   */
  init(): Promise<void> {
    this.initialized ??= this.initialize();
    return this.initialized;
  }

  private async initialize(): Promise<void> {
    const { credentials, ports } = this.deps;
    this.self = await credentials.loadOrCreateDevice(
      this.deps.defaultDeviceName,
      this.deps.platform,
      ports.clock.now(),
    );
    this.settings = await this.loadSettings();
    this.group = await credentials.loadGroup();
    this.deps.logger.info('device ready', {
      deviceId: this.self.device.id,
      paired: this.group !== null,
    });
    if (this.group) await this.startEngine();
    this.publish();
  }

  async shutdown(): Promise<void> {
    this.stopJoinSearch();
    this.joinAttempt?.cancel();
    await this.stopEngine();
  }

  /** The app is visible again (phones) or the computer woke up: reconnect and catch up. */
  async resume(): Promise<void> {
    await this.engine?.resume();
  }

  /**
   * Phones: write received clips straight to the clipboard while the app is open
   * ("auto-copy"). Computers always do; this only changes phones.
   */
  setApplyToClipboard(apply: boolean): void {
    this.applyToClipboardOverride = apply;
    this.engine?.updateSettings({ applyToClipboard: this.applyToClipboard() });
  }

  async updateSettings(patch: SettingsPatch): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    this.engine?.updateSettings(patch);
    await this.deps.storage.set(SETTINGS_KEY, this.settings);
    this.publish();
  }

  async copyHistoryItem(id: string): Promise<ActionResult<void>> {
    const entry = this.engine?.history.get().find((candidate) => candidate.clip.id === id);
    if (!entry) return fail('This item is no longer in the history.');
    const written = await this.deps.ports.clipboard.write(entry.clip.content);
    return written.ok ? done : fail(written.error.message, written.error);
  }

  clearHistory(): void {
    this.engine?.clearHistory();
  }

  async diagnostics(): Promise<DiagnosticsView> {
    const self = this.requireSelf();
    return {
      deviceId: self.device.id,
      deviceName: this.selfName(),
      platform: self.device.platform,
      appVersion: this.deps.appVersion,
      coreVersion: CORE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      network: await this.deps.ports.networkInfo.current(),
      listenPort: this.engine?.listeningPort ?? null,
      logFile: this.deps.logFile,
      devices: this.engine?.peers.get() ?? [],
    };
  }

  // ------------------------------------------------------------------ group setup

  /** Starts a new group with only this computer in it. */
  async createGroup(): Promise<ActionResult<void>> {
    if (this.group) return fail('This device is already in a group.');
    const self = this.requireSelf();
    const { random, clock } = this.deps.ports;
    const membership = signMembership(
      {
        groupId: generateGroupId(random),
        version: 1,
        members: [self.device],
        updatedBy: self.device.id,
        updatedAt: clock.now(),
      },
      self.identity,
    );
    await this.adoptGroup({
      groupKey: generateGroupKey(random),
      epoch: 1,
      membership,
      previousKeys: [],
    });
    return done;
  }

  // ------------------------------------------------------------------ hosting ("Add device")

  async startHosting(): Promise<ActionResult<void>> {
    if (!this.engine) return fail('Create or join a group first.');
    if (this.hosting?.session.isActive) return done;
    const started = this.engine.startPairing();
    if (!started.ok) return fail(started.error.message, started.error);
    const session = started.value;
    const qrSvg = await this.deps.renderQr(session.qrLink);
    let lastKind = session.state.get().kind;
    const unsubscribe = session.state.subscribe((state) => {
      if (state.kind === 'awaiting-approval' && lastKind !== 'awaiting-approval') {
        this.deps.requestAttention?.(`"${state.request.name}" wants to join your devices`);
      }
      lastKind = state.kind;
      this.publish();
    });
    this.hosting?.unsubscribe();
    this.hosting = { session, qrSvg, unsubscribe };
    this.publish();
    return done;
  }

  stopHosting(): void {
    const hosting = this.hosting;
    if (!hosting) return;
    hosting.session.cancel();
    hosting.unsubscribe();
    this.hosting = null;
    this.publish();
  }

  approveJoin(): void {
    this.hosting?.session.approve();
  }

  denyJoin(): void {
    this.hosting?.session.deny();
  }

  // ------------------------------------------------------------------ joining

  async startJoinSearch(): Promise<void> {
    if (this.stopSearch || this.group) return;
    const browsing = await this.deps.ports.discovery.browse({
      onUp: (service) => {
        if (!service.pairingMode) {
          if (this.pairingHosts.delete(service.instanceId)) this.publishJoin();
          return;
        }
        this.pairingHosts.set(service.instanceId, service);
        this.publishJoin();
      },
      onDown: (instanceId) => {
        if (this.pairingHosts.delete(instanceId)) this.publishJoin();
      },
    });
    if (browsing.ok) this.stopSearch = browsing.value;
    this.publishJoin();
  }

  stopJoinSearch(): void {
    this.stopSearch?.();
    this.stopSearch = null;
    this.pairingHosts.clear();
    this.publishJoin();
  }

  /** Joins with a code typed by the user (computers). */
  async join(input: JoinRequestInput): Promise<ActionResult<void>> {
    if (this.group) return fail('This device is already in a group.');
    const code = normalizePairingCode(input.code);
    if (!code) return fail('Check the code: it has 12 letters and numbers, like K7QM-2XPA-9FRT.');
    const addresses = this.joinAddresses(input);
    if (!addresses.ok) return addresses;
    return this.runJoin({
      addresses: addresses.value,
      method: 'code',
      secret: pairingSecret('code', code),
    });
  }

  /** Joins with the text of a scanned pairing QR code (phones). */
  async joinWithLink(text: string): Promise<ActionResult<void>> {
    if (this.group) return fail('This device is already in a group.');
    const link = parsePairingLink(text.trim());
    if (!link)
      return fail(
        'This is not a ClipBridge pairing code. Scan the QR code shown under "Add device".',
      );
    return this.runJoin({
      addresses: link.hosts.map((host) => ({ host, port: link.port })),
      method: 'qr',
      secret: link.token,
      expectedHostSignPublicKey: link.hostSignPublicKey,
    });
  }

  /** Sends content the user picked explicitly (share sheet, "Send clipboard"). */
  sendClip(content: ClipContent): ActionResult<void> {
    if (!this.engine) return fail('Pair this device first.');
    const sent = this.engine.sendClip(content);
    return sent.ok ? done : fail(sent.error.message, sent.error);
  }

  /** Content of a history item, e.g. for a notification's Copy / Open action. */
  clipContent(id: string): ClipContent | null {
    return this.engine?.history.get().find((entry) => entry.clip.id === id)?.clip.content ?? null;
  }

  private async runJoin(options: Omit<JoinOptions, 'self'>): Promise<ActionResult<void>> {
    this.joinAttempt?.cancel();
    const attempt = joinGroup({ self: this.requireSelf(), ...options }, this.deps.ports);
    this.joinAttempt = attempt;
    const unsubscribe = attempt.state.subscribe((state) => {
      this.joinView = {
        ...this.joinView,
        state: state.kind,
        error: state.kind === 'failed' ? state.error : null,
      };
      this.publish();
    });
    this.joinView = { ...this.joinView, state: 'connecting', error: null };
    this.publish();

    const result = await attempt.result;
    unsubscribe();
    if (this.joinAttempt === attempt) this.joinAttempt = null;
    if (!result.ok) {
      this.joinView = { ...this.joinView, state: 'failed', error: result.error };
      this.publish();
      return fail(result.error.message, result.error);
    }
    this.stopJoinSearch();
    this.joinView = { ...idleJoin, state: 'joined' };
    await this.adoptGroup({ ...result.value, previousKeys: [] });
    return done;
  }

  cancelJoin(): void {
    this.joinAttempt?.cancel();
    this.joinAttempt = null;
    this.joinView = { ...this.joinView, state: 'idle', error: null };
    this.publish();
  }

  // ------------------------------------------------------------------ devices

  async renameDevice(id: string, name: string): Promise<ActionResult<void>> {
    if (!this.engine || !isDeviceId(id)) return fail('Unknown device.');
    const renamed = this.engine.renameMember(id, name);
    if (!renamed.ok) return fail('Names must be 1–64 characters.', renamed.error);
    const self = this.requireSelf();
    if (id === self.device.id) {
      await this.deps.credentials.saveDeviceName(name.trim(), self.device.addedAt);
    }
    return done;
  }

  removeDevice(id: string): ActionResult<void> {
    if (!this.engine || !isDeviceId(id)) return fail('Unknown device.');
    if (id === this.self?.device.id) {
      return fail('Use "Reset this computer" to remove this computer.');
    }
    const removed = this.engine.removeMember(id);
    return removed.ok ? done : fail(removed.error.message, removed.error);
  }

  /** Forgets the group on this computer. Other devices should remove it too. */
  async resetThisDevice(): Promise<ActionResult<void>> {
    this.stopHosting();
    await this.stopEngine();
    await this.deps.credentials.clearGroup();
    this.group = null;
    this.joinView = idleJoin;
    this.publish();
    return done;
  }

  // ------------------------------------------------------------------ internals

  private joinAddresses(input: JoinRequestInput): ActionResult<PeerAddress[]> {
    if (input.hostId) {
      const service = this.pairingHosts.get(input.hostId);
      if (!service) return fail('That computer is no longer showing a code.');
      return { ok: true, value: [...service.addresses] };
    }
    if (input.address) {
      const match = /^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/.exec(input.address.trim());
      if (!match?.[1]) return fail('Enter an address like 192.168.1.7 or 192.168.1.7:47821.');
      return {
        ok: true,
        value: [{ host: match[1], port: match[2] ? Number(match[2]) : DEFAULT_PORT }],
      };
    }
    const hosts = [...this.pairingHosts.values()];
    if (hosts.length === 1 && hosts[0]) return { ok: true, value: [...hosts[0].addresses] };
    return fail(
      hosts.length === 0
        ? 'No computer is showing a code on this network. Click "Add device" on a computer that is already set up.'
        : 'Several computers are showing a code. Choose the one you want to join.',
    );
  }

  private async adoptGroup(group: GroupCredentials): Promise<void> {
    await this.deps.credentials.saveGroup(group);
    this.group = group;
    await this.stopEngine();
    await this.startEngine();
    this.publish();
  }

  private async startEngine(): Promise<void> {
    const self = this.requireSelf();
    const group = this.requireGroup();
    const create = this.deps.createEngine ?? createCoreEngine;
    const engine = create({
      self,
      group,
      ports: this.deps.ports,
      settings: { ...this.settings, applyToClipboard: this.applyToClipboard() },
      onGroupChanged: (next) => {
        this.group = next;
        void this.deps.credentials.saveGroup(next);
        this.publish();
      },
    });
    this.engine = engine;
    const publish = (): void => {
      this.publish();
    };
    this.engineSubscriptions = [
      engine.status.subscribe(publish),
      engine.peers.subscribe(publish),
      engine.history.subscribe(publish),
      engine.lastSendError.subscribe(publish),
      engine.membership.subscribe(publish),
    ];
    const started = await engine.start();
    this.startError = started.ok ? null : started.error;
    if (!started.ok) this.deps.logger.error('engine did not start', { code: started.error.code });
  }

  private async stopEngine(): Promise<void> {
    this.hosting?.unsubscribe();
    this.hosting = null;
    for (const unsubscribe of this.engineSubscriptions) unsubscribe();
    this.engineSubscriptions = [];
    await this.engine?.stop();
    this.engine = null;
    this.startError = null;
  }

  /** Computers write received clips to the clipboard; phones only while auto-copy is on. */
  private applyToClipboard(): boolean {
    const self = this.requireSelf();
    return roleOf(self.device.platform) === 'hub' || this.applyToClipboardOverride;
  }

  private async loadSettings(): Promise<SettingsView> {
    const stored = storedSettingsSchema.safeParse(await this.deps.storage.get(SETTINGS_KEY));
    return stored.success ? stored.data : DEFAULT_SETTINGS;
  }

  private publishJoin(): void {
    this.joinView = {
      ...this.joinView,
      searching: this.stopSearch !== null,
      hosts: [...this.pairingHosts.values()].map((service) => ({
        id: service.instanceId,
        label: service.addresses.map((address) => address.host).join(', '),
      })),
    };
    this.publish();
  }

  private publish(): void {
    this.store.set(this.buildSnapshot());
  }

  private buildSnapshot(): AppSnapshot {
    const engine = this.engine;
    const status = this.startError
      ? { kind: 'ERROR' as const, connectedCount: 0, peerCount: 0, issue: this.startError }
      : (engine?.status.get() ?? notPairedStatus);
    const membership = engine?.membership.get() ?? this.group?.membership;
    return {
      status,
      devices: engine?.peers.get() ?? [],
      history: (engine?.history.get() ?? []).map((entry) => this.toHistoryItem(entry)),
      settings: this.settings,
      pairing: {
        paired: this.group !== null,
        selfId: this.self?.device.id ?? null,
        selfName: this.self ? this.selfName() : null,
        memberCount: membership?.members.length ?? 0,
        hosting: this.hostingView(),
        joining: this.joinView,
      },
      lastSendError: engine?.lastSendError.get() ?? null,
    };
  }

  private hostingView(): HostingView | null {
    const hosting = this.hosting;
    if (!hosting) return null;
    const { session } = hosting;
    const state = session.state.get();
    const link = /h=([^&,]+)[^&]*&p=(\d+)/.exec(session.qrLink);
    return {
      code: session.code,
      qrSvg: hosting.qrSvg,
      expiresAt: session.expiresAt,
      address: link ? `${link[1] ?? ''}:${link[2] ?? ''}` : '',
      state: state.kind,
      attemptsLeft: state.kind === 'waiting' ? state.attemptsLeft : 0,
      request:
        state.kind === 'awaiting-approval'
          ? { name: state.request.name, platform: state.request.platform }
          : null,
      addedDeviceName: state.kind === 'completed' ? state.device.name : null,
      error: state.kind === 'failed' ? state.error : null,
    };
  }

  private selfName(): string {
    const self = this.requireSelf();
    const membership = this.engine?.membership.get() ?? this.group?.membership;
    return (membership && findMember(membership, self.device.id)?.name) ?? self.device.name;
  }

  private toHistoryItem(entry: HistoryEntry): HistoryItemView {
    const { clip } = entry;
    const selfId = this.self?.device.id;
    const membership = this.engine?.membership.get();
    const sender = membership ? findMember(membership, clip.origin) : undefined;
    return {
      id: clip.id,
      kind: clip.content.kind,
      preview: previewOf(clip),
      thumbnail: this.thumbnailFor(clip),
      fromName: clip.origin === selfId ? 'This device' : (sender?.name ?? 'Unknown device'),
      fromThisDevice: clip.origin === selfId,
      createdAt: clip.createdAt,
      deliveredCount: entry.deliveredTo.length,
    };
  }

  /** Returns a cached thumbnail, starting to make one the first time an image is seen. */
  private thumbnailFor(clip: Clip): string | null {
    const { content } = clip;
    if (content.kind !== 'image' || !this.deps.makeThumbnail) return null;
    if (this.thumbnails.has(clip.id)) return this.thumbnails.get(clip.id) ?? null;
    this.thumbnails.set(clip.id, null);
    void this.deps
      .makeThumbnail(content)
      .catch(() => null)
      .then((thumbnail) => {
        if (!thumbnail) return;
        this.thumbnails.set(clip.id, thumbnail);
        this.publish();
      });
    return null;
  }

  private requireSelf(): LocalDevice {
    if (!this.self) throw new Error('AppController.init() has not completed');
    return this.self;
  }

  private requireGroup(): GroupCredentials {
    if (!this.group) throw new Error('Not paired');
    return this.group;
  }
}

function previewOf(clip: Clip): string {
  switch (clip.content.kind) {
    case 'url':
      return clip.content.url.slice(0, PREVIEW_LENGTH);
    case 'text':
      return clip.content.text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
    case 'image':
      return `Image · ${formatSize(clip.content.data.length)}`;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
