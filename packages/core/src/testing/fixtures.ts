import { signMembership } from '../application/membership-service';
import { generateGroupId, generateGroupKey } from '../crypto/group-key';
import {
  deviceIdFromSignPublicKey,
  generateIdentity,
  type IdentityKeyPair,
} from '../crypto/identity';
import type { DevicePlatform, DeviceRecord } from '../domain/device';
import type { Membership } from '../domain/membership';
import { bytesToBase64 } from '../lib/base64';
import type { RandomPort } from '../ports/random';
import { SeededRandom } from './seeded-random';

export interface TestDeviceSpec {
  readonly name: string;
  readonly platform: DevicePlatform;
}

export interface TestMember {
  readonly device: DeviceRecord;
  readonly identity: IdentityKeyPair;
}

export interface TestGroup {
  readonly groupId: string;
  readonly groupKey: Uint8Array;
  readonly epoch: number;
  readonly membership: Membership;
  readonly members: readonly TestMember[];
}

export function createTestMember(
  spec: TestDeviceSpec,
  random: RandomPort,
  addedAt = 0,
): TestMember {
  const identity = generateIdentity(random);
  return {
    identity,
    device: {
      id: deviceIdFromSignPublicKey(identity.signPublicKey),
      name: spec.name,
      platform: spec.platform,
      signPublicKey: bytesToBase64(identity.signPublicKey),
      boxPublicKey: bytesToBase64(identity.boxPublicKey),
      addedAt,
    },
  };
}

/** A paired group whose member list is signed by the first member. */
export function createTestGroup(
  specs: readonly TestDeviceSpec[],
  random: RandomPort = new SeededRandom(42),
): TestGroup {
  const members = specs.map((spec) => createTestMember(spec, random));
  const first = members[0];
  if (!first) throw new Error('createTestGroup needs at least one device');
  const groupId = generateGroupId(random);
  const membership = signMembership(
    {
      groupId,
      version: 1,
      members: members.map((member) => member.device),
      updatedBy: first.device.id,
      updatedAt: 0,
    },
    first.identity,
  );
  return { groupId, groupKey: generateGroupKey(random), epoch: 1, membership, members };
}
