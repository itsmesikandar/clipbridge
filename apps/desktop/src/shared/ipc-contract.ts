/**
 * Contract between the Electron main process and the renderer.
 *
 * Single source of truth for IPC channel names and payload types. Input
 * validation lives in `ipc-schemas.ts` (main process only). The preload
 * script implements `ClipBridgeApi`; the renderer uses it as `window.clipbridge`.
 */

import type {
  ActionResult,
  AppSnapshot,
  DiagnosticsView,
  JoinRequestInput,
  SettingsPatch,
} from '@clipbridge/app';

export type {
  ActionResult,
  AppSnapshot,
  DiagnosticsView,
  HistoryItemView,
  HostingView,
  JoiningView,
  JoinRequestInput,
  PairingView,
  SettingsPatch,
  SettingsView,
} from '@clipbridge/app';

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  getState: 'state:get',
  stateChanged: 'state:changed',
  updateSettings: 'settings:update',
  copyHistoryItem: 'history:copy',
  clearHistory: 'history:clear',
  getDiagnostics: 'diagnostics:get',
  createGroup: 'group:create',
  startHosting: 'pairing:host-start',
  stopHosting: 'pairing:host-stop',
  approveJoin: 'pairing:approve',
  denyJoin: 'pairing:deny',
  startJoinSearch: 'pairing:search-start',
  stopJoinSearch: 'pairing:search-stop',
  join: 'pairing:join',
  cancelJoin: 'pairing:join-cancel',
  renameDevice: 'devices:rename',
  removeDevice: 'devices:remove',
  resetThisDevice: 'devices:reset-self',
} as const;

export type DesktopPlatform = 'windows' | 'macos' | 'linux';

export interface AppInfo {
  readonly appVersion: string;
  readonly coreVersion: string;
  readonly protocolVersion: number;
  readonly platform: DesktopPlatform;
}

export interface PairingApi {
  createGroup(): Promise<ActionResult<void>>;
  startHosting(): Promise<ActionResult<void>>;
  stopHosting(): Promise<void>;
  approveJoin(): Promise<void>;
  denyJoin(): Promise<void>;
  startJoinSearch(): Promise<void>;
  stopJoinSearch(): Promise<void>;
  join(input: JoinRequestInput): Promise<ActionResult<void>>;
  cancelJoin(): Promise<void>;
}

export interface DevicesApi {
  rename(id: string, name: string): Promise<ActionResult<void>>;
  remove(id: string): Promise<ActionResult<void>>;
  /** Forgets the group on this computer only. */
  resetThisDevice(): Promise<ActionResult<void>>;
}

export interface ClipBridgeApi {
  getAppInfo(): Promise<AppInfo>;
  getState(): Promise<AppSnapshot>;
  /** Subscribes to state pushes; returns an unsubscribe function. */
  onStateChanged(listener: (snapshot: AppSnapshot) => void): () => void;
  updateSettings(patch: SettingsPatch): Promise<void>;
  copyHistoryItem(id: string): Promise<ActionResult<void>>;
  clearHistory(): Promise<void>;
  getDiagnostics(): Promise<DiagnosticsView>;
  readonly pairing: PairingApi;
  readonly devices: DevicesApi;
}
