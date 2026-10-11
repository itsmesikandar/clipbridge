/**
 * Turns what the device knows about its network and peers into one status and
 * one explainable problem (docs/PLAN.md §9). Pure function: every rule is a test.
 */

import type { DeviceRole } from '../domain/device';
import { type AppError, appError } from '../domain/errors';
import { hasLanConnection, type NetworkSnapshot } from '../domain/network';
import type { ConnectionStatus, PeerView } from '../domain/status';
import type { LocalNetworkPermission } from '../ports/network-info';

export interface DiagnosisInput {
  readonly selfRole: DeviceRole;
  /** Null until the first network snapshot is known. */
  readonly network: NetworkSnapshot | null;
  readonly permission: LocalNetworkPermission;
  readonly peers: readonly PeerView[];
  /** Time since the engine started or the network last changed. */
  readonly searchingForMs: number;
  readonly removedFromGroup: boolean;
}

/** How long to show "Looking for your devices…" before reporting a problem. */
export const SEARCH_GRACE_MS = 10_000;

export function diagnose(input: DiagnosisInput): ConnectionStatus {
  const { peers } = input;
  const hubs = peers.filter((peer) => peer.role === 'hub');
  // Phones only connect to computers; other phones are reached through them.
  const reachable = input.selfRole === 'client' ? hubs : peers;
  const connectedCount = reachable.filter((peer) => peer.state === 'connected').length;
  const status = (kind: ConnectionStatus['kind'], issue: AppError | null): ConnectionStatus => ({
    kind,
    connectedCount,
    peerCount: reachable.length,
    issue,
  });

  if (input.removedFromGroup) {
    return status('ERROR', appError('REMOVED_FROM_GROUP', 'this device was removed', {}));
  }
  if (input.network && !hasLanConnection(input.network)) {
    return status(
      'ERROR',
      appError('NO_NETWORK', 'no LAN connection', { networkKind: input.network.kind }),
    );
  }
  if (input.permission === 'denied') {
    return status(
      'ERROR',
      appError('LOCAL_NETWORK_PERMISSION', 'local network permission denied', {}),
    );
  }
  if (peers.length === 0) return status('NOT_PAIRED', null);

  if (connectedCount > 0) {
    return status(connectedCount === reachable.length ? 'CONNECTED' : 'PARTIAL', null);
  }

  // Nothing connected: find the most useful explanation.
  if (input.selfRole === 'client' && hubs.length === 0) {
    return status('ERROR', appError('NO_DESKTOP_ONLINE', 'group has no computer', {}));
  }

  for (const code of ['VERSION_MISMATCH', 'AUTH_FAILED'] as const) {
    const peer = reachable.find((candidate) => candidate.lastError?.code === code);
    if (peer?.lastError) return status('ERROR', peer.lastError);
  }

  const unreachable = reachable.find(
    (peer) => peer.discovered && peer.lastError?.code === 'PEER_UNREACHABLE',
  );
  if (unreachable?.lastError) return status('ERROR', unreachable.lastError);

  if (input.searchingForMs < SEARCH_GRACE_MS) return status('SEARCHING', null);

  const localSubnet = input.network?.subnet ?? null;
  const differentNetwork = findDifferentNetwork(reachable, localSubnet);
  if (differentNetwork) return status('ERROR', differentNetwork);

  if (input.selfRole === 'client') {
    return status('ERROR', appError('NO_DESKTOP_ONLINE', 'no computer reachable', {}));
  }
  return status('ERROR', appError('NO_PEERS', 'no paired device found', { localSubnet }));
}

/**
 * All peers we have a location for were last seen on another subnet:
 * the user is most likely on a different Wi-Fi.
 */
function findDifferentNetwork(
  peers: readonly PeerView[],
  localSubnet: string | null,
): AppError<'DIFFERENT_NETWORK'> | null {
  if (!localSubnet) return null;
  const located = peers.filter((peer) => peer.lastSeenSubnet !== null);
  if (located.length === 0 || located.some((peer) => peer.lastSeenSubnet === localSubnet))
    return null;
  const mostRecent = [...located].sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))[0];
  if (!mostRecent?.lastSeenSubnet) return null;
  return appError('DIFFERENT_NETWORK', 'peers were last seen on another subnet', {
    localSubnet,
    peerName: mostRecent.name,
    peerSubnet: mostRecent.lastSeenSubnet,
  });
}
