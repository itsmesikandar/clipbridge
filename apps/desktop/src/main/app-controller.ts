/**
 * Application layer of the desktop main process: owns the engine lifecycle,
 * persists identity/group/settings and turns engine state into the snapshot
 * the UI renders. Has no Electron imports, so it is tested with core's
 * in-memory network.
 */

import {
  type AppError,
  type Clip,
  CORE_VERSION,
  createEngine as createCoreEngine,
  type DevicePlatform,
  type Engine,
  type EnginePorts,
  findMember,
  type HistoryEntry,
  type LocalDevice,
  type LoggerPort,
  PROTOCOL_VERSION,
  type ReadonlyStore,
  type StoragePort,
  type Unsubscribe,
} from '@clipbridge/core';
import { z } from 'zod';

import type {
  AppSnapshot,
  DiagnosticsView,
  HistoryItemView,
  IpcResult,
  SettingsPatch,
  SettingsView,
} from '../shared/ipc-contract';
import { acceptInvite, acceptReply, createDevGroup, encodeInvite } from './dev/dev-pairing';
import type { CredentialStore, StoredGroup } from './identity/credential-store';
import { createSimpleStore, type SimpleStore } from './simple-store';

const SETTINGS_KEY = 'settings';
const PREVIEW_LENGTH = 300;

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
  readonly devMode: boolean;
  readonly createEngine?: typeof createCoreEngine;
}

const notPairedStatus: AppSnapshot['status'] = {
  kind: 'NOT_PAIRED',
  connectedCount: 0,
  peerCount: 0,
  issue: null,
};

export class AppController {
  private self: LocalDevice | null = null;
  private group: StoredGroup | null = null;
  private engine: Engine | null = null;
  private settings: SettingsView = DEFAULT_SETTINGS;
  private startError: AppError | null = null;
  private engineSubscriptions: Unsubscribe[] = [];
  private readonly store: SimpleStore<AppSnapshot>;

  constructor(private readonly deps: AppControllerDeps) {
    this.store = createSimpleStore(this.buildSnapshot());
  }

  get snapshot(): ReadonlyStore<AppSnapshot> {
    return this.store;
  }

  async init(): Promise<void> {
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
    await this.stopEngine();
  }

