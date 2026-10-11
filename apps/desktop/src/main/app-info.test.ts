import { CORE_VERSION, PROTOCOL_VERSION } from '@clipbridge/core';
import { describe, expect, it } from 'vitest';

import { buildAppInfo, toDesktopPlatform } from './app-info';

describe('toDesktopPlatform', () => {
  it.each([
    ['win32', 'windows'],
    ['darwin', 'macos'],
    ['linux', 'linux'],
  ] as const)('maps %s to %s', (nodePlatform, expected) => {
    expect(toDesktopPlatform(nodePlatform)).toBe(expected);
  });
});

describe('buildAppInfo', () => {
  it('combines app version with core and protocol versions', () => {
    expect(buildAppInfo('1.2.3', 'win32')).toEqual({
      appVersion: '1.2.3',
      coreVersion: CORE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      platform: 'windows',
    });
  });
});
