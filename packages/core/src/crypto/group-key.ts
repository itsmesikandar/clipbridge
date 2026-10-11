import { bytesToHex } from '../lib/bytes';
import { utf8Encode } from '../lib/utf8';
import type { RandomPort } from '../ports/random';
import { hmacSha256, KEY_LENGTH } from './primitives';

export function generateGroupKey(random: RandomPort): Uint8Array {
  return random.randomBytes(KEY_LENGTH);
}

/**
 * Public tag advertised over mDNS so devices can skip other groups.
 * Derived from the key, so it reveals nothing about it (docs/PLAN.md §6.1).
 */
export function groupTag(groupKey: Uint8Array): string {
  return bytesToHex(hmacSha256(groupKey, utf8Encode('clipbridge/group-tag/v1')).subarray(0, 8));
}
