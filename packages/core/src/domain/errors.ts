/**
 * Every expected failure in ClipBridge, with typed details.
 *
 * Apps map each `code` to a user-facing title, message and fix steps
 * (docs/PLAN.md §9). `message` here is developer-facing and goes to logs only.
 */

import type { ClipKind } from './clip';
import type { NetworkKind } from './network';

type NoDetails = Readonly<Record<string, never>>;

export type PeerUnreachableCause = 'refused' | 'timeout' | 'unreachable' | 'unknown';

export type AuthFailureReason =
  | 'bad-mac'
  | 'bad-signature'
  | 'not-a-member'
  | 'key-mismatch'
  | 'epoch-mismatch'
  | 'rejected-by-peer';

export type ConnectionLostReason =
  | 'heartbeat-timeout'
  | 'closed'
  | 'replaced'
  | 'handshake-timeout'
  /** Reconnecting with a new group key after a device was removed. */
  | 'rekey'
  /** Reconnecting after the app came back from the background or the computer woke up. */
  | 'resumed';

export interface AppErrorDetailsMap {
  /** No Wi-Fi/LAN connection (e.g. phone on mobile data only). */
  NO_NETWORK: { readonly networkKind: NetworkKind };
  /** iOS Local Network permission denied. */
  LOCAL_NETWORK_PERMISSION: NoDetails;
  /** Paired devices were last seen on another subnet and none is reachable. */
  DIFFERENT_NETWORK: {
    readonly localSubnet: string;
    readonly peerName: string;
    readonly peerSubnet: string;
  };
  /** Same network, but no paired device found. */
  NO_PEERS: { readonly localSubnet: string | null };
  /** A phone has no computer (hub) online to sync through. */
  NO_DESKTOP_ONLINE: NoDetails;
  /** A device was found but a connection could not be made (firewall, VPN, isolation). */
  PEER_UNREACHABLE: {
    readonly peerId: string | null;
    readonly peerName: string | null;
    readonly address: string | null;
    readonly cause: PeerUnreachableCause;
  };
  /** Wi-Fi blocks device-to-device traffic (client/AP isolation). */
  NETWORK_ISOLATION: NoDetails;
  /** Handshake rejected: not in the group, wrong key, or forged identity. */
  AUTH_FAILED: { readonly peerId: string | null; readonly reason: AuthFailureReason };
  /** This device is no longer in the group's member list. */
  REMOVED_FROM_GROUP: NoDetails;
  /** Peer speaks a different protocol major version. */
  VERSION_MISMATCH: {
    readonly peerId: string | null;
    readonly localVersion: number;
    readonly remoteVersion: number | null;
  };
  /** Malformed or unexpected data on the wire. */
  PROTOCOL_ERROR: { readonly reason: string };
  /** An established connection ended. */
  CONNECTION_LOST: { readonly peerId: string | null; readonly reason: ConnectionLostReason };
  /** Clip exceeds the size limit for its kind. */
  PAYLOAD_TOO_LARGE: {
    readonly kind: ClipKind;
    readonly sizeBytes: number;
    readonly limitBytes: number;
  };
  /** The desktop could not open its network port. */
  PORT_IN_USE: { readonly port: number };
  /** Reading or writing the system clipboard failed. */
  CLIPBOARD_ACCESS_FAILED: { readonly operation: 'read' | 'write' };
  PAIRING_EXPIRED: NoDetails;
  PAIRING_REJECTED: NoDetails;
  PAIRING_CODE_INVALID: { readonly attemptsLeft: number };
}

export type AppErrorCode = keyof AppErrorDetailsMap;

export type AppError<C extends AppErrorCode = AppErrorCode> = {
  [K in C]: {
    readonly code: K;
    readonly message: string;
    readonly details: AppErrorDetailsMap[K];
  };
}[C];

export function appError<C extends AppErrorCode>(
  code: C,
  message: string,
  details: AppErrorDetailsMap[C],
): AppError<C> {
  return { code, message, details };
}

export function isAppError<C extends AppErrorCode>(
  error: AppError,
  code: C,
): error is Extract<AppError, { readonly code: C }> {
  return error.code === code;
}
