import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Clip, ClipboardChange, DeviceId, DeviceRecord } from '@clipbridge/core';
import { afterEach, describe, expect, it } from 'vitest';

import { toDiscoveredService } from './bonjour-discovery';
import {
  ElectronClipboard,
  IMAGE_POLL_EVERY,
  IMAGE_POLL_MAX_EVERY,
  rawFormat,
  type SystemClipboard,
} from './electron-clipboard';
import { describeReceivedClip } from './electron-notifier';
import { EncryptedFileStorage, JsonFileStorage, type SecretCipher } from './file-storage';
import { NodeNetworkInfo, pickLanSnapshot } from './node-network-info';

const iface = (address: string, netmask = '255.255.255.0', internal = false) => ({
  address,
  netmask,
  family: 'IPv4' as const,
  mac: '00:00:00:00:00:00',
  internal,
  cidr: null,
});

describe('pickLanSnapshot', () => {
  it('prefers the Wi-Fi LAN over virtual adapters and loopback', () => {
    expect(
      pickLanSnapshot({
        'vEthernet (WSL)': [iface('172.24.160.1', '255.255.240.0')],
        'Loopback Pseudo-Interface 1': [iface('127.0.0.1', '255.0.0.0', true)],
        'Wi-Fi': [iface('192.168.1.42')],
      }),
    ).toEqual({ kind: 'wifi', ipv4: '192.168.1.42', subnet: '192.168.1.0/24' });
  });

  it('detects Ethernet and computes the subnet from the netmask', () => {
    expect(pickLanSnapshot({ Ethernet: [iface('10.1.2.3', '255.255.0.0')] })).toEqual({
      kind: 'ethernet',
      ipv4: '10.1.2.3',
      subnet: '10.1.0.0/16',
    });
  });

  it('reports no network when only loopback, link-local or VPN adapters exist', () => {
    expect(
      pickLanSnapshot({
        lo: [iface('127.0.0.1', '255.0.0.0', true)],
        'Wi-Fi': [iface('169.254.10.10', '255.255.0.0')],
        Tailscale: [iface('100.64.0.5', '255.192.0.0')],
      }),
    ).toEqual({ kind: 'none', ipv4: null, subnet: null });
  });
});

describe('NodeNetworkInfo', () => {
  it('notifies listeners only when the network actually changes', async () => {
    let current: Record<string, ReturnType<typeof iface>[]> = { 'Wi-Fi': [iface('192.168.1.5')] };
    const info = new NodeNetworkInfo(() => current);
    const seen: (string | null)[] = [];
    const unsubscribe = info.onChange((snapshot) => seen.push(snapshot.subnet));
    info.refresh();
    current = { 'Wi-Fi': [iface('10.0.0.7')] };
    info.refresh();
    info.refresh();
    unsubscribe();
    expect(seen).toEqual(['10.0.0.0/24']);
    expect(await info.localNetworkPermission()).toBe('granted');
  });
});

class FakeSystemClipboard implements SystemClipboard {
  text = '';
  image: Uint8Array | null = null;
  /** Simulates the OS re-encoding images it is given. */
  reencode = false;
  formats = new Set<string>();
  failReads = false;

  readImagePng(): Promise<Uint8Array | null> {
    return Promise.resolve(this.image);
  }
  writeImage(_mime: 'image/png' | 'image/jpeg', data: Uint8Array): Promise<void> {
    this.text = '';
    this.image = this.reencode ? Uint8Array.from([...data, 0]) : data;
    return Promise.resolve();
  }

  readText(): Promise<string> {
    return this.failReads ? Promise.reject(new Error('locked')) : Promise.resolve(this.text);
  }
  writeText(text: string): Promise<void> {
    this.text = text;
    return Promise.resolve();
  }
  has(mimetype: string): Promise<boolean> {
    return Promise.resolve(this.formats.has(mimetype));
  }
}

