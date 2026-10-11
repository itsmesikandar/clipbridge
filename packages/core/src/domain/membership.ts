import type { DeviceRecord } from './device';
import type { DeviceId } from './ids';

/**
 * Signed list of the devices in a group. The highest valid `version` wins;
 * ties are broken by the lower `updatedBy` id (docs/PLAN.md §8.2).
 */
export interface Membership {
  readonly groupId: string;
  readonly version: number;
  readonly members: readonly DeviceRecord[];
  readonly updatedBy: DeviceId;
  readonly updatedAt: number;
  /** Ed25519 signature (base64) by `updatedBy` over the canonical unsigned fields. */
  readonly signature: string;
}

export type UnsignedMembership = Omit<Membership, 'signature'>;

export function findMember(membership: Membership, id: DeviceId): DeviceRecord | undefined {
  return membership.members.find((member) => member.id === id);
}

/** Returns a positive number when `a` should replace `b`. Signatures are not checked here. */
export function compareMembershipPrecedence(a: UnsignedMembership, b: UnsignedMembership): number {
  if (a.version !== b.version) return a.version - b.version;
  if (a.updatedBy === b.updatedBy) return 0;
  return a.updatedBy < b.updatedBy ? 1 : -1;
}
