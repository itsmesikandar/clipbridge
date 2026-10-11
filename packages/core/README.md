# @clipbridge/core

Platform-neutral domain and application logic shared by the desktop and mobile apps: protocol, crypto, sync engine, connection diagnosis. Design: [`docs/PLAN.md`](../../docs/PLAN.md), details: [`docs/milestones/M1-core.md`](../../docs/milestones/M1-core.md).

## Usage

Apps implement the ports with platform adapters and drive one engine:

```ts
import { createEngine } from '@clipbridge/core';

const engine = createEngine({
  self: { device, identity }, // this device's record + identity keys
  group: { groupKey, epoch, membership }, // from pairing (secure storage)
  ports: { clock, random, logger, transport, discovery, networkInfo, clipboard, notifier },
  onMembershipChanged: (membership) => storage.set('membership', membership),
});

const started = await engine.start(); // Result<void, AppError>
engine.status.subscribe((status) => render(status)); // kind + issue for the banner
engine.peers.subscribe((peers) => renderDevices(peers));
engine.history.subscribe((entries) => renderRecent(entries));
engine.sendClip({ kind: 'url', url: 'https://example.com' }); // phones: share sheet
```

### Ports

| Port                                | Desktop adapter (M2)        | Mobile adapter (M4)                |
| ----------------------------------- | --------------------------- | ---------------------------------- |
| `ClockPort`                         | `Date.now` + `setTimeout`   | same                               |
| `RandomPort`                        | `crypto.getRandomValues`    | `expo-crypto`                      |
| `TransportPort`                     | `ws` server + client        | RN `WebSocket` (dial only)         |
| `DiscoveryPort`                     | `bonjour-service`           | `react-native-zeroconf`            |
| `NetworkInfoPort`                   | `os.networkInterfaces()`    | `expo-network`                     |
| `ClipboardPort`                     | Electron `clipboard` + poll | `expo-clipboard` (write)           |
| `NotifierPort`                      | Electron `Notification`     | `expo-notifications`               |
| `LoggerPort`                        | rotating file               | console + ring buffer              |
| `StoragePort` / `SecureStoragePort` | JSON files / `safeStorage`  | AsyncStorage / `expo-secure-store` |

Adapter contract notes:

- `TransportConnection` listeners may unsubscribe while being called; iterate over a copy.
- `onClose` fires exactly once; registering after close calls the listener immediately.
- Map socket errors to `PEER_UNREACHABLE` with cause `refused` / `timeout` / `unreachable`.

## Testing

`@clipbridge/core/testing` provides an in-memory LAN and fakes:

```ts
import { createTestGroup, TestHarness } from '@clipbridge/core/testing';

const group = createTestGroup([
  { name: 'Laptop', platform: 'windows' },
  { name: 'Phone', platform: 'android' },
]);
const harness = new TestHarness(group);
const laptop = harness.addDevice(group.members[0], { subnet: '192.168.1.0/24' });
const phone = harness.addDevice(group.members[1], { subnet: '192.168.1.0/24' });
await harness.startAll([laptop, phone]);
laptop.clipboard.userCopies({ kind: 'text', text: 'hi' });
await harness.clock.advance(100);
// phone.notifier.received → [{ clip, from: Laptop }]
```

## Rules

- No platform imports (`node:*`, `electron`, `react-native`, `expo-*`, …). Platform features are reached through ports. Enforced by ESLint.
- `src/domain/` must not import `application/`, `ports/`, `protocol/` or `crypto/`.
- Apps import only from `@clipbridge/core` and `@clipbridge/core/testing`.
- Never log clip contents or key material (`LogContext` only accepts primitives).

The package is consumed as TypeScript source (no build step); each app's bundler compiles it.

## Scripts

| Command              | Does                                    |
| -------------------- | --------------------------------------- |
| `pnpm test`          | unit + integration tests                |
| `pnpm test:coverage` | with coverage; fails below 90 % lines   |
| `pnpm typecheck`     | type-check                              |
| `pnpm lint`          | lint, including architecture boundaries |
