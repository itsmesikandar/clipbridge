/**
 * Two engines talking over real WebSockets on 127.0.0.1 (M2 §3).
 * Discovery is static here; mDNS is verified manually with two app instances.
 */

import {
  type Advertisement,
  createEngine,
  type DiscoveryListener,
  type DiscoveryPort,
  type Engine,
  type NetworkInfoPort,
  ok,
} from '@clipbridge/core';
import {
  createTestGroup,
  FakeClipboard,
  FakeNotifier,
  MemoryLogger,
  type TestMember,
} from '@clipbridge/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { NodeRandom } from './adapters/node-random';
import { SystemClock } from './adapters/system-clock';
import { WsTransport } from './adapters/ws-transport';

/** Shared "LAN" where every advertisement is visible to every browser. */
class StaticDiscoveryHub {
  private readonly ads = new Map<string, Advertisement>();
  private readonly listeners = new Set<DiscoveryListener>();

  port(): DiscoveryPort {
    return {
      advertise: (ad) => {
        this.ads.set(ad.deviceId, ad);
        for (const listener of this.listeners) listener.onUp(toService(ad));
        return Promise.resolve(
          ok({ update: () => Promise.resolve(), stop: () => Promise.resolve() }),
        );
      },
      browse: (listener) => {
        this.listeners.add(listener);
        for (const ad of this.ads.values()) listener.onUp(toService(ad));
        return Promise.resolve(ok(() => this.listeners.delete(listener)));
      },
    };
  }
}

function toService(ad: Advertisement) {
  return {
    instanceId: ad.deviceId,
    deviceId: ad.deviceId,
    groupTag: ad.groupTag,
    pairingMode: false,
    protocolVersion: ad.protocolVersion,
    addresses: [{ host: '127.0.0.1', port: ad.port }],
  };
}

const network: NetworkInfoPort = {
  // A LAN address: loopback would (correctly) be diagnosed as NO_NETWORK.
  current: () =>
    Promise.resolve({ kind: 'ethernet', ipv4: '192.168.50.10', subnet: '192.168.50.0/24' }),
  onChange: () => () => undefined,
  localNetworkPermission: () => Promise.resolve('granted'),
};

const engines: Engine[] = [];
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.stop()));
});

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('LAN sync over real WebSockets', () => {
  it('connects two computers and syncs copies both ways', async () => {
    const group = createTestGroup([
      { name: 'Laptop', platform: 'windows' },
      { name: 'Desktop', platform: 'macos' },
    ]);
    const hub = new StaticDiscoveryHub();
    const start = async (member: TestMember) => {
      const clipboard = new FakeClipboard();
      const engine = createEngine({
        self: member,
        group,
        // Port 0: let the OS choose, so the test never collides with a running app.
        settings: { listenPort: 0 },
        ports: {
          clock: new SystemClock(),
          random: new NodeRandom(),
          logger: new MemoryLogger(),
          transport: new WsTransport(),
          discovery: hub.port(),
          networkInfo: network,
          clipboard,
          notifier: new FakeNotifier(),
        },
      });
      engines.push(engine);
      const started = await engine.start();
      expect(started.ok).toBe(true);
      return { engine, clipboard };
    };

    const [laptopMember, desktopMember] = group.members as [TestMember, TestMember];
    const laptop = await start(laptopMember);
    const desktop = await start(desktopMember);

    await waitFor(
      () =>
        laptop.engine.status.get().kind === 'CONNECTED' &&
        desktop.engine.status.get().kind === 'CONNECTED',
    );

    laptop.clipboard.userCopies({ kind: 'text', text: 'over real sockets' });
    await waitFor(() => desktop.clipboard.writes.length === 1);
    expect(desktop.clipboard.content).toEqual({ kind: 'text', text: 'over real sockets' });

    desktop.clipboard.userCopies({ kind: 'url', url: 'https://example.com/back' });
    await waitFor(() => laptop.clipboard.writes.length === 1);
    expect(laptop.clipboard.content).toEqual({ kind: 'url', url: 'https://example.com/back' });
  });
});
