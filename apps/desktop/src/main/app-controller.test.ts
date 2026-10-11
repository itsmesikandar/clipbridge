import type { SecureStoragePort, StoragePort } from '@clipbridge/core';
import {
  FakeClipboard,
  FakeClock,
  FakeNotifier,
  InMemoryNetwork,
  MemoryLogger,
  SeededRandom,
} from '@clipbridge/core/testing';
import { describe, expect, it } from 'vitest';

import { AppController } from './app-controller';
import { CredentialStore } from './identity/credential-store';

class MemoryStorage implements StoragePort {
  readonly data = new Map<string, string>();
  get(key: string): Promise<unknown> {
    const value = this.data.get(key);
    return Promise.resolve(value === undefined ? undefined : (JSON.parse(value) as unknown));
  }
  set(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value));
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

class MemorySecureStorage implements SecureStoragePort {
  readonly data = new Map<string, Uint8Array>();
  get(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }
  set(key: string, value: Uint8Array): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
}

const HOME = '192.168.1.0/24';

function world() {
  const clock = new FakeClock();
  const network = new InMemoryNetwork();
  let seed = 1;

  function computer(
    name: string,
    options: { devMode?: boolean; storage?: MemoryStorage; secure?: MemorySecureStorage } = {},
  ) {
    const node = network.createNode(name, { subnet: HOME });
    const storage = options.storage ?? new MemoryStorage();
    const secure = options.secure ?? new MemorySecureStorage();
    const random = new SeededRandom(seed++);
    const clipboard = new FakeClipboard();
    const controller = new AppController({
      ports: {
        clock,
        random,
        logger: new MemoryLogger(),
        transport: node.transport,
        discovery: node.discovery,
        networkInfo: node.networkInfo,
        clipboard,
        notifier: new FakeNotifier(),
      },
      credentials: new CredentialStore(storage, secure, random),
      storage,
      logger: new MemoryLogger(),
      platform: 'windows',
      defaultDeviceName: name,
      appVersion: '0.1.0',
      logFile: 'main.log',
      devMode: options.devMode ?? true,
    });
    return { controller, clipboard, storage, secure, node };
  }

  return { clock, network, computer };
}

async function pair(a: AppController, b: AppController): Promise<void> {
  expect((await a.dev.createGroup()).ok).toBe(true);
  const invite = await a.dev.exportInvite();
  if (!invite.ok) throw new Error(invite.message);
  const reply = await b.dev.importInvite(invite.value);
  if (!reply.ok) throw new Error(reply.message);
  expect((await a.dev.importReply(reply.value)).ok).toBe(true);
}

