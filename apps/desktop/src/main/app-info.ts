import { CORE_VERSION, PROTOCOL_VERSION } from '@clipbridge/core';

import type { AppInfo, DesktopPlatform } from '../shared/ipc-contract';

/** Maps a Node.js `process.platform` value to the platforms ClipBridge supports. */
export function toDesktopPlatform(nodePlatform: NodeJS.Platform): DesktopPlatform {
  switch (nodePlatform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'linux';
  }
}

export function buildAppInfo(appVersion: string, nodePlatform: NodeJS.Platform): AppInfo {
  return {
    appVersion,
    coreVersion: CORE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    platform: toDesktopPlatform(nodePlatform),
  };
}
