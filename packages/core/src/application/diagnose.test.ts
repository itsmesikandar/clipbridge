import { describe, expect, it } from 'vitest';

import { appError } from '../domain/errors';
import type { DeviceId } from '../domain/ids';
import type { NetworkSnapshot } from '../domain/network';
import type { PeerView } from '../domain/status';
import { diagnose, type DiagnosisInput, SEARCH_GRACE_MS } from './diagnose';

const HOME = '192.168.1.0/24';
const OFFICE = '10.0.0.0/24';
const wifi = (subnet = HOME): NetworkSnapshot => ({
  kind: 'wifi',
  ipv4: subnet.replace('0/24', '5'),
  subnet,
});

function peer(overrides: Partial<PeerView> = {}): PeerView {
  return {
    id: 'dev_00000000000000000000000000000001' as DeviceId,
    name: 'Office Laptop',
    platform: 'windows',
    role: 'hub',
    state: 'offline',
    discovered: false,
    lastSeenAt: null,
    lastSeenSubnet: null,
    lastError: null,
    ...overrides,
  };
}

function input(overrides: Partial<DiagnosisInput> = {}): DiagnosisInput {
  return {
    selfRole: 'hub',
    network: wifi(),
    permission: 'granted',
    peers: [peer()],
    searchingForMs: SEARCH_GRACE_MS,
    removedFromGroup: false,
    ...overrides,
  };
}

const unreachable = appError('PEER_UNREACHABLE', 'x', {
  peerId: null,
  peerName: 'Office Laptop',
  address: '192.168.1.7:47821',
  cause: 'timeout',
});

describe('diagnose (docs/PLAN.md §9.3)', () => {
  it('CONNECTED when every peer is connected', () => {
    const status = diagnose(input({ peers: [peer({ state: 'connected' })] }));
    expect(status).toEqual({ kind: 'CONNECTED', connectedCount: 1, peerCount: 1, issue: null });
  });

  it('PARTIAL when some peers are connected', () => {
    const status = diagnose(
      input({ peers: [peer({ state: 'connected' }), peer({ name: 'Home PC' })] }),
    );
    expect(status).toMatchObject({ kind: 'PARTIAL', connectedCount: 1, peerCount: 2, issue: null });
  });

  it('NOT_PAIRED when there are no other members', () => {
    expect(diagnose(input({ peers: [] })).kind).toBe('NOT_PAIRED');
  });

  it('SEARCHING during the grace period', () => {
    expect(diagnose(input({ searchingForMs: SEARCH_GRACE_MS - 1 })).kind).toBe('SEARCHING');
  });

  it('NO_NETWORK when the phone is on mobile data only', () => {
    const status = diagnose(
      input({ network: { kind: 'cellular', ipv4: '10.20.30.40', subnet: null } }),
    );
    expect(status.issue).toMatchObject({
      code: 'NO_NETWORK',
      details: { networkKind: 'cellular' },
    });
  });

  it('NO_NETWORK when Wi-Fi is off, even with connected peers listed', () => {
    const status = diagnose(
      input({
        network: { kind: 'none', ipv4: null, subnet: null },
        peers: [peer({ state: 'connected' })],
      }),
    );
    expect(status.issue?.code).toBe('NO_NETWORK');
  });

  it('LOCAL_NETWORK_PERMISSION when iOS permission is denied', () => {
    expect(diagnose(input({ permission: 'denied' })).issue?.code).toBe('LOCAL_NETWORK_PERMISSION');
  });

  it('REMOVED_FROM_GROUP overrides everything', () => {
    expect(diagnose(input({ removedFromGroup: true, peers: [] })).issue?.code).toBe(
      'REMOVED_FROM_GROUP',
    );
  });

  it('DIFFERENT_NETWORK when all peers were last seen on another subnet', () => {
    const status = diagnose(
      input({
        network: wifi(OFFICE),
        peers: [
          peer({ name: 'Old', lastSeenSubnet: HOME, lastSeenAt: 1 }),
          peer({ name: 'Office Laptop', lastSeenSubnet: HOME, lastSeenAt: 5 }),
        ],
      }),
    );
    expect(status.issue).toMatchObject({
      code: 'DIFFERENT_NETWORK',
      details: { localSubnet: OFFICE, peerName: 'Office Laptop', peerSubnet: HOME },
    });
  });

  it('not DIFFERENT_NETWORK when any peer was seen on this subnet', () => {
    const status = diagnose(
      input({
        peers: [peer({ lastSeenSubnet: OFFICE }), peer({ name: 'B', lastSeenSubnet: HOME })],
      }),
    );
    expect(status.issue?.code).toBe('NO_PEERS');
  });

  it('NO_PEERS when nothing is found on the same network', () => {
    expect(diagnose(input()).issue).toMatchObject({
      code: 'NO_PEERS',
      details: { localSubnet: HOME },
    });
  });

  it('PEER_UNREACHABLE when a discovered peer cannot be connected (firewall)', () => {
    const status = diagnose(
      input({ searchingForMs: 0, peers: [peer({ discovered: true, lastError: unreachable })] }),
    );
    expect(status.issue?.code).toBe('PEER_UNREACHABLE');
  });

  it('not PEER_UNREACHABLE for a peer that is no longer discovered', () => {
    const status = diagnose(
      input({ peers: [peer({ discovered: false, lastError: unreachable })] }),
    );
    expect(status.issue?.code).toBe('NO_PEERS');
  });

  it('VERSION_MISMATCH and AUTH_FAILED are reported immediately', () => {
    const mismatch = appError('VERSION_MISMATCH', 'x', {
      peerId: null,
      localVersion: 1,
      remoteVersion: 2,
    });
    const auth = appError('AUTH_FAILED', 'x', { peerId: null, reason: 'rejected-by-peer' });
    expect(
      diagnose(input({ searchingForMs: 0, peers: [peer({ lastError: mismatch })] })).issue?.code,
    ).toBe('VERSION_MISMATCH');
    expect(
      diagnose(input({ searchingForMs: 0, peers: [peer({ lastError: auth })] })).issue?.code,
    ).toBe('AUTH_FAILED');
  });

  describe('on a phone', () => {
    const phone = (overrides: Partial<DiagnosisInput>): DiagnosisInput =>
      input({ selfRole: 'client', ...overrides });

    it('NO_DESKTOP_ONLINE when the group has only phones', () => {
      const status = diagnose(
        phone({ searchingForMs: 0, peers: [peer({ platform: 'ios', role: 'client' })] }),
      );
      expect(status.issue?.code).toBe('NO_DESKTOP_ONLINE');
    });

    it('NO_DESKTOP_ONLINE when no computer is reachable', () => {
      expect(diagnose(phone({})).issue?.code).toBe('NO_DESKTOP_ONLINE');
    });

    it('CONNECTED when connected to every computer; other phones do not count', () => {
      const status = diagnose(
        phone({
          peers: [
            peer({ state: 'connected' }),
            peer({ name: 'iPhone', platform: 'ios', role: 'client' }),
          ],
        }),
      );
      expect(status).toMatchObject({ kind: 'CONNECTED', connectedCount: 1, peerCount: 1 });
    });
  });
});
