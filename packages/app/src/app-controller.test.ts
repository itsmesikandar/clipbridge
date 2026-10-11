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
import { CredentialStore, decodeEpochKeys, encodeEpochKeys } from './credential-store';

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
    options: {
      storage?: MemoryStorage;
      secure?: MemorySecureStorage;
      nodeName?: string;
      platform?: 'windows' | 'android';
    } = {},
  ) {
    const node = network.createNode(options.nodeName ?? name, { subnet: HOME });
    const storage = options.storage ?? new MemoryStorage();
    const secure = options.secure ?? new MemorySecureStorage();
    const random = new SeededRandom(seed++);
    const clipboard = new FakeClipboard();
    const attention: string[] = [];
    const controller = new AppController({
      ports: {
        clock,
        random,
        logger: new MemoryLogger(),
        transport: node.transport,
        discovery: node.discovery,
        networkInfo: node.networkInfo,
        clipboard: options.platform === 'android' ? clipboard.asPhoneClipboard() : clipboard,
        notifier: new FakeNotifier(),
      },
      credentials: new CredentialStore(storage, secure, random),
      storage,
      logger: new MemoryLogger(),
      platform: options.platform ?? 'windows',
      defaultDeviceName: name,
      appVersion: '0.1.0',
      logFile: 'main.log',
      renderQr: (text) => Promise.resolve(`<svg data-link="${text}"/>`),
      requestAttention: (message) => attention.push(message),
    });
    return { controller, clipboard, storage, secure, node, attention };
  }

  return { clock, network, computer };
}

type Computer = ReturnType<ReturnType<typeof world>['computer']>;

/** Host shows a code; joiner finds it and enters it; host clicks Allow. */
async function pair(host: Computer, joiner: Computer, clock: FakeClock): Promise<void> {
  if (!host.controller.snapshot.get().pairing.paired) {
    expect((await host.controller.createGroup()).ok).toBe(true);
  }
  expect((await host.controller.startHosting()).ok).toBe(true);
  const code = host.controller.snapshot.get().pairing.hosting?.code ?? '';
  await joiner.controller.startJoinSearch();
  await clock.advance(10);
  expect(joiner.controller.snapshot.get().pairing.joining.hosts).toHaveLength(1);

  const joining = joiner.controller.join({ code: code.toLowerCase(), hostId: null, address: null });
  await clock.advance(50);
  expect(joiner.controller.snapshot.get().pairing.joining.state).toBe('awaiting-approval');
  host.controller.approveJoin();
  expect(await joining).toEqual({ ok: true, value: undefined });
  await clock.advance(1_000);
}

