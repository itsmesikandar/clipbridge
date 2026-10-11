import { CORE_VERSION, PROTOCOL_VERSION } from '@clipbridge/core';

import { buildAppInfo } from './app-info';

describe('buildAppInfo', () => {
  it('combines app version with core and protocol versions', () => {
    expect(buildAppInfo('1.2.3', 'android')).toEqual({
      appVersion: '1.2.3',
      coreVersion: CORE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      platform: 'android',
    });
  });

  it('reports an unknown app version when the manifest has none', () => {
    expect(buildAppInfo(undefined, 'ios').appVersion).toBe('unknown');
  });
});