describe('AppController with developer pairing', () => {
  it('starts unpaired, pairs two computers and syncs a copy', async () => {
    const { clock, computer } = world();
    const laptop = computer('Laptop');
    const desktop = computer('Desktop');
    await laptop.controller.init();
    await desktop.controller.init();
    expect(laptop.controller.snapshot.get().status.kind).toBe('NOT_PAIRED');
    expect(laptop.controller.snapshot.get().pairing).toMatchObject({
      paired: false,
      devMode: true,
    });

    await pair(laptop.controller, desktop.controller);
    await clock.advance(1_000);

    const laptopState = laptop.controller.snapshot.get();
    expect(laptopState.status).toMatchObject({ kind: 'CONNECTED', connectedCount: 1 });
    expect(laptopState.pairing.memberCount).toBe(2);
    expect(desktop.controller.snapshot.get().status.kind).toBe('CONNECTED');

    laptop.clipboard.userCopies({ kind: 'url', url: 'https://example.com' });
    await clock.advance(100);
    expect(desktop.clipboard.writes).toEqual([{ kind: 'url', url: 'https://example.com' }]);

    const [item] = desktop.controller.snapshot.get().history;
    expect(item).toMatchObject({
      kind: 'url',
      preview: 'https://example.com',
      fromName: 'Laptop',
      fromThisDevice: false,
    });
    const [own] = laptop.controller.snapshot.get().history;
    expect(own).toMatchObject({ fromName: 'This device', fromThisDevice: true, deliveredCount: 1 });

    await laptop.controller.shutdown();
    await desktop.controller.shutdown();
  });

  it('keeps identity and group across restarts', async () => {
    const { clock, computer } = world();
    const laptop = computer('Laptop');
    const desktop = computer('Desktop');
    await laptop.controller.init();
    await desktop.controller.init();
    await pair(laptop.controller, desktop.controller);
    const before = await desktop.controller.diagnostics();
    await desktop.controller.shutdown();

    const restarted = computer('Desktop-2', { storage: desktop.storage, secure: desktop.secure });
    await restarted.controller.init();
    await clock.advance(1_000);
    const after = await restarted.controller.diagnostics();
    expect(after.deviceId).toBe(before.deviceId);
    expect(after.deviceName).toBe('Desktop'); // name stored on first launch
    expect(restarted.controller.snapshot.get().pairing.paired).toBe(true);
    expect([...desktop.secure.data.keys()].sort()).toEqual(['group-key', 'identity']);
  });

  it('persists settings and applies them', async () => {
    const { computer } = world();
    const laptop = computer('Laptop');
    await laptop.controller.init();
    await laptop.controller.updateSettings({ notifyOnReceive: false });
    expect(laptop.controller.snapshot.get().settings).toEqual({
      sendEnabled: true,
      receiveEnabled: true,
      notifyOnReceive: false,
    });
    expect(JSON.parse(laptop.storage.data.get('settings') ?? '{}')).toMatchObject({
      notifyOnReceive: false,
    });
  });

  it('copies a history item back to the clipboard', async () => {
    const { clock, computer } = world();
    const laptop = computer('Laptop');
    const desktop = computer('Desktop');
    await laptop.controller.init();
    await desktop.controller.init();
    await pair(laptop.controller, desktop.controller);
    await clock.advance(1_000);
    laptop.clipboard.userCopies({ kind: 'text', text: 'first' });
    await clock.advance(10);
    laptop.clipboard.userCopies({ kind: 'text', text: 'second' });
    await clock.advance(100);

    const first = desktop.controller.snapshot
      .get()
      .history.find((item) => item.preview === 'first');
    expect(await desktop.controller.copyHistoryItem(first?.id ?? '')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(desktop.clipboard.content).toEqual({ kind: 'text', text: 'first' });
    expect((await desktop.controller.copyHistoryItem('missing')).ok).toBe(false);
  });

  it('explains bad input and blocks dev pairing outside dev mode', async () => {
    const { computer } = world();
    const laptop = computer('Laptop');
    const locked = computer('Locked', { devMode: false });
    await laptop.controller.init();
    await locked.controller.init();

    expect(await laptop.controller.dev.importInvite('nonsense')).toEqual({
      ok: false,
      message: 'This is not a valid invite.',
    });
    expect(await laptop.controller.dev.exportInvite()).toEqual({
      ok: false,
      message: 'Create or join a group first.',
    });
    expect(await locked.controller.dev.createGroup()).toEqual({
      ok: false,
      message: 'Not available.',
    });

    await laptop.controller.dev.createGroup();
    expect(await laptop.controller.dev.importReply('nonsense')).toEqual({
      ok: false,
      message: 'This is not a valid reply.',
    });
    expect((await laptop.controller.dev.leaveGroup()).ok).toBe(true);
    expect(laptop.controller.snapshot.get().pairing.paired).toBe(false);
  });

  it('shows PORT_IN_USE when the network service cannot start', async () => {
    const { computer } = world();
    const laptop = computer('Laptop');
    laptop.node.failListen = true;
    await laptop.controller.init();
    await laptop.controller.dev.createGroup();
    expect(laptop.controller.snapshot.get().status).toMatchObject({
      kind: 'ERROR',
      issue: { code: 'PORT_IN_USE' },
    });
  });
});
