import { CORE_VERSION, PROTOCOL_VERSION } from '@clipbridge/core';

export type MobilePlatform = 'android' | 'ios';

export interface AppInfo {
  readonly appVersion: string;
  readonly coreVersion: string;
  readonly protocolVersion: number;
  readonly platform: MobilePlatform;
}

/** Builds the version info shown on the About section. */
export function buildAppInfo(appVersion: string | undefined, platform: MobilePlatform): AppInfo {
  return {
    appVersion: appVersion ?? 'unknown',
    coreVersion: CORE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    platform,
  };
}
