/**
 * Simulated soak test (docs/milestones/M7): 30 minutes of random copies,
 * phones leaving and rejoining the Wi-Fi and a laptop restarting. Afterwards
 * every device must be connected and agree on the newest clip, with no errors.
 */

import { describe, expect, it } from 'vitest';

import { computeContentHash } from '../crypto/content-hash';
import type { ClipContent } from '../domain/clip';
import { createTestGroup } from '../testing/fixtures';
import { type TestDevice, TestHarness } from '../testing/harness';
import { SeededRandom } from '../testing/seeded-random';

const HOME = '192.168.1.0/24';
const MINUTE = 60_000;

describe('soak', { timeout: 120_000 }, () => {
  it('30 minutes of copies, network drops and a restart end in agreement', async () => {
    const random = new SeededRandom(99);
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
    const devices: TestDevice[] = group.members.map((member) =>
      harness.addDevice(member, { subnet: HOME }),
    );
    await harness.startAll(devices);

    const pick = (max: number): number => (random.randomBytes(1)[0] ?? 0) % max;
    let copies = 0;

    for (let minute = 0; minute < 30; minute++) {
      // Three copies per minute from random devices (phones share, laptops copy).
      for (let i = 0; i < 3; i++) {
        const device = devices[pick(devices.length)];
        if (!device) continue;
        const content: ClipContent = {
          kind: 'text',
          text: `clip ${copies} from ${device.member.device.name}`,
        };
        if (
          device.member.device.platform === 'android' ||
          device.member.device.platform === 'ios'
        ) {
          device.engine.sendClip(content);
        } else {
          device.clipboard.userCopies(content);
        }
        copies += 1;
        await harness.clock.advance(20_000);
      }
      // Every 5 minutes a phone leaves the Wi-Fi for a minute.
      if (minute % 5 === 2) {
        const phone = devices[3 + pick(2)];
        phone?.node.moveTo(null);
        await harness.clock.advance(MINUTE);
        phone?.node.moveTo(HOME);
      }
      // Laptop-3 restarts once.
      if (minute === 15) {
        await devices[2]?.engine.stop();
        await harness.clock.advance(10_000);
        await devices[2]?.engine.start();
      }
    }

    // One final copy everyone must end up with.
    const lastContent: ClipContent = { kind: 'text', text: 'final clip' };
    devices[0]?.clipboard.userCopies(lastContent);
    await harness.clock.advance(2 * MINUTE);

    const expected = computeContentHash(lastContent);
    for (const device of devices) {
      expect(device.engine.status.get().kind, device.member.device.name).toBe('CONNECTED');
      const newest = device.engine.history.get()[0]?.clip;
      expect(newest && computeContentHash(newest.content), device.member.device.name).toBe(
        expected,
      );
      const errors = device.logger.entries.filter((entry) => entry.level === 'error');
      expect(errors, device.member.device.name).toEqual([]);
    }
    for (const laptop of devices.slice(0, 3)) {
      const content = laptop.clipboard.content;
      expect(content && computeContentHash(content)).toBe(expected);
    }
    expect(copies).toBe(90);
  });
});
