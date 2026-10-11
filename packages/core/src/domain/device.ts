import type { DeviceId } from './ids';

export type DevicePlatform = 'windows' | 'macos' | 'linux' | 'android' | 'ios';

/**
 * Hubs (desktops) accept connections and forward clips.
 * Clients (phones) only dial hubs (docs/PLAN.md §6.2).
 */
export type DeviceRole = 'hub' | 'client';

export function roleOf(platform: DevicePlatform): DeviceRole {
  return platform === 'android' || platform === 'ios' ? 'client' : 'hub';
}

/** Public, shareable description of a group member. */
export interface DeviceRecord {
  readonly id: DeviceId;
  readonly name: string;
  readonly platform: DevicePlatform;
  /** Ed25519 public key, base64. Proves identity during handshake. */
  readonly signPublicKey: string;
  /** X25519 public key, base64. Receives sealed secrets (key rotation). */
  readonly boxPublicKey: string;
  readonly addedAt: number;
}

export const DEVICE_NAME_MAX_LENGTH = 64;
