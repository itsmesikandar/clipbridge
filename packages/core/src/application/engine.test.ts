/**
 * End-to-end behaviour of the engine on a simulated LAN:
 * 3 laptops + 2 phones, plus the failure cases from docs/PLAN.md §9.3.
 */

import { describe, expect, it } from 'vitest';

import { CLIP_LIMITS } from '../domain/clip';
import type { DeviceRecord } from '../domain/device';
import { createTestGroup, createTestMember, type TestMember } from '../testing/fixtures';
import { type TestDevice, TestHarness } from '../testing/harness';
import { SeededRandom } from '../testing/seeded-random';
import { signMembership } from './membership-service';
import { SESSION_TIMING } from './peer-session';

const HOME = '192.168.1.0/24';
const OFFICE = '10.0.0.0/24';
const text = (value: string) => ({ kind: 'text', text: value }) as const;

function setup() {
  const random = new SeededRandom(2024);
  const group = createTestGroup(
    [
      { name: 'Laptop-1', platform: 'windows' },
      { name: 'Laptop-2', platform: 'macos' },
      { name: 'Laptop-3', platform: 'windows' },
      { name: 'Pixel', platform: 'android' },
      { name: 'iPhone', platform: 'ios' },
    ],
    random,
  );
  const harness = new TestHarness(group);
  const [l1, l2, l3, p1, p2] = group.members as [
    TestMember,
    TestMember,
    TestMember,
    TestMember,
    TestMember,
  ];
  return { random, group, harness, members: { l1, l2, l3, p1, p2 } };
}

async function fullGroup() {
  const ctx = setup();
  const { harness, members } = ctx;
  const devices = {
    l1: harness.addDevice(members.l1, { subnet: HOME }),
    l2: harness.addDevice(members.l2, { subnet: HOME }),
    l3: harness.addDevice(members.l3, { subnet: HOME }),
    p1: harness.addDevice(members.p1, { subnet: HOME }),
    p2: harness.addDevice(members.p2, { subnet: HOME }),
  };
  await harness.startAll(Object.values(devices));
  return { ...ctx, devices };
}

const textOf = (device: TestDevice): string | null => {
  const content = device.clipboard.content;
  return content?.kind === 'text' ? content.text : null;
};

