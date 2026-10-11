import {
  type AppError,
  appError,
  type AppErrorCode,
  type DeviceId,
  type PeerView,
} from '@clipbridge/core';
import { describe, expect, it } from 'vitest';

import { sortDevices, toDeviceRow } from './features/devices/device-model';
import { toBannerModel } from './features/status/status-model';
import { toReport } from './features/status/use-diagnostics-presenter';
import { describeIssue, formatBytes } from './i18n/issue-text';
import { formatRelativeTime } from './lib/format-time';

/** One sample per error code, so a new code without text fails to compile or this test. */
const SAMPLES: { [C in AppErrorCode]: AppError<C> } = {
  NO_NETWORK: appError('NO_NETWORK', '', { networkKind: 'cellular' }),
  LOCAL_NETWORK_PERMISSION: appError('LOCAL_NETWORK_PERMISSION', '', {}),
  DIFFERENT_NETWORK: appError('DIFFERENT_NETWORK', '', {
    localSubnet: '10.0.0.0/24',
    peerName: 'Office Laptop',
    peerSubnet: '192.168.1.0/24',
  }),
  NO_PEERS: appError('NO_PEERS', '', { localSubnet: '192.168.1.0/24' }),
  NO_DESKTOP_ONLINE: appError('NO_DESKTOP_ONLINE', '', {}),
  PEER_UNREACHABLE: appError('PEER_UNREACHABLE', '', {
    peerId: null,
    peerName: 'Office Laptop',
    address: '192.168.1.7:47821',
    cause: 'timeout',
  }),
  NETWORK_ISOLATION: appError('NETWORK_ISOLATION', '', {}),
  AUTH_FAILED: appError('AUTH_FAILED', '', { peerId: null, reason: 'rejected-by-peer' }),
  REMOVED_FROM_GROUP: appError('REMOVED_FROM_GROUP', '', {}),
  VERSION_MISMATCH: appError('VERSION_MISMATCH', '', {
    peerId: null,
    localVersion: 1,
    remoteVersion: 2,
  }),
  PROTOCOL_ERROR: appError('PROTOCOL_ERROR', '', { reason: 'x' }),
  CONNECTION_LOST: appError('CONNECTION_LOST', '', { peerId: null, reason: 'closed' }),
  PAYLOAD_TOO_LARGE: appError('PAYLOAD_TOO_LARGE', '', {
    kind: 'text',
    sizeBytes: 2_000_000,
    limitBytes: 1_048_576,
  }),
  PORT_IN_USE: appError('PORT_IN_USE', '', { port: 47821 }),
  CLIPBOARD_ACCESS_FAILED: appError('CLIPBOARD_ACCESS_FAILED', '', { operation: 'write' }),
  PAIRING_EXPIRED: appError('PAIRING_EXPIRED', '', {}),
  PAIRING_REJECTED: appError('PAIRING_REJECTED', '', {}),
  PAIRING_CODE_INVALID: appError('PAIRING_CODE_INVALID', '', { attemptsLeft: 2 }),
};

describe('describeIssue', () => {
  it.each(Object.values(SAMPLES))('has a title, message and fix steps for $code', (issue) => {
    const text = describeIssue(issue);
    expect(text.title.length).toBeGreaterThan(0);
    expect(text.message.length).toBeGreaterThan(0);
    expect(text.steps.length).toBeGreaterThan(0);
  });

  it('names both networks for DIFFERENT_NETWORK', () => {
    expect(describeIssue(SAMPLES.DIFFERENT_NETWORK).message).toBe(
      'This device is on 10.0.0.x, but "Office Laptop" was last seen on 192.168.1.x.',
    );
  });

  it('tells phones on mobile data what is wrong', () => {
    expect(describeIssue(SAMPLES.NO_NETWORK).message).toContain('mobile data');
  });

  it('mentions the firewall for unreachable devices', () => {
    expect(describeIssue(SAMPLES.PEER_UNREACHABLE).steps.join(' ')).toMatch(/firewall/i);
  });

  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(2_000_000)).toBe('1.9 MB');
  });
});