describe('ElectronClipboard', () => {
  async function watched(initial = 'already there') {
    const system = new FakeSystemClipboard();
    system.text = initial;
    const clipboard = new ElectronClipboard(system, 60_000);
    const changes: ClipboardChange[] = [];
    const unsubscribe = clipboard.watch((change) => changes.push(change));
    await Promise.resolve();
    await Promise.resolve();
    return { system, clipboard, changes, unsubscribe };
  }

  it('does not send what was on the clipboard at startup', async () => {
    const { clipboard, changes, unsubscribe } = await watched();
    await clipboard.poll();
    expect(changes).toEqual([]);
    unsubscribe();
  });

  it('reports new copies, classifying URLs', async () => {
    const { system, clipboard, changes, unsubscribe } = await watched();
    system.text = 'https://example.com/a';
    await clipboard.poll();
    system.text = 'plain words';
    await clipboard.poll();
    await clipboard.poll(); // unchanged
    expect(changes.map((change) => change.content)).toEqual([
      { kind: 'url', url: 'https://example.com/a' },
      { kind: 'text', text: 'plain words' },
    ]);
    unsubscribe();
  });

  it('does not report its own writes', async () => {
    const { clipboard, changes, unsubscribe } = await watched();
    await clipboard.write({ kind: 'text', text: 'from the network' });
    await clipboard.poll();
    expect(changes).toEqual([]);
    unsubscribe();
  });

  it('marks password-manager copies as sensitive', async () => {
    const { system, clipboard, changes, unsubscribe } = await watched();
    system.formats.add(rawFormat('org.nspasteboard.ConcealedType'));
    system.text = 'hunter2';
    await clipboard.poll();
    expect(changes[0]?.sensitive).toBe(true);
    unsubscribe();
  });

  it('survives a locked clipboard', async () => {
    const { system, clipboard, changes, unsubscribe } = await watched();
    system.failReads = true;
    await clipboard.poll();
    expect(changes).toEqual([]);
    unsubscribe();
  });

  const pollTimes = async (clipboard: ElectronClipboard, times: number): Promise<void> => {
    for (let i = 0; i < times; i++) await clipboard.poll();
  };

  it('reports a copied image (screenshot) when there is no text', async () => {
    const { system, clipboard, changes, unsubscribe } = await watched('');
    system.image = new Uint8Array([1, 2, 3]);
    await pollTimes(clipboard, IMAGE_POLL_EVERY);
    expect(changes.map((change) => change.content)).toEqual([
      { kind: 'image', mime: 'image/png', data: new Uint8Array([1, 2, 3]) },
    ]);
    await pollTimes(clipboard, IMAGE_POLL_EVERY); // same image: not again
    expect(changes).toHaveLength(1);
    unsubscribe();
  });

  it('checks an unchanged image less and less often', async () => {
    const { system, clipboard, unsubscribe } = await watched('');
    system.image = new Uint8Array([7]);
    let reads = 0;
    const read = system.readImagePng.bind(system);
    system.readImagePng = () => {
      reads += 1;
      return read();
    };
    await pollTimes(clipboard, IMAGE_POLL_MAX_EVERY * 4);
    // 5 + 10 + 20 + 20 + 20 polls → 5 reads instead of 16 at a fixed 2.5 s.
    expect(reads).toBeLessThanOrEqual(6);
    unsubscribe();
  });

  it('prefers text when the clipboard has both', async () => {
    const { system, clipboard, changes, unsubscribe } = await watched('');
    system.image = new Uint8Array([9]);
    system.text = 'caption';
    await pollTimes(clipboard, IMAGE_POLL_EVERY);
    expect(changes.map((change) => change.content.kind)).toEqual(['text']);
    unsubscribe();
  });

  it('does not send back an image it wrote, even if the OS re-encodes it', async () => {
    const { system, clipboard, changes, unsubscribe } = await watched('');
    system.reencode = true;
    const written = await clipboard.write({
      kind: 'image',
      mime: 'image/jpeg',
      data: new Uint8Array([5, 6]),
    });
    expect(written.ok).toBe(true);
    await pollTimes(clipboard, IMAGE_POLL_EVERY * 2);
    expect(changes).toEqual([]);
    unsubscribe();
  });
});

