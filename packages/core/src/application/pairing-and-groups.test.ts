/**
 * Milestone 3 behaviour on the simulated LAN: pairing by code and QR, approval,
 * wrong codes, expiry, and group changes (rename, remove + key rotation).
 */

import { describe, expect, it } from 'vitest';

import type { AppError } from '../domain/errors';
import type { Result } from '../domain/result';
import { normalizePairingCode, pairingSecret, parsePairingLink } from '../protocol/pairing';
import { MemoryLogger } from '../testing/fakes';
import { createTestGroup, createTestMember, type TestMember } from '../testing/fixtures';
import { type TestDevice, TestHarness } from '../testing/harness';
import { SeededRandom } from '../testing/seeded-random';
import { PAIRING_TIMING, type PairingHostSession } from './pairing-host';
import { type JoinedGroup, joinGroup } from './pairing-joiner';

const HOME = '192.168.1.0/24';

async function laptopAlone() {
  const random = new SeededRandom(31);
  const group = createTestGroup([{ name: 'Laptop', platform: 'windows' }], random);
  const harness = new TestHarness(group);
  const [member] = group.members as [TestMember];
  const laptop = harness.addDevice(member, { subnet: HOME });
  await harness.startAll([laptop]);
  return { random, group, harness, laptop };
}

function startPairing(device: TestDevice): PairingHostSession {
  const session = device.engine.startPairing();
  if (!session.ok) throw new Error(session.error.code);
  return session.value;
}

function codeSecret(session: PairingHostSession): Uint8Array {
  return pairingSecret('code', normalizePairingCode(session.code) ?? '');
}

function join(
  harness: TestHarness,
  member: TestMember,
  secret: Uint8Array,
  options: { method?: 'code' | 'qr'; expectedHostSignPublicKey?: string; nodeName?: string } = {},
) {
  const node = harness.network.createNode(options.nodeName ?? `${member.device.name}-joiner`, {
    subnet: HOME,
  });
  return joinGroup(
    {
      self: member,
      addresses: [{ host: 'Laptop', port: 47821 }],
      method: options.method ?? 'code',
      secret,
      ...(options.expectedHostSignPublicKey
        ? { expectedHostSignPublicKey: options.expectedHostSignPublicKey }
        : {}),
    },
    {
      transport: node.transport,
      clock: harness.clock,
      random: new SeededRandom(99),
      logger: new MemoryLogger(),
    },
  );
}

async function settle(harness: TestHarness, ms = 50): Promise<void> {
  await harness.clock.advance(ms);
}

function expectJoined(result: Result<JoinedGroup, AppError>): JoinedGroup {
  if (!result.ok) throw new Error(`join failed: ${result.error.code}`);
  return result.value;
}

