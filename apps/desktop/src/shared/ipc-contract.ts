/**
 * Contract between the Electron main process and the renderer.
 *
 * Single source of truth for IPC channel names and payload types. The preload
 * script implements `ClipBridgeApi`; the renderer consumes it as `window.clipbridge`.
 */

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
} as const;

export type DesktopPlatform = 'windows' | 'macos' | 'linux';

export interface AppInfo {
  readonly appVersion: string;
  readonly coreVersion: string;
  readonly protocolVersion: number;
  readonly platform: DesktopPlatform;
}

export interface ClipBridgeApi {
  getAppInfo(): Promise<AppInfo>;
}
