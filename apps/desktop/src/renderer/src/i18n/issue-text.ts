/**
 * User-facing text for every error code (docs/PLAN.md §9.3).
 * One place for wording, so it can be changed or translated without touching logic.
 */

import { type AppError, subnetLabel } from '@clipbridge/core';

export interface IssueText {
  readonly title: string;
  readonly message: string;
  /** What the user can do, in order. */
  readonly steps: readonly string[];
}

const FIREWALL_STEPS = [
  'Allow ClipBridge in the firewall on both computers.',
  'Windows: set this Wi-Fi to "Private network" (Settings → Network & internet → Wi-Fi → your network).',
  'Turn off any VPN while syncing.',
] as const;

const SAME_WIFI_STEPS = [
  'Open ClipBridge on your other devices.',
  'Make sure all devices use the same Wi-Fi network.',
  'Guest or office Wi-Fi often blocks devices from seeing each other — try a home network or a phone hotspot.',
] as const;

export function describeIssue(issue: AppError): IssueText {
  switch (issue.code) {
    case 'NO_NETWORK':
      return {
        title: 'Not connected to Wi-Fi',
        message:
          issue.details.networkKind === 'cellular'
            ? 'This device is using mobile data. ClipBridge works only on Wi-Fi or a local network.'
            : 'This device is not connected to Wi-Fi or a local network.',
        steps: ['Turn on Wi-Fi.', 'Connect to the same network as your other devices.'],
      };
    case 'DIFFERENT_NETWORK':
      return {
        title: 'Your devices are on different networks',
        message: `This device is on ${subnetLabel(issue.details.localSubnet)}, but "${issue.details.peerName}" was last seen on ${subnetLabel(issue.details.peerSubnet)}.`,
        steps: ['Connect both devices to the same Wi-Fi.', 'Avoid guest networks.'],
      };
    case 'NO_PEERS':
      return {
        title: 'Can’t find your other devices',
        message: issue.details.localSubnet
          ? `No paired device answered on this network (${subnetLabel(issue.details.localSubnet)}).`
          : 'No paired device answered on this network.',
        steps: SAME_WIFI_STEPS,
      };
    case 'NO_DESKTOP_ONLINE':
      return {
        title: 'No computer is online',
        message: 'Phones sync through a computer in this version.',
        steps: ['Open ClipBridge on a computer connected to this Wi-Fi.'],
      };
    case 'PEER_UNREACHABLE': {
      const name = issue.details.peerName ?? 'Another device';
      return {
        title: `"${name}" can’t be reached`,
        message:
          issue.details.cause === 'refused'
            ? `"${name}" was found, but refused the connection. ClipBridge may have just restarted there.`
            : `"${name}" was found on the network, but the connection is blocked.`,
        steps: FIREWALL_STEPS,
      };
    }
    case 'NETWORK_ISOLATION':
      return {
        title: 'This Wi-Fi blocks your devices',
        message: 'The network does not let devices talk to each other (client isolation).',
        steps: [
          'Use a home network or a phone hotspot.',
          'Or ask the network admin to turn off client isolation.',
        ],
      };
    case 'LOCAL_NETWORK_PERMISSION':
      return {
        title: 'Local network access is off',
        message: 'ClipBridge needs Local Network access to find your devices.',
        steps: ['Open Settings → Privacy & Security → Local Network and turn on ClipBridge.'],
      };
    case 'AUTH_FAILED':
      return {
        title: 'A device did not accept this one',
        message:
          issue.details.reason === 'not-a-member' || issue.details.reason === 'rejected-by-peer'
            ? 'This device may have been removed from your group.'
            : 'The devices could not verify each other.',
        steps: ['Remove this device from the group and pair it again.'],
      };
    case 'REMOVED_FROM_GROUP':
      return {
        title: 'This device was removed',
        message: 'It no longer receives or sends clips.',
        steps: ['Pair this device again to rejoin your group.'],
      };
    case 'VERSION_MISMATCH':
      return {
        title: 'Different ClipBridge versions',
        message: 'One of your devices runs a version that cannot talk to this one.',
        steps: ['Update ClipBridge on all devices to the latest version.'],
      };
    case 'PROTOCOL_ERROR':
      return {
        title: 'Unexpected data from a device',
        message:
          'A device sent something ClipBridge did not understand. It will retry automatically.',
        steps: ['If this keeps happening, update ClipBridge on all devices.'],
      };
    case 'CONNECTION_LOST':
      return {
        title: 'Connection lost',
        message: 'The connection to a device dropped. ClipBridge reconnects automatically.',
        steps: SAME_WIFI_STEPS,
      };
    case 'PAYLOAD_TOO_LARGE':
      return {
        title: 'Too large to send',
        message: `This ${issue.details.kind} is ${formatBytes(issue.details.sizeBytes)}; the limit is ${formatBytes(issue.details.limitBytes)}.`,
        steps: ['Copy a smaller part.'],
      };
    case 'PORT_IN_USE':
      return {
        title: 'ClipBridge could not start its network service',
        message: `Port ${issue.details.port} and the fallback ports are unavailable.`,
        steps: ['Quit other ClipBridge windows.', 'Restart the app.'],
      };
    case 'CLIPBOARD_ACCESS_FAILED':
      return {
        title: 'Clipboard not available',
        message: `ClipBridge could not ${issue.details.operation} the clipboard.`,
        steps: ['Try again. Another app may be using the clipboard.'],
      };
    case 'PAIRING_EXPIRED':
      return {
        title: 'Pairing expired',
        message: 'The pairing code is no longer valid.',
        steps: ['Start pairing again.'],
      };
    case 'PAIRING_REJECTED':
      return {
        title: 'Pairing declined',
        message: 'The other device did not allow this one.',
        steps: ['Start pairing again.'],
      };
    case 'PAIRING_CODE_INVALID':
      return {
        title: 'Wrong code',
        message: `${issue.details.attemptsLeft} attempt(s) left.`,
        steps: ['Check the code shown on the other device.'],
      };
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
