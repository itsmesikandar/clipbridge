import {
  createEngine,
  type Engine,
  type EngineSettings,
  type GroupCredentials,
} from '../application/engine';
import type { Membership } from '../domain/membership';
import { FakeClock } from './fake-clock';
import { FakeClipboard, FakeNotifier, MemoryLogger } from './fakes';
import type { TestGroup, TestMember } from './fixtures';
import { InMemoryNetwork, type NetworkNode, type NodeOptions } from './in-memory-network';
import { SeededRandom } from './seeded-random';

export interface TestDevice {
  readonly member: TestMember;
  readonly node: NetworkNode;
  readonly engine: Engine;
  readonly clipboard: FakeClipboard;
  readonly notifier: FakeNotifier;
  readonly logger: MemoryLogger;
  readonly adoptedMemberships: Membership[];
}

export interface TestDeviceOptions extends NodeOptions {
  readonly settings?: Partial<EngineSettings>;
  /** Overrides group credentials (e.g. a device holding a stale key). */
  readonly group?: GroupCredentials;
}

/** Wires a member into the simulated network with fake ports. */
export class TestHarness {
  readonly clock = new FakeClock();
  readonly network = new InMemoryNetwork();
  private seed = 1000;

  constructor(readonly group: TestGroup) {}

  addDevice(member: TestMember, options: TestDeviceOptions): TestDevice {
    const node = this.network.createNode(member.device.name, options);
    const clipboard = new FakeClipboard();
    const notifier = new FakeNotifier();
    const logger = new MemoryLogger();
    const adoptedMemberships: Membership[] = [];
    const isPhone = member.device.platform === 'android' || member.device.platform === 'ios';
    const engine = createEngine({
      self: member,
      group: options.group ?? this.group,
      settings: options.settings ?? {},
      ports: {
        clock: this.clock,
        random: new SeededRandom(this.seed++),
        logger,
        transport: node.transport,
        discovery: node.discovery,
        networkInfo: node.networkInfo,
        clipboard: isPhone ? clipboard.asPhoneClipboard() : clipboard,
        notifier,
      },
      onMembershipChanged: (membership) => adoptedMemberships.push(membership),
    });
    return { member, node, engine, clipboard, notifier, logger, adoptedMemberships };
  }

  /** Starts engines and lets discovery, dialing and handshakes complete. */
  async startAll(devices: readonly TestDevice[]): Promise<void> {
    for (const device of devices) {
      const started = await device.engine.start();
      if (!started.ok)
        throw new Error(`${device.member.device.name} failed: ${started.error.code}`);
    }
    await this.clock.advance(100);
  }
}
