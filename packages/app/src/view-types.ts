/**
 * View state shared by the desktop and mobile apps: what the UI renders and the
 * results of user actions. Plain data, safe to send over Electron IPC.
 */

import type {
  AppError,
  ClipKind,
  ConnectionStatus,
  DevicePlatform,
  NetworkSnapshot,
  PeerView,
} from '@clipbridge/core';

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

/** Outcome of a user action; `message` is shown when there is no typed `issue`. */
export type ActionResult<T> =
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
