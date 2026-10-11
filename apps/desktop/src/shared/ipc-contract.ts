/**
 * Contract between the Electron main process and the renderer.
 *
 * Single source of truth for IPC channel names and payload types. Input
 * validation lives in `ipc-schemas.ts` (main process only). The preload
 * script implements `ClipBridgeApi`; the renderer uses it as `window.clipbridge`.
 */

import type {
  AppError,
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

/** This computer showing a code / QR so another device can join. */
export interface HostingView {
  readonly code: string;
  /** QR code as an SVG document. */
  readonly qrSvg: string;
  readonly expiresAt: number;
  /** Where joiners connect, e.g. `192.168.1.7:47821` (for manual entry). */
  readonly address: string;
  readonly state: 'waiting' | 'awaiting-approval' | 'completed' | 'failed' | 'cancelled';
  readonly attemptsLeft: number;
  readonly request: { readonly name: string; readonly platform: DevicePlatform } | null;
  readonly addedDeviceName: string | null;
  readonly error: AppError | null;
}

export interface JoinHostView {
  readonly id: string;
  /** What the user sees, e.g. `192.168.1.7`. */
  readonly label: string;
}

/** This computer joining an existing group. */
export interface JoiningView {
  readonly searching: boolean;
  readonly hosts: readonly JoinHostView[];
  readonly state: 'idle' | 'connecting' | 'verifying' | 'awaiting-approval' | 'joined' | 'failed';
  readonly error: AppError | null;
}

export interface PairingView {
  readonly paired: boolean;
  readonly selfId: string | null;
  readonly selfName: string | null;
  readonly memberCount: number;
  readonly hosting: HostingView | null;
  readonly joining: JoiningView;
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
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly message: string;
      /** Typed error when there is one, so the UI can show its title and fix steps. */
      readonly issue?: AppError;
    };

export interface SettingsPatch {
  readonly sendEnabled?: boolean;
  readonly receiveEnabled?: boolean;
  readonly notifyOnReceive?: boolean;
}

export interface JoinRequestInput {
  readonly code: string;
  /** A host from the search list, or null to use `address` / the only host found. */
  readonly hostId: string | null;
  /** Manual `ip` or `ip:port` when discovery does not work on this network. */
  readonly address: string | null;
}

export interface PairingApi {
  createGroup(): Promise<IpcResult<void>>;
  startHosting(): Promise<IpcResult<void>>;
  stopHosting(): Promise<void>;
  approveJoin(): Promise<void>;
  denyJoin(): Promise<void>;
  startJoinSearch(): Promise<void>;
  stopJoinSearch(): Promise<void>;
  join(input: JoinRequestInput): Promise<IpcResult<void>>;
  cancelJoin(): Promise<void>;
}

export interface DevicesApi {
  rename(id: string, name: string): Promise<IpcResult<void>>;
  remove(id: string): Promise<IpcResult<void>>;
  /** Forgets the group on this computer only. */
  resetThisDevice(): Promise<IpcResult<void>>;
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
  readonly pairing: PairingApi;
  readonly devices: DevicesApi;
}
