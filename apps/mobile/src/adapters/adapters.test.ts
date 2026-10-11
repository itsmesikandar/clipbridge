import type { Clip, DeviceId, DeviceRecord } from '@clipbridge/core';
import * as Network from 'expo-network';

import { pickLanInterface, toNetworkKind, toSnapshot } from './expo-network-info';
import { describeClip } from './expo-notifier';
import { causeFromMessage } from './rn-websocket-transport';
import { toDiscoveredService } from './zeroconf-discovery';

const clip = (content: Clip['content']): Clip => ({
  id: 'id' as Clip['id'],
  origin: 'dev_x' as DeviceId,
  createdAt: 0,
  content,
  hash: 'h',
});

describe('describeClip', () => {
  it('names the sender and shows the link', () => {
    expect(
      describeClip(clip({ kind: 'url', url: 'https://a.b' }), {
        name: 'Office Laptop',
      } as DeviceRecord),
    ).toEqual({
      title: 'Link from Office Laptop',
      body: 'https://a.b',
    });
  });

  it('shortens long text to one line', () => {
    const { title, body } = describeClip(
      clip({ kind: 'text', text: `a\n${'x'.repeat(300)}` }),
      undefined,
    );
    expect(title).toBe('Text from your computer');
    expect(body.length).toBeLessThanOrEqual(120);
    expect(body).not.toContain('\n');
  });
});

describe('network snapshot', () => {
  it('maps expo-network types', () => {
    expect(toNetworkKind(Network.NetworkStateType.WIFI)).toBe('wifi');
    expect(toNetworkKind(Network.NetworkStateType.CELLULAR)).toBe('cellular');
    expect(toNetworkKind(Network.NetworkStateType.NONE)).toBe('none');
    expect(toNetworkKind(undefined)).toBe('unknown');
  });

  it('derives a /24 subnet on Wi-Fi and none on mobile data', () => {
    expect(toSnapshot('wifi', '10.219.156.42')).toEqual({
      kind: 'wifi',
      ipv4: '10.219.156.42',
      subnet: '10.219.156.0/24',
    });
    expect(toSnapshot('cellular', '100.64.1.2')).toEqual({
      kind: 'cellular',
      ipv4: null,
      subnet: null,
    });
    expect(toSnapshot('wifi', '0.0.0.0')).toEqual({ kind: 'wifi', ipv4: null, subnet: null });
  });
});

describe('pickLanInterface', () => {
  it('sees the phone hotspot and ignores mobile data', () => {
    expect(
      pickLanInterface([
        { name: 'v4-ccmni1', address: '192.0.0.4', prefix: 32 },
        { name: 'ap0', address: '10.219.156.114', prefix: 24 },
      ]),
    ).toEqual({ kind: 'wifi', ipv4: '10.219.156.114', subnet: '10.219.156.0/24' });
  });

  it('prefers Wi-Fi and uses the real prefix', () => {
    expect(
      pickLanInterface([
        { name: 'rndis0', address: '192.168.42.129', prefix: 24 },
        { name: 'wlan0', address: '172.20.4.9', prefix: 20 },
      ]),
    ).toEqual({ kind: 'wifi', ipv4: '172.20.4.9', subnet: '172.20.0.0/20' });
  });

  it('returns null without a LAN (falls back to expo-network)', () => {
    expect(pickLanInterface([{ name: 'tun0', address: '10.8.0.2', prefix: 24 }])).toBeNull();
  });
});

describe('causeFromMessage', () => {
  it.each([
    ['failed to connect to /192.168.1.7 (port 47821): connect failed: ECONNREFUSED', 'refused'],
    ['timeout', 'timeout'],
    ['connect failed: EHOSTUNREACH (No route to host)', 'unreachable'],
    ['something else', 'unknown'],
  ] as const)('%s → %s', (message, cause) => {
    expect(causeFromMessage(message)).toBe(cause);
  });
});

describe('toDiscoveredService', () => {
  const service = {
    name: 'ClipBridge-abc',
    fullName: 'ClipBridge-abc._clipbridge._tcp.local.',
    host: 'pc.local.',
    port: 47821,
    addresses: ['192.168.1.7', 'fe80::1'],
    ipv4: ['192.168.1.7'],
    ipv6: ['fe80::1'],
    txt: { v: '1', did: 'dev_abc', gt: '0011223344556677', pm: '1' },
  };

  it('maps TXT records and IPv4 addresses', () => {
    expect(toDiscoveredService(service)).toEqual({
      instanceId: 'ClipBridge-abc',
      deviceId: 'dev_abc',
      groupTag: '0011223344556677',
      pairingMode: true,
      protocolVersion: 1,
      addresses: [{ host: '192.168.1.7', port: 47821 }],
    });
  });

  it('ignores services with missing fields or no IPv4', () => {
    expect(toDiscoveredService({ ...service, txt: { v: '1' } })).toBeNull();
    expect(toDiscoveredService({ ...service, ipv4: [], addresses: ['fe80::1'] })).toBeNull();
  });
});