  async updateSettings(patch: SettingsPatch): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    this.engine?.updateSettings(patch);
    await this.deps.storage.set(SETTINGS_KEY, this.settings);
    this.publish();
  }

  async copyHistoryItem(id: string): Promise<IpcResult<void>> {
    const entry = this.engine?.history.get().find((candidate) => candidate.clip.id === id);
    if (!entry) return { ok: false, message: 'This item is no longer in the history.' };
    const written = await this.deps.ports.clipboard.write(entry.clip.content);
    return written.ok
      ? { ok: true, value: undefined }
      : { ok: false, message: written.error.message };
  }

  clearHistory(): void {
    this.engine?.clearHistory();
  }

  async diagnostics(): Promise<DiagnosticsView> {
    const self = this.requireSelf();
    return {
      deviceId: self.device.id,
      deviceName: self.device.name,
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

  // ------------------------------------------------------------------ dev pairing (M2 only)

  readonly dev = {
    createGroup: async (): Promise<IpcResult<void>> => {
      const guard = this.devGuard(false);
      if (guard) return guard;
      await this.adoptGroup(
        createDevGroup(this.requireSelf(), this.deps.ports.random, this.deps.ports.clock.now()),
      );
      return { ok: true, value: undefined };
    },
    exportInvite: (): Promise<IpcResult<string>> => {
      const guard = this.devGuard(true);
      if (guard) return Promise.resolve(guard);
      return Promise.resolve({ ok: true, value: encodeInvite(this.requireGroup()) });
    },
    importInvite: async (text: string): Promise<IpcResult<string>> => {
      const guard = this.devGuard(false);
      if (guard) return guard;
      const accepted = acceptInvite(text, this.requireSelf(), this.deps.ports.clock.now());
      if (!accepted.ok) return { ok: false, message: accepted.error };
      await this.adoptGroup(accepted.value.group);
      return { ok: true, value: accepted.value.reply };
    },
    importReply: async (text: string): Promise<IpcResult<void>> => {
      const guard = this.devGuard(true);
      if (guard) return guard;
      const accepted = acceptReply(
        text,
        this.requireGroup(),
        this.requireSelf(),
        this.deps.ports.clock.now(),
      );
      if (!accepted.ok) return { ok: false, message: accepted.error };
      await this.adoptGroup(accepted.value);
      return { ok: true, value: undefined };
    },
    leaveGroup: async (): Promise<IpcResult<void>> => {
      if (!this.deps.devMode) return { ok: false, message: 'Not available.' };
      await this.stopEngine();
      await this.deps.credentials.clearGroup();
      this.group = null;
      this.publish();
      return { ok: true, value: undefined };
    },
  };

  // ------------------------------------------------------------------ internals

  private devGuard(mustBePaired: boolean): { ok: false; message: string } | null {
    if (!this.deps.devMode) return { ok: false, message: 'Not available.' };
    if (mustBePaired && !this.group) return { ok: false, message: 'Create or join a group first.' };
    if (!mustBePaired && this.group)
      return { ok: false, message: 'Leave the current group first.' };
    return null;
  }

  private async adoptGroup(group: StoredGroup): Promise<void> {
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
      settings: { ...this.settings, applyToClipboard: true },
      onMembershipChanged: (membership) => {
        this.group = { ...group, membership };
        void this.deps.credentials.saveMembership(group.groupId, group.epoch, membership);
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
    ];
    const started = await engine.start();
    this.startError = started.ok ? null : started.error;
    if (!started.ok) {
      this.deps.logger.error('engine did not start', { code: started.error.code });
    }
  }

  private async stopEngine(): Promise<void> {
    for (const unsubscribe of this.engineSubscriptions) unsubscribe();
    this.engineSubscriptions = [];
    await this.engine?.stop();
    this.engine = null;
    this.startError = null;
  }

  private async loadSettings(): Promise<SettingsView> {
    const stored = storedSettingsSchema.safeParse(await this.deps.storage.get(SETTINGS_KEY));
    return stored.success ? stored.data : DEFAULT_SETTINGS;
  }

  private publish(): void {
    this.store.set(this.buildSnapshot());
  }

  private buildSnapshot(): AppSnapshot {
    const engine = this.engine;
    const status = this.startError
      ? { kind: 'ERROR' as const, connectedCount: 0, peerCount: 0, issue: this.startError }
      : (engine?.status.get() ?? notPairedStatus);
    return {
      status,
      devices: engine?.peers.get() ?? [],
      history: (engine?.history.get() ?? []).map((entry) => this.toHistoryItem(entry)),
      settings: this.settings,
      pairing: {
        paired: this.group !== null,
        devMode: this.deps.devMode,
        groupId: this.group?.groupId ?? null,
        memberCount: this.group?.membership.members.length ?? 0,
      },
      lastSendError: engine?.lastSendError.get() ?? null,
    };
  }

  private toHistoryItem(entry: HistoryEntry): HistoryItemView {
    const { clip } = entry;
    const selfId = this.self?.device.id;
    const sender = this.group ? findMember(this.group.membership, clip.origin) : undefined;
    return {
      id: clip.id,
      kind: clip.content.kind,
      preview: previewOf(clip),
      fromName: clip.origin === selfId ? 'This device' : (sender?.name ?? 'Unknown device'),
      fromThisDevice: clip.origin === selfId,
      createdAt: clip.createdAt,
      deliveredCount: entry.deliveredTo.length,
    };
  }

  private requireSelf(): LocalDevice {
    if (!this.self) throw new Error('AppController.init() has not completed');
    return this.self;
  }

  private requireGroup(): StoredGroup {
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
      return 'Image';
  }
}
