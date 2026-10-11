import { describe, expect, it } from 'vitest';

import {
  classifyText,
  CLIP_LIMITS,
  compareClipRecency,
  contentSize,
  isEmptyContent,
  validateContentSize,
} from './clip';
import { roleOf } from './device';
import { appError, isAppError } from './errors';
import { createClipId, type DeviceId, deviceIdFromDigest, isClipId, isDeviceId } from './ids';
import { compareMembershipPrecedence, type UnsignedMembership } from './membership';
import { hasLanConnection, prefixLengthFromNetmask, subnetLabel, subnetOf } from './network';

describe('classifyText', () => {
  it.each([
    'https://example.com',
    'http://example.com/path?q=1#x',
    '  https://example.com/with-spaces-around  ',
  ])('treats %j as a URL', (text) => {
    expect(classifyText(text)).toEqual({ kind: 'url', url: text.trim() });
  });

  it.each(['example.com', 'see https://example.com', 'ftp://example.com', 'https://', 'hello'])(
    'treats %j as text',
    (text) => {
      expect(classifyText(text)).toEqual({ kind: 'text', text });
    },
  );
});

describe('clip content', () => {
  it('measures size in bytes', () => {
    expect(contentSize({ kind: 'text', text: 'é' })).toBe(2);
    expect(contentSize({ kind: 'image', mime: 'image/png', data: new Uint8Array(5) })).toBe(5);
  });

  it('detects empty content', () => {
    expect(isEmptyContent({ kind: 'text', text: '' })).toBe(true);
    expect(isEmptyContent({ kind: 'url', url: 'https://a.b' })).toBe(false);
  });

  it('rejects text over the limit with PAYLOAD_TOO_LARGE', () => {
    const result = validateContentSize({
      kind: 'text',
      text: 'a'.repeat(CLIP_LIMITS.textBytes + 1),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(result.error.details).toMatchObject({
        kind: 'text',
        limitBytes: CLIP_LIMITS.textBytes,
      });
    }
  });

  it('accepts an image at the limit', () => {
    const data = new Uint8Array(CLIP_LIMITS.imageBytes);
    expect(validateContentSize({ kind: 'image', mime: 'image/png', data }).ok).toBe(true);
  });

  it('orders by createdAt, then by origin', () => {
    const a = { createdAt: 2, origin: 'dev_a' as DeviceId };
    const b = { createdAt: 1, origin: 'dev_z' as DeviceId };
    expect(compareClipRecency(a, b)).toBeGreaterThan(0);
    expect(compareClipRecency({ ...b, createdAt: 2 }, a)).toBeGreaterThan(0);
    expect(compareClipRecency(a, a)).toBe(0);
  });
});

describe('ids', () => {
  it('creates valid, time-ordered UUIDv7 clip ids', () => {
    const random = new Uint8Array(10).fill(0xff);
    const first = createClipId(1_700_000_000_000, random);
    const second = createClipId(1_700_000_000_001, new Uint8Array(10));
    expect(isClipId(first)).toBe(true);
    expect(isClipId(second)).toBe(true);
    expect(first < second).toBe(true);
    expect(first.slice(0, 13)).toBe('018bcfe5-6800');
  });

  it('builds device ids from a digest', () => {
    const id = deviceIdFromDigest(new Uint8Array(32).fill(0xab));
    expect(id).toBe(`dev_${'ab'.repeat(16)}`);
    expect(isDeviceId(id)).toBe(true);
    expect(isDeviceId('dev_123')).toBe(false);
  });

  it('rejects too little randomness or digest', () => {
    expect(() => createClipId(0, new Uint8Array(9))).toThrow();
    expect(() => deviceIdFromDigest(new Uint8Array(8))).toThrow();
  });
});

describe('device roles', () => {
  it.each([
    ['windows', 'hub'],
    ['macos', 'hub'],
    ['linux', 'hub'],
    ['android', 'client'],
    ['ios', 'client'],
  ] as const)('%s is a %s', (platform, role) => {
    expect(roleOf(platform)).toBe(role);
  });
});

describe('network helpers', () => {
  it.each([
    ['255.255.255.0', 24],
    ['255.255.0.0', 16],
    ['255.255.255.255', 32],
    ['0.0.0.0', 0],
    ['255.0.255.0', null],
    ['nope', null],
  ] as const)('netmask %s → prefix %s', (mask, prefix) => {
    expect(prefixLengthFromNetmask(mask)).toBe(prefix);
  });

  it('computes subnets', () => {
    expect(subnetOf('192.168.1.42', 24)).toBe('192.168.1.0/24');
    expect(subnetOf('10.1.200.7', 16)).toBe('10.1.0.0/16');
    expect(subnetOf('300.1.1.1', 24)).toBeNull();
    expect(subnetOf('10.0.0.1', 33)).toBeNull();
  });

  it('labels /24 subnets for humans', () => {
    expect(subnetLabel('192.168.1.0/24')).toBe('192.168.1.x');
    expect(subnetLabel('10.1.0.0/16')).toBe('10.1.0.0/16');
  });

  it('knows when the device has a LAN', () => {
    expect(hasLanConnection({ kind: 'wifi', ipv4: '192.168.1.2', subnet: '192.168.1.0/24' })).toBe(
      true,
    );
    expect(hasLanConnection({ kind: 'cellular', ipv4: '10.0.0.2', subnet: null })).toBe(false);
    expect(hasLanConnection({ kind: 'wifi', ipv4: null, subnet: null })).toBe(false);
    expect(hasLanConnection({ kind: 'unknown', ipv4: '127.0.0.1', subnet: null })).toBe(false);
  });
});

describe('errors', () => {
  it('narrows by code', () => {
    const error = appError('PORT_IN_USE', 'busy', { port: 47821 });
    expect(isAppError(error, 'PORT_IN_USE')).toBe(true);
    expect(isAppError(error, 'NO_NETWORK')).toBe(false);
  });
});

describe('membership precedence', () => {
  const base: UnsignedMembership = {
    groupId: 'g',
    version: 2,
    members: [],
    updatedBy: 'dev_b' as DeviceId,
    updatedAt: 0,
  };

  it('prefers the higher version, then the lower signer id', () => {
    expect(compareMembershipPrecedence({ ...base, version: 3 }, base)).toBeGreaterThan(0);
    expect(
      compareMembershipPrecedence({ ...base, updatedBy: 'dev_a' as DeviceId }, base),
    ).toBeGreaterThan(0);
    expect(compareMembershipPrecedence(base, base)).toBe(0);
  });
});
