import type { DevicePlatform, DeviceRole } from './device';
import type { AppError } from './errors';
import type { DeviceId } from './ids';

/** Lifecycle of the connection to one peer (docs/PLAN.md §6.3). */
export type PeerConnectionState = 'offline' | 'connecting' | 'handshaking' | 'connected';

/** What the UI shows per paired device. */
export interface PeerView {
  readonly id: DeviceId;
  readonly name: string;
  readonly platform: DevicePlatform;
  readonly role: DeviceRole;
  readonly state: PeerConnectionState;
  /** Seen in discovery right now. */
  readonly discovered: boolean;
  readonly lastSeenAt: number | null;
  readonly lastSeenSubnet: string | null;
  readonly lastError: AppError | null;
}

export type OverallStatusKind = 'CONNECTED' | 'PARTIAL' | 'SEARCHING' | 'NOT_PAIRED' | 'ERROR';

/** Single status shown in the app banner (docs/PLAN.md §9.2). */
export interface ConnectionStatus {
  readonly kind: OverallStatusKind;
  readonly connectedCount: number;
  readonly peerCount: number;
  /** Primary problem to explain to the user; null when nothing is wrong. */
  readonly issue: AppError | null;
}