describe('AppController pairing', () => {
  it('pairs two computers by code and syncs', async () => {
    const { clock, computer } = world();
    const laptop = computer('Laptop');
    const desktop = computer('Desktop');
    await laptop.controller.init();
    await desktop.controller.init();
    expect(laptop.controller.snapshot.get().status.kind).toBe('NOT_PAIRED');

    await pair(laptop, desktop, clock);

    expect(laptop.attention).toEqual(['"Desktop" wants to join your devices']);
    const hosting = laptop.controller.snapshot.get().pairing.hosting;
    expect(hosting).toMatchObject({
      state: 'completed',
      addedDeviceName: 'Desktop',
      address: '192.168.1.10:47821',
    });
    expect(hosting?.qrSvg).toContain('clipbridge://pair?v=1');
    laptop.controller.stopHosting();

    for (const side of [laptop, desktop]) {
      expect(side.controller.snapshot.get().status).toMatchObject({
        kind: 'CONNECTED',
        connectedCount: 1,
      });
      expect(side.controller.snapshot.get().pairing.memberCount).toBe(2);
    }
    expect(desktop.controller.snapshot.get().pairing.joining.state).toBe('joined');

    laptop.clipboard.userCopies({ kind: 'url', url: 'https://example.com' });
    await clock.advance(100);
    expect(desktop.clipboard.writes).toEqual([{ kind: 'url', url: 'https://example.com' }]);
    const [item] = desktop.controller.snapshot.get().history;
    expect(item).toMatchObject({ kind: 'url', fromName: 'Laptop', fromThisDevice: false });
  });

  it('joins with a manually typed address when discovery finds nothing', async () => {
    const { clock, computer } = world();
    const laptop = computer('Laptop');
    const desktop = computer('Desktop');
    await laptop.controller.init();
    await desktop.controller.init();
    await laptop.controller.createGroup();
    await laptop.controller.startHosting();
    const code = laptop.controller.snapshot.get().pairing.hosting?.code ?? '';

    // Discovery not started: no hosts known, so the address is required.
    expect(await desktop.controller.join({ code, hostId: null, address: null })).toMatchObject({
      ok: false,
    });
    expect(
      await desktop.controller.join({ code, hostId: null, address: 'not an ip' }),
    ).toMatchObject({
      ok: false,
      message: 'Enter an address like 192.168.1.7 or 192.168.1.7:47821.',
    });

    // In-memory hosts are named, so use a numeric-looking alias for the laptop.
    const joining = desktop.controller.join({ code, hostId: null, address: '10.0.0.1:47821' });
    await clock.advance(50);
    expect(await joining).toMatchObject({ ok: false, issue: { code: 'PEER_UNREACHABLE' } });
    expect(desktop.controller.snapshot.get().pairing.joining.state).toBe('failed');
  });

  it('explains a wrong code, a denial and invalid input', async () => {
    const { clock, computer } = world();
    const laptop = computer('Laptop');
    const desktop = computer('Desktop');
    await laptop.controller.init();
    await desktop.controller.init();

    expect((await laptop.controller.startHosting()).ok).toBe(false); // no group yet
    expect(
      await desktop.controller.join({ code: '123', hostId: null, address: null }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining('12 letters') as string,
    });

    await laptop.controller.createGroup();
    expect((await laptop.controller.createGroup()).ok).toBe(false);
    await laptop.controller.startHosting();
    await desktop.controller.startJoinSearch();
    await clock.advance(10);

    const wrong = desktop.controller.join({ code: 'AAAA-AAAA-AAAA', hostId: null, address: null });
    await clock.advance(50);
    expect(await wrong).toMatchObject({ ok: false, issue: { code: 'PAIRING_CODE_INVALID' } });
    expect(laptop.controller.snapshot.get().pairing.hosting).toMatchObject({
      state: 'waiting',
      attemptsLeft: 2,
    });

    const code = laptop.controller.snapshot.get().pairing.hosting?.code ?? '';
    const denied = desktop.controller.join({ code, hostId: null, address: null });
    await clock.advance(50);
    laptop.controller.denyJoin();
    expect(await denied).toMatchObject({ ok: false, issue: { code: 'PAIRING_REJECTED' } });
    expect(desktop.controller.snapshot.get().pairing.paired).toBe(false);
  });
});

describe('AppController on a phone', () => {
  it('joins by scanning the QR code and sends a shared link', async () => {
    const { clock, computer } = world();
    const laptop = computer('Laptop');
    const phone = computer('Pixel', { platform: 'android' });
    await laptop.controller.init();
    await phone.controller.init();
    await laptop.controller.createGroup();
    await laptop.controller.startHosting();
    const qr =
      /data-link="([^"]+)"/.exec(
        laptop.controller.snapshot.get().pairing.hosting?.qrSvg ?? '',
      )?.[1] ?? '';

    expect(await phone.controller.joinWithLink('https://example.com')).toMatchObject({ ok: false });
    const joining = phone.controller.joinWithLink(qr);
    await clock.advance(50);
    laptop.controller.approveJoin();
    expect(await joining).toEqual({ ok: true, value: undefined });
    await clock.advance(1_000);
    expect(phone.controller.snapshot.get().status).toMatchObject({
      kind: 'CONNECTED',
      connectedCount: 1,
    });

    expect(phone.controller.sendClip({ kind: 'url', url: 'https://example.com/shared' })).toEqual({
      ok: true,
      value: undefined,
    });
    await clock.advance(100);
    expect(laptop.clipboard.content).toEqual({ kind: 'url', url: 'https://example.com/shared' });

    laptop.clipboard.userCopies({ kind: 'text', text: 'to phone' });
    await clock.advance(100);
    const [latest] = phone.controller.snapshot.get().history;
    expect(phone.controller.clipContent(latest?.id ?? '')).toEqual({
      kind: 'text',
      text: 'to phone',
    });
    expect(phone.clipboard.writes).toEqual([]); // phones wait for the user to tap Copy

    // Auto-copy while the app is open.
    phone.controller.setApplyToClipboard(true);
    laptop.clipboard.userCopies({ kind: 'text', text: 'auto' });
    await clock.advance(100);
    expect(phone.clipboard.writes).toEqual([{ kind: 'text', text: 'auto' }]);
    phone.controller.setApplyToClipboard(false);
    laptop.clipboard.userCopies({ kind: 'text', text: 'not auto' });
    await clock.advance(100);
    expect(phone.clipboard.writes).toHaveLength(1);
    await phone.controller.resume();
    await clock.advance(100);
    expect(phone.controller.snapshot.get().status.kind).toBe('CONNECTED');
    expect(phone.controller.sendClip({ kind: 'text', text: '' }).ok).toBe(false);
  });
});

