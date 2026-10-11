import { describe, expect, it } from 'vitest';

import type { Clip } from '../domain/clip';
import type { ClipId, DeviceId } from '../domain/ids';
import { createTestGroup, createTestMember } from '../testing/fixtures';
import { SeededRandom } from '../testing/seeded-random';
import { BACKOFF, backoffDelayMs } from './backoff';
import { BoundedSet } from './bounded-set';
import { ClipHistory } from './clip-history';
import { GroupKeys, MAX_PREVIOUS_KEYS } from './group-keys';
import {
  decideMembership,
  isMember,
  isMembershipSignedByTrustedMember,
  signMembership,
} from './membership-service';
import { createStore } from './store';

describe('backoff', () => {
  it('doubles from 1 s up to 30 s, within ±20 % jitter', () => {
    const random = new SeededRandom(1);
    const expected = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    expected.forEach((base, attempt) => {
      const delay = backoffDelayMs(attempt, random);
      expect(delay).toBeGreaterThanOrEqual(base * (1 - BACKOFF.jitterRatio));
      expect(delay).toBeLessThanOrEqual(base * (1 + BACKOFF.jitterRatio));
    });
  });
});

describe('BoundedSet', () => {
  it('forgets the oldest entries', () => {
    const set = new BoundedSet<number>(2);
    expect(set.add(1)).toBe(true);
    expect(set.add(1)).toBe(false);
    set.add(2);
    set.add(3);
    expect(set.has(1)).toBe(false);
    expect(set.has(3)).toBe(true);
    expect(set.size).toBe(2);
    expect(() => new BoundedSet(0)).toThrow();
  });
});

describe('createStore', () => {
  it('notifies subscribers on change only', () => {
    const store = createStore(1);
    const seen: number[] = [];
    const unsubscribe = store.subscribe((value) => seen.push(value));
    store.set(1);
    store.update((value) => value + 1);
    unsubscribe();
    store.set(5);
    expect(seen).toEqual([2]);
    expect(store.get()).toBe(5);
  });
});

describe('ClipHistory', () => {
  const clip = (n: number, createdAt = n): Clip => ({
    id: `id-${n}` as ClipId,
    origin: 'dev_a' as DeviceId,
    createdAt,
    content: { kind: 'text', text: `t${n}` },
    hash: `h${n}`,
  });

  it('keeps the newest clips first and drops beyond the limit', () => {
    const history = new ClipHistory({ limit: 2, ttlMs: 1_000, maxImages: 3 });
    history.add(clip(1));
    history.add(clip(3));
    history.add(clip(2));
    expect(history.list().map((entry) => entry.clip.createdAt)).toEqual([3, 2]);
    expect(history.add(clip(3))).toBe(false);
    expect(history.newest()?.createdAt).toBe(3);
  });

  it('returns clips since a time, oldest first', () => {
    const history = new ClipHistory({ limit: 10, ttlMs: 1_000, maxImages: 3 });
    [1, 2, 3, 4].forEach((n) => history.add(clip(n)));
    expect(history.clipsSince(2, 10).map((c) => c.createdAt)).toEqual([3, 4]);
    expect(history.clipsSince(0, 2).map((c) => c.createdAt)).toEqual([3, 4]);
  });

  it('expires entries after the TTL and tracks delivery', () => {
    const history = new ClipHistory({ limit: 10, ttlMs: 100, maxImages: 3 });
    history.add(clip(1, 0));
    history.add(clip(2, 150));
    expect(history.markDelivered('id-2' as ClipId, 'dev_b' as DeviceId)).toBe(true);
    expect(history.markDelivered('id-2' as ClipId, 'dev_b' as DeviceId)).toBe(false);
    expect(history.prune(200)).toBe(true);
    expect(history.list()).toHaveLength(1);
    expect(history.list()[0]?.deliveredTo).toEqual(['dev_b']);
    history.clear();
    expect(history.list()).toHaveLength(0);
  });
});

describe('membership', () => {
  const random = new SeededRandom(9);
  const group = createTestGroup(
    [
      { name: 'A', platform: 'windows' },
      { name: 'B', platform: 'macos' },
      { name: 'C', platform: 'android' },
    ],
    random,
  );
  const [a, b, c] = group.members as [
    (typeof group.members)[0],
    (typeof group.members)[0],
    (typeof group.members)[0],
  ];

  const next = (
    signer = b,
    members = group.membership.members.filter((m) => m.id !== c.device.id),
  ) =>
    signMembership(
      { groupId: group.groupId, version: 2, members, updatedBy: signer.device.id, updatedAt: 10 },
      signer.identity,
    );

  it('adopts a newer list signed by a trusted member', () => {
    const updated = next();
    expect(isMembershipSignedByTrustedMember(updated, group.membership)).toBe(true);
    expect(decideMembership(group.membership, updated)).toBe('adopt');
    expect(isMember(updated, c.device.id)).toBe(false);
    expect(isMember(updated, a.device.id)).toBe(true);
  });

  it('keeps the current list when the incoming one is older or equal', () => {
    expect(decideMembership(next(), group.membership)).toBe('keep');
    expect(decideMembership(group.membership, group.membership)).toBe('keep');
  });

  it('rejects lists signed by outsiders, tampered lists and other groups', () => {
    const outsider = createTestMember({ name: 'X', platform: 'windows' }, random);
    const forged = signMembership(
      {
        ...next(),
        updatedBy: outsider.device.id,
        members: [...group.membership.members, outsider.device],
      },
      outsider.identity,
    );
    expect(decideMembership(group.membership, forged)).toBe('reject');

    const tampered = { ...next(), version: 99 };
    expect(decideMembership(group.membership, tampered)).toBe('reject');

    expect(decideMembership(group.membership, { ...next(), groupId: 'other' })).toBe('reject');
  });

  it('rejects lists with duplicate members', () => {
    const duplicated = next(b, [...group.membership.members, a.device]);
    expect(decideMembership(group.membership, duplicated)).toBe('reject');
  });
});

describe('GroupKeys', () => {
  const key = (n: number): Uint8Array => new Uint8Array(32).fill(n);

  it('serves the current and previous keys by epoch', () => {
    const keys = new GroupKeys({ epoch: 3, key: key(3) }, [
      { epoch: 1, key: key(1) },
      { epoch: 2, key: key(2) },
      { epoch: 5, key: key(5) }, // newer than current: ignored
    ]);
    expect(keys.epoch).toBe(3);
    expect(keys.keyFor(3)).toEqual(key(3));
    expect(keys.keyFor(2)).toEqual(key(2));
    expect(keys.keyFor(5)).toBeNull();
    expect(keys.previous.map((entry) => entry.epoch)).toEqual([2, 1]);
  });

  it('rotates forward only and forgets the oldest keys', () => {
    const keys = new GroupKeys({ epoch: 1, key: key(1) });
    expect(keys.rotate({ epoch: 1, key: key(9) })).toBe(false);
    for (let epoch = 2; epoch <= 6; epoch++)
      expect(keys.rotate({ epoch, key: key(epoch) })).toBe(true);
    expect(keys.current.epoch).toBe(6);
    expect(keys.previous).toHaveLength(MAX_PREVIOUS_KEYS);
    expect(keys.keyFor(2)).toBeNull();
    expect(keys.keyFor(3)).toEqual(key(3));
  });
});