describe('sync across 3 laptops and 2 phones', () => {
  it('connects everyone: laptops form a mesh, phones connect to every laptop', async () => {
    const { devices } = await fullGroup();
    for (const laptop of [devices.l1, devices.l2, devices.l3]) {
      expect(laptop.engine.status.get()).toMatchObject({
        kind: 'CONNECTED',
        connectedCount: 4,
        peerCount: 4,
      });
    }
    for (const phone of [devices.p1, devices.p2]) {
      expect(phone.engine.status.get()).toMatchObject({
        kind: 'CONNECTED',
        connectedCount: 3,
        peerCount: 3,
      });
    }
  });

  it('a laptop copy reaches every laptop clipboard and every phone notification exactly once', async () => {
    const { devices, harness } = await fullGroup();
    devices.l1.clipboard.userCopies(text('meeting at 5'));
    await harness.clock.advance(100);

    for (const laptop of [devices.l2, devices.l3]) {
      expect(laptop.clipboard.writes).toEqual([text('meeting at 5')]);
    }
    expect(devices.l1.clipboard.writes).toEqual([]); // no echo back to the origin
    for (const phone of [devices.p1, devices.p2]) {
      expect(phone.notifier.received).toHaveLength(1);
      expect(phone.notifier.received[0]?.from?.name).toBe('Laptop-1');
      expect(phone.clipboard.writes).toEqual([]); // phones wait for the user to tap Copy
    }
  });

  it('does not ping-pong: received clips written to the clipboard are not re-sent', async () => {
    const { devices, harness } = await fullGroup();
    devices.l1.clipboard.userCopies(text('once'));
    await harness.clock.advance(5_000);
    for (const device of Object.values(devices)) {
      expect(device.engine.history.get()).toHaveLength(1);
    }
    expect(devices.l2.clipboard.writes).toHaveLength(1);
  });

  it('a phone share reaches all laptops and the other phone (through a laptop)', async () => {
    const { devices, harness } = await fullGroup();
    const sent = devices.p1.engine.sendClip({ kind: 'url', url: 'https://example.com' });
    expect(sent.ok).toBe(true);
    await harness.clock.advance(100);

    for (const laptop of [devices.l1, devices.l2, devices.l3]) {
      expect(laptop.clipboard.writes).toEqual([{ kind: 'url', url: 'https://example.com' }]);
    }
    expect(devices.p2.notifier.received.map((r) => r.clip.content)).toEqual([
      { kind: 'url', url: 'https://example.com' },
    ]);
    expect(devices.p1.notifier.received).toHaveLength(0);
  });

  it('marks clips as delivered when peers acknowledge them', async () => {
    const { devices, harness } = await fullGroup();
    devices.l1.clipboard.userCopies(text('ack me'));
    await harness.clock.advance(100);
    expect(devices.l1.engine.history.get()[0]?.deliveredTo.length).toBe(4);
  });

  it('newest wins when two laptops copy at the same time', async () => {
    const { devices, harness } = await fullGroup();
    devices.l1.clipboard.userCopies(text('from 1'));
    devices.l2.clipboard.userCopies(text('from 2'));
    await harness.clock.advance(100);

    const finals = [devices.l1, devices.l2, devices.l3].map(textOf);
    expect(new Set(finals).size).toBe(1);
    // Same timestamp: the higher origin id wins everywhere.
    const winner = devices.l1.member.device.id > devices.l2.member.device.id ? 'from 1' : 'from 2';
    expect(finals[0]).toBe(winner);
  });

  it('never sends content marked sensitive (password managers)', async () => {
    const { devices, harness } = await fullGroup();
    devices.l1.clipboard.userCopies(text('hunter2'), true);
    await harness.clock.advance(100);
    expect(devices.l2.clipboard.writes).toEqual([]);
    expect(devices.l1.engine.history.get()).toHaveLength(0);
  });

  it('respects "send" and "receive" switches', async () => {
    const { devices, harness } = await fullGroup();
    devices.l1.engine.updateSettings({ sendEnabled: false });
    devices.l1.clipboard.userCopies(text('private'));
    devices.l3.engine.updateSettings({ receiveEnabled: false });
    devices.l2.clipboard.userCopies(text('public'));
    await harness.clock.advance(100);
    expect(devices.l2.clipboard.writes.map((c) => c.kind === 'text' && c.text)).not.toContain(
      'private',
    );
    expect(devices.l3.clipboard.writes).toEqual([]);
    expect(textOf(devices.l1)).toBe('public');
  });

  it('rejects oversized clips with PAYLOAD_TOO_LARGE', async () => {
    const { devices } = await fullGroup();
    const result = devices.p1.engine.sendClip(text('x'.repeat(CLIP_LIMITS.textBytes + 1)));
    expect(!result.ok && result.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(devices.p1.engine.lastSendError.get()?.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('a phone that was off catches up and is notified only about the newest clip', async () => {
    const { harness, members } = setup();
    const laptop = harness.addDevice(members.l1, { subnet: HOME });
    const phone = harness.addDevice(members.p1, { subnet: HOME });
    await harness.startAll([laptop]);
    laptop.clipboard.userCopies(text('old'));
    await harness.clock.advance(1_000);
    laptop.clipboard.userCopies(text('new'));
    await harness.clock.advance(1_000);

    await harness.startAll([phone]);
    expect(phone.engine.history.get().map((entry) => entry.clip.content)).toEqual([
      text('new'),
      text('old'),
    ]);
    expect(phone.notifier.received.map((r) => r.clip.content)).toEqual([text('new')]);
  });

  it('reconnects with backoff after a laptop restarts', async () => {
    const { devices, harness } = await fullGroup();
    await devices.l2.engine.stop();
    await harness.clock.advance(100);
    expect(devices.l1.engine.status.get().kind).toBe('PARTIAL');

    await devices.l2.engine.start();
    await harness.clock.advance(SESSION_TIMING.heartbeatIntervalMs);
    expect(devices.l1.engine.status.get().kind).toBe('CONNECTED');
    expect(devices.l2.engine.status.get().kind).toBe('CONNECTED');
  });
});

describe('ownership: devices that are not paired get nothing', () => {
  it('a colleague phone with its own group never connects or receives clips', async () => {
    const { harness, members, random } = setup();
    const laptop = harness.addDevice(members.l1, { subnet: HOME });
    const colleagueGroup = createTestGroup(
      [
        { name: 'Colleague', platform: 'android' },
        { name: 'Their PC', platform: 'windows' },
      ],
      random,
    );
    const [colleagueMember] = colleagueGroup.members as [TestMember];
    const colleague = harness.addDevice(colleagueMember, {
      subnet: HOME,
      group: colleagueGroup,
    });
    await harness.startAll([laptop, colleague]);
    laptop.clipboard.userCopies(text('mine'));
    await harness.clock.advance(1_000);
    expect(colleague.notifier.received).toHaveLength(0);
    expect(colleague.engine.history.get()).toHaveLength(0);
    expect(laptop.node.connections.size).toBe(0);
  });

  it('a device holding the group key but not in the member list is rejected', async () => {
    const { harness, members, group, random } = setup();
    const laptop = harness.addDevice(members.l1, { subnet: HOME });
    const intruder = createTestMember({ name: 'Intruder', platform: 'android' }, random);
    const intruderMembership = signMembership(
      {
        ...group.membership,
        version: 1,
        members: [members.l1.device, intruder.device],
        updatedBy: intruder.device.id,
      },
      intruder.identity,
    );
    const thief = harness.addDevice(intruder, {
      subnet: HOME,
      group: { ...group, membership: intruderMembership },
    });
    await harness.startAll([laptop, thief]);
    laptop.clipboard.userCopies(text('secret'));
    await harness.clock.advance(15_000);

    expect(thief.engine.history.get()).toHaveLength(0);
    expect(thief.engine.status.get().issue).toMatchObject({ code: 'AUTH_FAILED' });
    expect(laptop.engine.peers.get().every((peer) => peer.state !== 'connected')).toBe(true);
  });

  it('a removed phone learns it was removed and stops', async () => {
    const { harness, members, group } = setup();
    const withoutIphone: DeviceRecord[] = group.membership.members.filter(
      (m) => m.id !== members.p2.device.id,
    );
    const updated = signMembership(
      {
        ...group.membership,
        version: 2,
        members: withoutIphone,
        updatedBy: members.l1.device.id,
        updatedAt: 5,
      },
      members.l1.identity,
    );
    const l1 = harness.addDevice(members.l1, {
      subnet: HOME,
      group: { ...group, membership: updated },
    });
    const l2 = harness.addDevice(members.l2, { subnet: HOME });
    const iphone = harness.addDevice(members.p2, { subnet: HOME });
    await harness.startAll([l2, iphone]);
    await harness.startAll([l1]);
    await harness.clock.advance(1_000);

    expect(l2.adoptedMemberships.map((m) => m.version)).toEqual([2]);
    expect(iphone.engine.status.get().issue?.code).toBe('REMOVED_FROM_GROUP');
    l1.clipboard.userCopies(text('after removal'));
    await harness.clock.advance(1_000);
    expect(iphone.notifier.received).toHaveLength(0);
  });
});

describe('explaining connection problems', () => {
  /** A group of exactly one laptop and one phone. */
  async function laptopAndPhone(phoneSubnet: string | null = HOME) {
    const group = createTestGroup(
      [
        { name: 'Laptop-1', platform: 'windows' },
        { name: 'Pixel', platform: 'android' },
      ],
      new SeededRandom(77),
    );
    const harness = new TestHarness(group);
    const [laptopMember, phoneMember] = group.members as [TestMember, TestMember];
    const laptop = harness.addDevice(laptopMember, { subnet: HOME });
    const phone = harness.addDevice(phoneMember, { subnet: phoneSubnet });
    return Promise.resolve({ harness, laptop, phone });
  }

  it('NO_NETWORK when the phone has no Wi-Fi', async () => {
    const { harness, laptop, phone } = await laptopAndPhone(null);
    await harness.startAll([laptop, phone]);
    expect(phone.engine.status.get().issue).toMatchObject({
      code: 'NO_NETWORK',
      details: { networkKind: 'none' },
    });
  });

  it('NO_NETWORK when the phone switches to mobile data', async () => {
    const { harness, laptop, phone } = await laptopAndPhone();
    await harness.startAll([laptop, phone]);
    phone.node.moveTo(null, 'cellular');
    await harness.clock.advance(100);
    expect(phone.engine.status.get().issue?.code).toBe('NO_NETWORK');
  });

  it('DIFFERENT_NETWORK when the phone joins another Wi-Fi', async () => {
    const { harness, laptop, phone } = await laptopAndPhone();
    await harness.startAll([laptop, phone]);
    expect(phone.engine.status.get().kind).toBe('CONNECTED');

    phone.node.moveTo(OFFICE);
    await harness.clock.advance(5_000);
    expect(phone.engine.status.get().kind).toBe('SEARCHING');
    await harness.clock.advance(10_000);
    expect(phone.engine.status.get().issue).toMatchObject({
      code: 'DIFFERENT_NETWORK',
      details: { localSubnet: OFFICE, peerName: 'Laptop-1', peerSubnet: HOME },
    });
  });

  it('recovers automatically when the phone comes back', async () => {
    const { harness, laptop, phone } = await laptopAndPhone();
    await harness.startAll([laptop, phone]);
    phone.node.moveTo(OFFICE);
    await harness.clock.advance(15_000);
    phone.node.moveTo(HOME);
    await harness.clock.advance(1_000);
    expect(phone.engine.status.get().kind).toBe('CONNECTED');
  });

  it('PEER_UNREACHABLE when a firewall blocks the laptop', async () => {
    const { harness, laptop, phone } = await laptopAndPhone();
    harness.network.block('Laptop-1', 'Pixel');
    await harness.startAll([laptop, phone]);
    await harness.clock.advance(1_000);
    expect(phone.engine.status.get().issue).toMatchObject({
      code: 'PEER_UNREACHABLE',
      details: { peerName: 'Laptop-1', cause: 'timeout' },
    });
  });

  it('NO_DESKTOP_ONLINE when the laptop app is closed', async () => {
    const { harness, laptop, phone } = await laptopAndPhone();
    await harness.startAll([phone]);
    await harness.clock.advance(15_000);
    expect(phone.engine.status.get().issue?.code).toBe('NO_DESKTOP_ONLINE');
    expect(laptop.engine.status.get().kind).toBe('SEARCHING'); // never started
  });

  it('NO_PEERS on a laptop that finds nobody', async () => {
    const { harness, laptop } = await laptopAndPhone();
    await harness.startAll([laptop]);
    await harness.clock.advance(15_000);
    expect(laptop.engine.status.get().issue).toMatchObject({
      code: 'NO_PEERS',
      details: { localSubnet: HOME },
    });
  });

  it('detects a silently dropped connection through heartbeats', async () => {
    const { harness, laptop, phone } = await laptopAndPhone();
    await harness.startAll([laptop, phone]);
    harness.network.block('Laptop-1', 'Pixel');
    await harness.clock.advance(
      SESSION_TIMING.deadAfterMs + SESSION_TIMING.heartbeatIntervalMs * 2,
    );
    expect(phone.engine.peers.get().find((p) => p.name === 'Laptop-1')?.state).not.toBe(
      'connected',
    );
    expect(phone.engine.status.get().kind).toBe('ERROR');
  });

  it('LOCAL_NETWORK_PERMISSION when iOS denies local network access', async () => {
    const { harness, members } = setup();
    const iphone = harness.addDevice(members.p2, { subnet: HOME });
    iphone.node.permission = 'denied';
    await harness.startAll([iphone]);
    expect(iphone.engine.status.get().issue?.code).toBe('LOCAL_NETWORK_PERMISSION');
  });

  it('start() fails with PORT_IN_USE when the laptop cannot listen', async () => {
    const { harness, members } = setup();
    const laptop = harness.addDevice(members.l1, { subnet: HOME });
    laptop.node.failListen = true;
    const started = await laptop.engine.start();
    expect(!started.ok && started.error.code).toBe('PORT_IN_USE');
  });
});
