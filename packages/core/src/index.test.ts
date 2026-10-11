import { describe, expect, it } from 'vitest';

import { CORE_VERSION, PROTOCOL_VERSION } from './index';

describe('@clipbridge/core public API', () => {
  it('exposes a semver core version', () => {
    expect(CORE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exposes a positive integer protocol version', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});