describe('pairing by code', () => {
  it('a phone joins after the user allows it, then syncs', async () => {
    const { harness, laptop, random } = await laptopAlone();
    const host = startPairing(laptop);
    expect(laptop.node.advertisement?.pairingMode).toBe(true);
    expect(host.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    const phone = createTestMember({ name: 'Pixel', platform: 'android' }, random);
    const attempt = join(harness, phone, codeSecret(host));
    await settle(harness);
    expect(attempt.state.get().kind).toBe('awaiting-approval');
    expect(host.state.get()).toMatchObject({
      kind: 'awaiting-approval',
      request: { name: 'Pixel', platform: 'android', deviceId: phone.device.id },
    });

    host.approve();
    const joined = expectJoined(await attempt.result);
    await settle(harness);
    expect(host.state.get().kind).toBe('completed');
    expect(laptop.node.advertisement?.pairingMode).toBe(false);
    expect(joined.membership.members.map((m) => m.name).sort()).toEqual(['Laptop', 'Pixel']);
    expect(laptop.engine.membership.get().members).toHaveLength(2);
    expect(laptop.groupChanges.at(-1)?.membership.version).toBe(2);

    // The phone now runs a normal engine with what it received.
    const phoneDevice = harness.addDevice(phone, { subnet: HOME, group: joined });
    await harness.startAll([phoneDevice]);
    expect(phoneDevice.engine.status.get().kind).toBe('CONNECTED');
    laptop.clipboard.userCopies({ kind: 'text', text: 'welcome' });
    await settle(harness, 100);
    expect(phoneDevice.notifier.received.map((r) => r.clip.content)).toEqual([
      { kind: 'text', text: 'welcome' },
    ]);
  });

  it('a laptop joins and the other members learn about it', async () => {
    const random = new SeededRandom(8);
    const group = createTestGroup(
      [
        { name: 'Laptop', platform: 'windows' },
        { name: 'Desktop', platform: 'macos' },
      ],
      random,
    );
    const harness = new TestHarness(group);
    const [laptopMember, desktopMember] = group.members as [TestMember, TestMember];
    const laptop = harness.addDevice(laptopMember, { subnet: HOME });
    const desktop = harness.addDevice(desktopMember, { subnet: HOME });
    await harness.startAll([laptop, desktop]);

    const host = startPairing(laptop);
    const newcomer = createTestMember({ name: 'Mac mini', platform: 'macos' }, random);
    const attempt = join(harness, newcomer, codeSecret(host));
    await settle(harness);
    host.approve();
    const joined = expectJoined(await attempt.result);
    await settle(harness);
    expect(
      desktop.engine.membership
        .get()
        .members.map((m) => m.name)
        .sort(),
    ).toEqual(['Desktop', 'Laptop', 'Mac mini']);

    const mini = harness.addDevice(newcomer, { subnet: HOME, group: joined });
    await harness.startAll([mini]);
    expect(mini.engine.status.get()).toMatchObject({ kind: 'CONNECTED', connectedCount: 2 });
    expect(desktop.engine.status.get()).toMatchObject({ kind: 'CONNECTED', connectedCount: 2 });
  });

  it('three wrong codes end the session', async () => {
    const { harness, laptop, random } = await laptopAlone();
    const host = startPairing(laptop);
    const guesser = createTestMember({ name: 'Guesser', platform: 'android' }, random);
    const wrong = pairingSecret('code', 'AAAAAAAAAAAA');

    const left: number[] = [];
    for (let i = 0; i < 3; i++) {
      const attempt = join(harness, guesser, wrong, { nodeName: `guess-${i}` });
      await settle(harness);
      const result = await attempt.result;
      if (!result.ok && result.error.code === 'PAIRING_CODE_INVALID')
        left.push(result.error.details.attemptsLeft);
    }
    expect(left).toEqual([2, 1, 0]);
    expect(host.state.get()).toMatchObject({
      kind: 'failed',
      error: { code: 'PAIRING_CODE_INVALID' },
    });

    // Even the right code no longer works.
    const late = join(harness, guesser, codeSecret(host), { nodeName: 'late' });
    await settle(harness);
    expect((await late.result).ok).toBe(false);
    expect(laptop.engine.membership.get().members).toHaveLength(1);
  });

  it('the joiner is told when the user denies it', async () => {
    const { harness, laptop, random } = await laptopAlone();
    const host = startPairing(laptop);
    const attempt = join(
      harness,
      createTestMember({ name: 'Stranger', platform: 'ios' }, random),
      codeSecret(host),
    );
    await settle(harness);
    host.deny();
    expect(await attempt.result).toMatchObject({ ok: false, error: { code: 'PAIRING_REJECTED' } });
    expect(laptop.engine.membership.get().members).toHaveLength(1);
  });

  it('the code expires after two minutes', async () => {
    const { harness, laptop, random } = await laptopAlone();
    const host = startPairing(laptop);
    await harness.clock.advance(PAIRING_TIMING.durationMs + 1);
    expect(host.state.get()).toMatchObject({ kind: 'failed', error: { code: 'PAIRING_EXPIRED' } });
    const attempt = join(
      harness,
      createTestMember({ name: 'Late', platform: 'ios' }, random),
      codeSecret(host),
    );
    await settle(harness);
    expect(await attempt.result).toMatchObject({ ok: false, error: { code: 'PAIRING_EXPIRED' } });
  });

  it('a host that is not pairing refuses joiners', async () => {
    const { harness, random } = await laptopAlone();
    const attempt = join(
      harness,
      createTestMember({ name: 'Early', platform: 'ios' }, random),
      pairingSecret('code', 'K7QM2XPA9FRT'),
    );
    await settle(harness);
    expect(await attempt.result).toMatchObject({ ok: false, error: { code: 'PAIRING_EXPIRED' } });
  });

  it('a joiner that gives up lets another device try', async () => {
    const { harness, laptop, random } = await laptopAlone();
    const host = startPairing(laptop);
    const first = join(
      harness,
      createTestMember({ name: 'First', platform: 'ios' }, random),
      codeSecret(host),
    );
    await settle(harness);
    first.cancel();
    await settle(harness);
    expect(host.state.get().kind).toBe('waiting');
  });
});

describe('pairing by QR code', () => {
  it('joins with the QR token and checks the host key from the QR', async () => {
    const { harness, laptop, random } = await laptopAlone();
    const host = startPairing(laptop);
    const link = parsePairingLink(host.qrLink);
    if (!link) throw new Error('invalid QR link');
    expect(link.hosts).toEqual([laptop.node.ipv4]);

    const phone = createTestMember({ name: 'iPhone', platform: 'ios' }, random);
    const attempt = join(harness, phone, link.token, {
      method: 'qr',
      expectedHostSignPublicKey: link.hostSignPublicKey,
    });
    await settle(harness);
    host.approve();
    expect((await attempt.result).ok).toBe(true);
  });

  it('refuses a host that is not the one from the QR code', async () => {
    const { harness, laptop, random } = await laptopAlone();
    const host = startPairing(laptop);
    const link = parsePairingLink(host.qrLink);
    if (!link) throw new Error('invalid QR link');
    const impostorKey = createTestMember({ name: 'x', platform: 'windows' }, random).device
      .signPublicKey;
    const attempt = join(
      harness,
      createTestMember({ name: 'iPhone', platform: 'ios' }, random),
      link.token,
      {
        method: 'qr',
        expectedHostSignPublicKey: impostorKey,
      },
    );
    await settle(harness);
    expect(await attempt.result).toMatchObject({ ok: false, error: { code: 'PROTOCOL_ERROR' } });
    expect(host.state.get().kind).toBe('waiting');
  });

  it('phones cannot host pairing', async () => {
    const random = new SeededRandom(3);
    const group = createTestGroup([{ name: 'Pixel', platform: 'android' }], random);
    const harness = new TestHarness(group);
    const [member] = group.members as [TestMember];
    const phone = harness.addDevice(member, { subnet: HOME });
    await harness.startAll([phone]);
    expect(phone.engine.startPairing().ok).toBe(false);
  });
});

describe('group changes', () => {
  function threeDevices() {
    const random = new SeededRandom(12);
    const group = createTestGroup(
      [
        { name: 'Laptop', platform: 'windows' },
        { name: 'Desktop', platform: 'macos' },
        { name: 'Old Phone', platform: 'android' },
      ],
      random,
    );
    const harness = new TestHarness(group);
    const [a, b, c] = group.members as [TestMember, TestMember, TestMember];
    const laptop = harness.addDevice(a, { subnet: HOME });
    const desktop = harness.addDevice(b, { subnet: HOME });
    const oldPhone = harness.addDevice(c, { subnet: HOME });
    return { harness, group, laptop, desktop, oldPhone };
  }

  it('renaming a device reaches every member', async () => {
    const { harness, laptop, desktop, oldPhone } = threeDevices();
    await harness.startAll([laptop, desktop, oldPhone]);
    expect(laptop.engine.renameMember(oldPhone.member.device.id, '  Work phone ').ok).toBe(true);
    await settle(harness);
    for (const device of [desktop, oldPhone]) {
      expect(
        device.engine.peers.get().some((p) => p.name === 'Work phone') ||
          device.engine.membership.get().members.some((m) => m.name === 'Work phone'),
      ).toBe(true);
    }
    expect(laptop.engine.renameMember(oldPhone.member.device.id, '').ok).toBe(false);
  });

  it('removing a device rotates the key; the rest keep syncing, the removed one gets nothing', async () => {
    const { harness, laptop, desktop, oldPhone } = threeDevices();
    await harness.startAll([laptop, desktop, oldPhone]);

    expect(laptop.engine.removeMember(oldPhone.member.device.id).ok).toBe(true);
    await settle(harness, 3_000);

    expect(oldPhone.engine.status.get().issue?.code).toBe('REMOVED_FROM_GROUP');
    for (const device of [laptop, desktop]) {
      expect(device.groupChanges.at(-1)?.epoch).toBe(2);
      expect(device.engine.membership.get().members).toHaveLength(2);
      expect(device.engine.status.get().kind).toBe('CONNECTED');
    }
    // The new key is different and both remaining devices hold the same one.
    const laptopKey = laptop.groupChanges.at(-1)?.groupKey;
    expect(desktop.groupChanges.at(-1)?.groupKey).toEqual(laptopKey);
    expect(laptopKey).not.toEqual(harness.group.groupKey);

    laptop.clipboard.userCopies({ kind: 'text', text: 'after removal' });
    await settle(harness, 100);
    expect(desktop.clipboard.content).toEqual({ kind: 'text', text: 'after removal' });
    expect(oldPhone.notifier.received).toHaveLength(0);
    expect(laptop.engine.removeMember(laptop.member.device.id).ok).toBe(false);
  });

  it('a device that was off during the rotation catches up when it returns', async () => {
    const { harness, laptop, desktop, oldPhone } = threeDevices();
    await harness.startAll([laptop, oldPhone]); // desktop is switched off
    laptop.engine.removeMember(oldPhone.member.device.id);
    await settle(harness, 3_000);

    await harness.startAll([desktop]); // still on epoch 1 with the old member list
    await settle(harness, 5_000);
    expect(desktop.groupChanges.at(-1)?.epoch).toBe(2);
    expect(desktop.engine.membership.get().members).toHaveLength(2);
    expect(desktop.engine.status.get().kind).toBe('CONNECTED');

    desktop.clipboard.userCopies({ kind: 'text', text: 'caught up' });
    await settle(harness, 100);
    expect(laptop.clipboard.content).toEqual({ kind: 'text', text: 'caught up' });
  });

  it('a removed device that restarts with its saved list stays removed and does not connect', async () => {
    const { harness, laptop, desktop, oldPhone } = threeDevices();
    await harness.startAll([laptop, desktop, oldPhone]);
    laptop.engine.removeMember(oldPhone.member.device.id);
    await settle(harness, 3_000);
    const saved = oldPhone.groupChanges.at(-1);
    if (!saved) throw new Error('removed device did not save its member list');

    const restarted = harness.addDevice(
      { ...oldPhone.member, device: { ...oldPhone.member.device, name: 'Old Phone again' } },
      { subnet: HOME, group: saved },
    );
    await harness.startAll([restarted]);
    expect(restarted.engine.status.get().issue?.code).toBe('REMOVED_FROM_GROUP');
    expect(restarted.node.connections.size).toBe(0);
  });

  it('the removed device cannot reconnect, even with the old key', async () => {
    const { harness, group, laptop, desktop, oldPhone } = threeDevices();
    await harness.startAll([laptop, desktop]);
    laptop.engine.removeMember(oldPhone.member.device.id);
    await settle(harness, 3_000);

    // The removed phone was offline and still believes it is a member.
    await oldPhone.engine.start();
    await settle(harness, 15_000);
    expect(oldPhone.engine.status.get().kind).not.toBe('CONNECTED');
    expect(oldPhone.engine.history.get()).toHaveLength(0);
    expect(group.membership.members).toHaveLength(3); // fixture untouched
  });
});