describe('AppController devices', () => {
  it('renames and removes devices; the removed one is told', async () => {
    const { clock, computer } = world();
    const laptop = computer('Laptop');
    const desktop = computer('Desktop');
    const spare = computer('Spare');
    for (const side of [laptop, desktop, spare]) await side.controller.init();
    await pair(laptop, desktop, clock);
    laptop.controller.stopHosting();
    await pair(laptop, spare, clock);
    laptop.controller.stopHosting();
    expect(desktop.controller.snapshot.get().pairing.memberCount).toBe(3);

    const spareId = spare.controller.snapshot.get().pairing.selfId ?? '';
    expect((await desktop.controller.renameDevice(spareId, 'Old laptop')).ok).toBe(true);
    await clock.advance(100);
    expect(laptop.controller.snapshot.get().devices.map((d) => d.name)).toContain('Old laptop');

    expect(
      desktop.controller.removeDevice(desktop.controller.snapshot.get().pairing.selfId ?? '').ok,
    ).toBe(false);
    expect(desktop.controller.removeDevice(spareId).ok).toBe(true);
    await clock.advance(3_000);
    expect(spare.controller.snapshot.get().status.issue?.code).toBe('REMOVED_FROM_GROUP');
    expect(laptop.controller.snapshot.get().pairing.memberCount).toBe(2);
    expect(laptop.controller.snapshot.get().status.kind).toBe('CONNECTED');

    // The rotated key and the previous one are stored encrypted.
    const previous = decodeEpochKeys(laptop.secure.data.get('previous-keys') ?? new Uint8Array(0));
    expect(previous.map((entry) => entry.epoch)).toEqual([1]);
  });

  it('renames this computer and keeps the name after a restart', async () => {
    const { clock, computer } = world();
    const laptop = computer('Laptop');
    await laptop.controller.init();
    await laptop.controller.createGroup();
    const selfId = laptop.controller.snapshot.get().pairing.selfId ?? '';
    expect((await laptop.controller.renameDevice(selfId, ' Work laptop ')).ok).toBe(true);
    expect(laptop.controller.snapshot.get().pairing.selfName).toBe('Work laptop');
    await laptop.controller.shutdown();

    const again = computer('Laptop-2', { storage: laptop.storage, secure: laptop.secure });
    await again.controller.init();
    await clock.advance(10);
    expect(again.controller.snapshot.get().pairing).toMatchObject({
      paired: true,
      selfName: 'Work laptop',
    });
    expect((await again.controller.diagnostics()).deviceId).toBe(selfId);
  });

  it('reset forgets the group on this computer only', async () => {
    const { clock, computer } = world();
    const laptop = computer('Laptop');
    const desktop = computer('Desktop');
    await laptop.controller.init();
    await desktop.controller.init();
    await pair(laptop, desktop, clock);
    expect((await desktop.controller.resetThisDevice()).ok).toBe(true);
    expect(desktop.controller.snapshot.get().pairing.paired).toBe(false);
    expect([...desktop.secure.data.keys()]).toEqual(['identity']);
    expect(laptop.controller.snapshot.get().pairing.memberCount).toBe(2);
  });
});

describe('AppController basics', () => {
  it('starts only one engine when init() is called again', async () => {
    const { clock, computer } = world();
    const laptop = computer('Laptop');
    const desktop = computer('Desktop');
    await laptop.controller.init();
    await desktop.controller.init();
    await pair(laptop, desktop, clock);
    await Promise.all([desktop.controller.init(), desktop.controller.init()]);
    await clock.advance(5_000);
    expect(laptop.node.connections.size).toBe(1);
    expect(desktop.controller.snapshot.get().status.kind).toBe('CONNECTED');
  });

  it('persists settings', async () => {
    const { computer } = world();
    const laptop = computer('Laptop');
    await laptop.controller.init();
    await laptop.controller.updateSettings({ notifyOnReceive: false });
    expect(laptop.controller.snapshot.get().settings.notifyOnReceive).toBe(false);
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
    await pair(laptop, desktop, clock);
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

  it('shows PORT_IN_USE when the network service cannot start', async () => {
    const { computer } = world();
    const laptop = computer('Laptop');
    laptop.node.failListen = true;
    await laptop.controller.init();
    await laptop.controller.createGroup();
    expect(laptop.controller.snapshot.get().status).toMatchObject({
      kind: 'ERROR',
      issue: { code: 'PORT_IN_USE' },
    });
  });

  it('encodes previous keys compactly and rejects damaged data', () => {
    const keys = [
      { epoch: 3, key: new Uint8Array(32).fill(3) },
      { epoch: 2, key: new Uint8Array(32).fill(2) },
    ];
    expect(decodeEpochKeys(encodeEpochKeys(keys))).toEqual(keys);
    expect(decodeEpochKeys(new Uint8Array(5))).toEqual([]);
  });
});
