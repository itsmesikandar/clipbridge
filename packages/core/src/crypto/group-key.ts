import { bytesToHex } from '../lib/bytes';
import { utf8Encode } from '../lib/utf8';
import type { RandomPort } from '../ports/random';
import { hmacSha256, KEY_LENGTH } from './primitives';

export function generateGroupKey(random: RandomPort): Uint8Array {
  return random.randomBytes(KEY_LENGTH);
}

/** Random, unguessable group id (`grp_` + 16 hex chars). Known only to members. */
export function generateGroupId(random: RandomPort): string {
  return `grp_${bytesToHex(random.randomBytes(8))}`;
}

/**
 * Public tag advertised over mDNS so devices can skip other groups
 * (docs/PLAN.md §6.1). Derived from the group id rather than the key, so it
 * stays the same when the key rotates and devices that missed a rotation can
 * still find the group to catch up.
 */
export function groupTag(groupId: string): string {
  return bytesToHex(
    hmacSha256(utf8Encode(groupId), utf8Encode('clipbridge/group-tag/v1')).subarray(0, 8),
  );
}