describe('describeReceivedClip', () => {
  const sender = { name: 'Office Laptop' } as DeviceRecord;
  const clip = (content: Clip['content']): Clip => ({
    id: 'id' as Clip['id'],
    origin: 'dev_x' as DeviceId,
    createdAt: 0,
    content,
    hash: 'h',
  });

  it('offers to open links', () => {
    expect(describeReceivedClip(clip({ kind: 'url', url: 'https://a.b' }), sender)).toEqual({
      title: 'Link from Office Laptop',
      body: 'https://a.b',
      openUrl: 'https://a.b',
    });
  });

  it('shortens long text to one line', () => {
    const content = describeReceivedClip(
      clip({ kind: 'text', text: `line one\n${'x'.repeat(300)}` }),
      undefined,
    );
    expect(content.title).toBe('Text from another device');
    expect(content.body.length).toBeLessThanOrEqual(120);
    expect(content.body).not.toContain('\n');
    expect(content.openUrl).toBeNull();
  });
});

describe('toDiscoveredService', () => {
  const base = {
    fqdn: 'ClipBridge-abc._clipbridge._tcp.local',
    name: 'ClipBridge-abc',
    port: 47821,
    txt: { v: '1', did: 'dev_abc', gt: '0011223344556677', pm: '0' },
    addresses: ['192.168.1.7', 'fe80::1'],
  };

  it('maps TXT records and keeps IPv4 addresses only', () => {
    expect(toDiscoveredService(base)).toEqual({
      instanceId: base.fqdn,
      deviceId: 'dev_abc',
      groupTag: '0011223344556677',
      pairingMode: false,
      protocolVersion: 1,
      addresses: [{ host: '192.168.1.7', port: 47821 }],
    });
  });

  it('ignores services with missing fields or no IPv4 address', () => {
    expect(toDiscoveredService({ ...base, txt: { v: '1' } })).toBeNull();
    expect(toDiscoveredService({ ...base, addresses: ['fe80::1'] })).toBeNull();
  });
});

describe('file storage', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });
  const tempDir = (): string => {
    const directory = mkdtempSync(join(tmpdir(), 'clipbridge-test-'));
    directories.push(directory);
    return directory;
  };

  it('stores JSON per key and returns undefined for missing keys', async () => {
    const storage = new JsonFileStorage(tempDir());
    expect(await storage.get('settings')).toBeUndefined();
    await storage.set('settings', { a: 1 });
    expect(await storage.get('settings')).toEqual({ a: 1 });
    await storage.delete('settings');
    expect(await storage.get('settings')).toBeUndefined();
    await expect(storage.set('../escape', 1)).rejects.toThrow();
  });

  it('never writes secrets in plain text', async () => {
    const cipher: SecretCipher = {
      isEncryptionAvailable: () => true,
      encryptString: (plain) => Buffer.from(plain.split('').reverse().join(''), 'utf8'),
      decryptString: (encrypted) => encrypted.toString('utf8').split('').reverse().join(''),
    };
    const directory = tempDir();
    const secure = new EncryptedFileStorage(directory, cipher);
    const secret = new Uint8Array([1, 2, 3, 250]);
    await secure.set('group-key', secret);
    expect(await secure.get('group-key')).toEqual(secret);
    expect(readFileSync(join(directory, 'group-key.bin'), 'utf8')).not.toContain(
      Buffer.from(secret).toString('base64'),
    );
    expect(await secure.get('missing')).toBeNull();
  });

  it('refuses to store secrets when OS encryption is unavailable', async () => {
    const secure = new EncryptedFileStorage(tempDir(), {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    });
    await expect(secure.set('identity', new Uint8Array(4))).rejects.toThrow(/not available/);
  });
});
