/**
 * Test doubles for @clipbridge/core, published as `@clipbridge/core/testing`.
 * Platform-neutral, so app tests (desktop, mobile) can use them too.
 */
export { FakeClock, settle } from './fake-clock';
export { FakeClipboard, FakeNotifier, type LogEntry, MemoryLogger } from './fakes';
export {
  createTestGroup,
  createTestMember,
  type TestDeviceSpec,
  type TestGroup,
  type TestMember,
} from './fixtures';
export { type TestDevice, type TestDeviceOptions, TestHarness } from './harness';
export { InMemoryNetwork, NetworkNode, type NodeOptions } from './in-memory-network';
export { SeededRandom } from './seeded-random';
