import type { DevicePlatform, PeerView } from '@clipbridge/core';

import { formatRelativeTime } from './format-time';
import { describeIssue } from './issue-text';
import type { Tone } from './status-model';

export interface DeviceRowModel {
  readonly id: string;
  readonly name: string;
  readonly platformLabel: string;
  readonly stateLabel: string;
  readonly tone: Tone;
  /** Why it is not connected, if known. */
  readonly detail: string | null;
}

const PLATFORM_LABELS: Record<DevicePlatform, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iPhone',
};

export function toDeviceRow(peer: PeerView, now: number): DeviceRowModel {
  const base = { id: peer.id, name: peer.name, platformLabel: PLATFORM_LABELS[peer.platform] };
  switch (peer.state) {
    case 'connected':
      return { ...base, stateLabel: 'Connected', tone: 'ok', detail: null };
    case 'connecting':
    case 'handshaking':
      return { ...base, stateLabel: 'Connecting…', tone: 'info', detail: null };
    case 'offline': {
      const seen =
        peer.lastSeenAt === null
          ? 'never seen'
          : `last seen ${formatRelativeTime(peer.lastSeenAt, now)}`;
      const reason =
        peer.lastError && peer.lastError.code !== 'CONNECTION_LOST'
          ? describeIssue(peer.lastError).title
          : null;
      return {
        ...base,
        stateLabel: `Offline · ${seen}`,
        tone: reason ? 'error' : 'warn',
        detail: reason,
      };
    }
  }
}

/** Connected devices first, then connecting, then offline; alphabetical within each group. */
export function sortDevices(peers: readonly PeerView[]): PeerView[] {
  const rank = (peer: PeerView): number =>
    peer.state === 'connected' ? 0 : peer.state === 'offline' ? 2 : 1;
  return [...peers].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
