import type { ConnectionStatus } from '@clipbridge/core';

import { describeIssue } from './issue-text';

export type Tone = 'ok' | 'info' | 'warn' | 'error';

export interface BannerModel {
  readonly tone: Tone;
  readonly title: string;
  readonly message: string | null;
  readonly steps: readonly string[];
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Maps the engine status to the top banner (docs/PLAN.md §9.2). */
export function toBannerModel(status: ConnectionStatus): BannerModel {
  if (status.issue) {
    const text = describeIssue(status.issue);
    return { tone: 'error', title: text.title, message: text.message, steps: text.steps };
  }
  switch (status.kind) {
    case 'CONNECTED':
      return {
        tone: 'ok',
        title: `Connected to ${plural(status.connectedCount, 'device')}`,
        message: null,
        steps: [],
      };
    case 'PARTIAL':
      return {
        tone: 'warn',
        title: `Connected to ${status.connectedCount} of ${plural(status.peerCount, 'device')}`,
        message: 'Some devices are offline. They will get new clips when they come back.',
        steps: [],
      };
    case 'SEARCHING':
      return {
        tone: 'info',
        title: 'Looking for your devices on this network…',
        message: null,
        steps: [],
      };
    case 'NOT_PAIRED':
      return {
        tone: 'info',
        title: 'No devices paired yet',
        message: 'Pair another device to start syncing.',
        steps: [],
      };
    case 'ERROR':
      return { tone: 'error', title: 'Something went wrong', message: null, steps: [] };
  }
}