describe('toBannerModel', () => {
  const status = (
    kind: 'CONNECTED' | 'PARTIAL' | 'SEARCHING' | 'NOT_PAIRED' | 'ERROR',
    connected = 0,
    total = 0,
  ) => ({
    kind,
    connectedCount: connected,
    peerCount: total,
    issue: null,
  });

  it.each([
    [status('CONNECTED', 1, 1), 'ok', 'Connected to 1 device'],
    [status('CONNECTED', 3, 3), 'ok', 'Connected to 3 devices'],
    [status('PARTIAL', 2, 4), 'warn', 'Connected to 2 of 4 devices'],
    [status('SEARCHING'), 'info', 'Looking for your devices on this network…'],
    [status('NOT_PAIRED'), 'info', 'No devices paired yet'],
  ] as const)('%o → %s "%s"', (input, tone, title) => {
    expect(toBannerModel(input)).toMatchObject({ tone, title });
  });

  it('shows the issue text with troubleshooting steps', () => {
    const banner = toBannerModel({ ...status('ERROR'), issue: SAMPLES.NO_PEERS });
    expect(banner.tone).toBe('error');
    expect(banner.title).toBe('Can’t find your other devices');
    expect(banner.steps.length).toBeGreaterThan(0);
  });
});

describe('device rows', () => {
  const now = Date.UTC(2026, 9, 11, 12);
  const peer = (overrides: Partial<PeerView>): PeerView => ({
    id: 'dev_1' as DeviceId,
    name: 'Office Laptop',
    platform: 'windows',
    role: 'hub',
    state: 'offline',
    discovered: false,
    lastSeenAt: null,
    lastSeenSubnet: null,
    lastError: null,
    ...overrides,
  });

  it('labels each state', () => {
    expect(toDeviceRow(peer({ state: 'connected' }), now)).toMatchObject({
      stateLabel: 'Connected',
      tone: 'ok',
    });
    expect(toDeviceRow(peer({ state: 'handshaking' }), now).stateLabel).toBe('Connecting…');
    expect(toDeviceRow(peer({ lastSeenAt: now - 2 * 3_600_000 }), now)).toMatchObject({
      stateLabel: 'Offline · last seen 2 h ago',
      tone: 'warn',
      detail: null,
    });
  });

  it('explains why an offline device is not connected', () => {
    const row = toDeviceRow(peer({ lastError: SAMPLES.PEER_UNREACHABLE }), now);
    expect(row).toMatchObject({
      tone: 'error',
      detail: '"Office Laptop" can’t be reached',
      platformLabel: 'Windows',
    });
  });

  it('lists connected devices first', () => {
    const sorted = sortDevices([
      peer({ name: 'B', state: 'offline' }),
      peer({ name: 'C', state: 'connected' }),
      peer({ name: 'A', state: 'connecting' }),
    ]);
    expect(sorted.map((p) => p.name)).toEqual(['C', 'A', 'B']);
  });
});

describe('formatRelativeTime', () => {
  const now = 10 * 24 * 3_600_000;
  it.each([
    [now - 10_000, 'just now'],
    [now - 5 * 60_000, '5 min ago'],
    [now - 3 * 3_600_000, '3 h ago'],
    [now - 24 * 3_600_000, '1 day ago'],
    [now - 3 * 24 * 3_600_000, '3 days ago'],
    [now + 5_000, 'just now'],
  ])('%i → %s', (timestamp, label) => {
    expect(formatRelativeTime(timestamp, now)).toBe(label);
  });
});

describe('diagnostics report', () => {
  it('contains network and device facts but no secrets', () => {
    const report = toReport({
      deviceId: 'dev_abc',
      deviceName: 'Laptop',
      platform: 'windows',
      appVersion: '0.1.0',
      coreVersion: '0.1.0',
      protocolVersion: 1,
      network: { kind: 'wifi', ipv4: '192.168.1.5', subnet: '192.168.1.0/24' },
      listenPort: 47821,
      logFile: 'C:/logs/main.log',
      devices: [
        {
          id: 'dev_def' as DeviceId,
          name: 'Phone',
          platform: 'android',
          role: 'client',
          state: 'offline',
          discovered: false,
          lastSeenAt: null,
          lastSeenSubnet: '192.168.1.0/24',
          lastError: SAMPLES.CONNECTION_LOST,
        },
      ],
    });
    expect(report).toContain('Network: wifi, 192.168.1.5, 192.168.1.0/24');
    expect(report).toContain(
      'Phone (android): offline, last subnet 192.168.1.0/24, last error CONNECTION_LOST',
    );
  });
});
