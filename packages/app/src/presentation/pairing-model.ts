import type { AppError, DevicePlatform } from '@clipbridge/core';

import type { HostingView, JoiningView } from '../view-types';
import { describeIssue } from './issue-text';

export const PLATFORM_NAMES: Record<DevicePlatform, string> = {
  windows: 'Windows computer',
  macos: 'Mac',
  linux: 'Linux computer',
  android: 'Android phone',
  ios: 'iPhone',
};

/** `95_000` → `1:35`. */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export interface HostingModel {
  readonly phase: 'show-code' | 'approve' | 'done' | 'ended';
  readonly title: string;
  readonly message: string | null;
}

export function toHostingModel(hosting: HostingView, now: number): HostingModel {
  switch (hosting.state) {
    case 'waiting':
      return {
        phase: 'show-code',
        title: 'Add a device',
        message:
          hosting.attemptsLeft < 3
            ? `Wrong code entered. ${hosting.attemptsLeft} attempt(s) left. Expires in ${formatCountdown(hosting.expiresAt - now)}.`
            : `Expires in ${formatCountdown(hosting.expiresAt - now)}.`,
      };
    case 'awaiting-approval': {
      const request = hosting.request;
      return {
        phase: 'approve',
        title: request ? `Allow "${request.name}" to join?` : 'Allow this device to join?',
        message: `${request ? PLATFORM_NAMES[request.platform] : 'Device'} · Only allow devices you own. It will see everything you copy.`,
      };
    }
    case 'completed':
      return {
        phase: 'done',
        title: `"${hosting.addedDeviceName ?? 'The device'}" was added`,
        message: 'It is now syncing with your other devices.',
      };
    case 'failed':
      return {
        phase: 'ended',
        title: hosting.error ? describeIssue(hosting.error).title : 'Pairing stopped',
        message: hosting.error ? describeIssue(hosting.error).message : null,
      };
    case 'cancelled':
      return { phase: 'ended', title: 'Pairing stopped', message: null };
  }
}

/** Short text for the joining state on the onboarding screen. */
export function describeJoinState(
  state: JoiningView['state'],
  error: AppError | null,
): string | null {
  switch (state) {
    case 'idle':
    case 'joined':
      return null;
    case 'connecting':
      return 'Connecting…';
    case 'verifying':
      return 'Checking the code…';
    case 'awaiting-approval':
      return 'Waiting — click "Allow" on the other computer.';
    case 'failed':
      return error
        ? `${describeIssue(error).title}. ${describeIssue(error).message}`
        : 'Could not join.';
  }
}

/** Inline SVG as an image source (CSP allows `data:` images). */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
