/**
 * Public API of @clipbridge/core.
 *
 * Apps import only from this entry point (and `@clipbridge/core/testing` in tests),
 * never from deep paths.
 */

/** Version of the core library, shown in About / Diagnostics screens. */
export const CORE_VERSION = '0.1.0';

// Engine
export type { HistoryEntry } from './application/clip-history';
export { diagnose, SEARCH_GRACE_MS } from './application/diagnose';
export {
  createEngine,
  defaultSettings,
  type Engine,
  type EngineOptions,
  type EnginePorts,
  type EngineSettings,
  type GroupCredentials,
  type LocalDevice,
} from './application/engine';
export { type EpochKey, MAX_PREVIOUS_KEYS } from './application/group-keys';
export { decideMembership, isMember, signMembership } from './application/membership-service';
export {
  type GroupForJoiner,
  type JoinRequest,
  PAIRING_TIMING,
  type PairingHostSession,
  type PairingHostState,
} from './application/pairing-host';
export {
  type JoinAttempt,
  type JoinDeps,
  type JoinedGroup,
  joinGroup,
  type JoinOptions,
  type JoinState,
} from './application/pairing-joiner';
export { DEFAULT_LISTEN_PORT } from './application/peer-manager';
export type { ReadonlyStore } from './application/store';
export type { SyncSettings } from './application/sync-engine';

// Domain
export {
  classifyText,
  type Clip,
  CLIP_LIMITS,
  type ClipContent,
  type ClipKind,
  type ImageMime,
} from './domain/clip';
export {
  DEVICE_NAME_MAX_LENGTH,
  type DevicePlatform,
  type DeviceRecord,
  type DeviceRole,
  roleOf,
} from './domain/device';
export {
  type AppError,
  appError,
  type AppErrorCode,
  type AppErrorDetailsMap,
  type AuthFailureReason,
  type ConnectionLostReason,
  isAppError,
  type PeerUnreachableCause,
} from './domain/errors';
export { type ClipId, type DeviceId, isDeviceId } from './domain/ids';
export { findMember, type Membership, type UnsignedMembership } from './domain/membership';
export {
  hasLanConnection,
  type NetworkKind,
  type NetworkSnapshot,
  prefixLengthFromNetmask,
  subnetLabel,
  subnetOf,
} from './domain/network';
export { err, ok, type Result } from './domain/result';
export type {
  ConnectionStatus,
  OverallStatusKind,
  PeerConnectionState,
  PeerView,
} from './domain/status';

// Crypto needed by apps to create and restore identities and groups
export { generateGroupId, generateGroupKey, groupTag } from './crypto/group-key';
export {
  deviceIdFromSignPublicKey,
  generateIdentity,
  identityFromSeeds,
  type IdentityKeyPair,
} from './crypto/identity';
export { base64ToBytes, bytesToBase64 } from './lib/base64';

// Ports
export type * from './ports';

// Protocol
export type { PairingMethod } from './protocol/frames';
export {
  buildPairingLink,
  formatPairingCode,
  normalizePairingCode,
  PAIRING_CODE_LENGTH,
  type PairingLink,
  pairingSecret,
  parsePairingLink,
} from './protocol/pairing';
export { PROTOCOL_VERSION } from './protocol/version';
export { parseMembership } from './protocol/wire';
