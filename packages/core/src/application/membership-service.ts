/** Signing, verification and merge rules for group member lists (docs/PLAN.md §8.2). */

import { type IdentityKeyPair, sign, verifySignature } from '../crypto/identity';
import type { DeviceRecord } from '../domain/device';
import type { DeviceId } from '../domain/ids';
import {
  compareMembershipPrecedence,
  findMember,
  type Membership,
  type UnsignedMembership,
} from '../domain/membership';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import { canonicalJson, type JsonValue } from '../lib/canonical-json';
import { utf8Encode } from '../lib/utf8';

const LABEL = 'clipbridge/membership/v1';

export function signMembership(
  unsigned: UnsignedMembership,
  identity: IdentityKeyPair,
): Membership {
  return {
    ...unsigned,
    signature: bytesToBase64(sign(signedBytes(unsigned), identity.signSecretKey)),
  };
}

/**
 * True when `membership` is signed by `updatedBy` using the key listed for it in
 * `trusted` (the member list the receiver already trusts).
 */
export function isMembershipSignedByTrustedMember(
  membership: Membership,
  trusted: Membership,
): boolean {
  if (membership.groupId !== trusted.groupId) return false;
  const signer = findMember(trusted, membership.updatedBy);
  if (!signer) return false;
  const publicKey = base64ToBytes(signer.signPublicKey);
  const signature = base64ToBytes(membership.signature);
  if (!publicKey || !signature) return false;
  return verifySignature(signature, signedBytes(membership), publicKey);
}

export type MembershipDecision = 'adopt' | 'keep' | 'reject';

/** Decides whether an incoming member list replaces the current one. */
export function decideMembership(current: Membership, incoming: Membership): MembershipDecision {
  if (!isMembershipSignedByTrustedMember(incoming, current)) return 'reject';
  if (hasDuplicateMembers(incoming.members)) return 'reject';
  return compareMembershipPrecedence(incoming, current) > 0 ? 'adopt' : 'keep';
}

export function isMember(membership: Membership, id: DeviceId): boolean {
  return findMember(membership, id) !== undefined;
}

function hasDuplicateMembers(members: readonly DeviceRecord[]): boolean {
  return new Set(members.map((member) => member.id)).size !== members.length;
}

function signedBytes(membership: UnsignedMembership): Uint8Array {
  const payload: JsonValue = {
    label: LABEL,
    groupId: membership.groupId,
    version: membership.version,
    updatedBy: membership.updatedBy,
    updatedAt: membership.updatedAt,
    members: [...membership.members]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((member) => ({
        id: member.id,
        name: member.name,
        platform: member.platform,
        signPublicKey: member.signPublicKey,
        boxPublicKey: member.boxPublicKey,
        addedAt: member.addedAt,
      })),
  };
  return utf8Encode(canonicalJson(payload));
}
