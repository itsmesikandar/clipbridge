/**
 * Contract between the Electron main process and the renderer.
 *
 * Single source of truth for IPC channel names and payload types (input
 * validation lives in `ipc-schemas.ts`, used by the main process only). The preload script implements `ClipBridgeApi`; the renderer
 * consumes it as `window.clipbridge`.
 */

import type {
  ClipKind,
  ConnectionStatus,
  DevicePlatform,
  NetworkSnapshot,
  PeerView,
} from '@clipbridge/core';

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  getState: 'state:get',
  stateChanged: 'state:changed',
  updateSettings: 'settings:update',
  copyHistoryItem: 'history:copy',
  clearHistory: 'history:clear',
  getDiagnostics: 'diagnostics:get',
  devCreateGroup: 'dev:create-group',
  devExportInvite: 'dev:export-invite',
  devImportInvite: 'dev:import-invite',
  devImportReply: 'dev:import-reply',
  devLeaveGroup: 'dev:leave-group',
} as const;

export type DesktopPlatform = 'windows' | 'macos' | 'linux';

export interface AppInfo {
  readonly appVersion: string;
  readonly coreVersion: string;
  readonly protocolVersion: number;
  readonly platform: DesktopPlatform;
}

export interface HistoryItemView {
  readonly id: string;
  readonly kind: ClipKind;
  /** Short, single-line preview; full content stays in the main process. */
  readonly preview: string;
  readonly fromName: string;
  readonly fromThisDevice: boolean;
  readonly createdAt: number;
  readonly deliveredCount: number;
}

export interface SettingsView {
  readonly sendEnabled: boolean;
  readonly receiveEnabled: boolean;
  readonly notifyOnReceive: boolean;
}

export interface PairingView {
  readonly paired: boolean;
  readonly devMode: boolean;
  readonly groupId: string | null;
  readonly memberCount: number;
}

/** Everything the UI renders; pushed on every change. */
export interface AppSnapshot {
  readonly status: ConnectionStatus;
  readonly devices: readonly PeerView[];
  readonly history: readonly HistoryItemView[];
  readonly settings: SettingsView;
  readonly pairing: PairingView;
  readonly lastSendError: ConnectionStatus['issue'];
}

export interface DiagnosticsView {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly platform: DevicePlatform;
  readonly appVersion: string;
  readonly coreVersion: string;
  readonly protocolVersion: number;
  readonly network: NetworkSnapshot | null;
  readonly listenPort: number | null;
  readonly logFile: string;
  readonly devices: readonly PeerView[];
}

export type IpcResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export interface SettingsPatch {
  readonly sendEnabled?: boolean;
  readonly receiveEnabled?: boolean;
  readonly notifyOnReceive?: boolean;
}

export interface DevPairingApi {
  createGroup(): Promise<IpcResult<void>>;
  exportInvite(): Promise<IpcResult<string>>;
  /** Returns the reply text to send back to the inviting device. */
  importInvite(invite: string): Promise<IpcResult<string>>;
  importReply(reply: string): Promise<IpcResult<void>>;
  leaveGroup(): Promise<IpcResult<void>>;
}

export interface ClipBridgeApi {
  getAppInfo(): Promise<AppInfo>;
  getState(): Promise<AppSnapshot>;
  /** Subscribes to state pushes; returns an unsubscribe function. */
  onStateChanged(listener: (snapshot: AppSnapshot) => void): () => void;
  updateSettings(patch: SettingsPatch): Promise<void>;
  copyHistoryItem(id: string): Promise<IpcResult<void>>;
  clearHistory(): Promise<void>;
  getDiagnostics(): Promise<DiagnosticsView>;
  readonly dev: DevPairingApi;
}
