/**
 * DEVELOPMENT-ONLY pairing for Milestone 2 (docs/milestones/M2-desktop-lan-sync.md).
 *
 * Two-step text exchange so two laptops trust each other before real pairing
 * (QR / code with approval) exists in Milestone 3:
 *   1. A: "Copy invite"   → B: "Join with invite"  (B learns group key + A, adds itself)
 *   2. B: "Copy reply"    → A: "Accept reply"      (A adds B to its signed member list)
 * Only exposed when the app runs unpackaged or with CLIPBRIDGE_DEV=1.
 */

import {
  base64ToBytes,
  bytesToBase64,
  type DeviceRecord,
  err,
  generateGroupKey,
  type LocalDevice,
  type Membership,
  ok,
  parseMembership,
  type RandomPort,
  type Result,
  signMembership,
} from '@clipbridge/core';
import { z } from 'zod';

import type { StoredGroup } from '../identity/credential-store';

const deviceSchema = z.object({
  id: z.string().regex(/^dev_[0-9a-f]{32}$/),
  name: z.string().min(1).max(64),
  platform: z.enum(['windows', 'macos', 'linux', 'android', 'ios']),
  signPublicKey: z.string().length(44),
  boxPublicKey: z.string().length(44),
  addedAt: z.number().int(),
});

const inviteSchema = z.object({
  kind: z.literal('clipbridge-dev-invite'),
  groupId: z.string().min(1).max(64),
  groupKey: z.string().length(44),
  epoch: z.number().int().min(1),
  membership: z.unknown(),
});

const replySchema = z.object({
  kind: z.literal('clipbridge-dev-reply'),
  groupId: z.string().min(1).max(64),
  device: deviceSchema,
});

export function createDevGroup(self: LocalDevice, random: RandomPort, now: number): StoredGroup {
  const groupId = `grp_${Buffer.from(random.randomBytes(8)).toString('hex')}`;
  const membership = signMembership(
    { groupId, version: 1, members: [self.device], updatedBy: self.device.id, updatedAt: now },
    self.identity,
  );
  return { groupId, groupKey: generateGroupKey(random), epoch: 1, membership };
}

export function encodeInvite(group: StoredGroup): string {
  return encode({
    kind: 'clipbridge-dev-invite',
    groupId: group.groupId,
    groupKey: bytesToBase64(group.groupKey),
    epoch: group.epoch,
    membership: group.membership,
  });
}

/** B joins with A's invite; returns B's group and the reply text for A. */
export function acceptInvite(
  text: string,
  self: LocalDevice,
  now: number,
): Result<{ group: StoredGroup; reply: string }, string> {
  const invite = inviteSchema.safeParse(decode(text));
  if (!invite.success) return err('This is not a valid invite.');
  const membership = parseMembership(invite.data.membership);
  const groupKey = base64ToBytes(invite.data.groupKey);
  if (!membership.ok || groupKey?.length !== 32) return err('The invite is damaged.');

  const group: StoredGroup = {
    groupId: invite.data.groupId,
    groupKey,
    epoch: invite.data.epoch,
    membership: withMember(membership.value, self, now),
  };
  const reply = encode({
    kind: 'clipbridge-dev-reply',
    groupId: group.groupId,
    device: self.device,
  });
  return ok({ group, reply });
}

/** A accepts B's reply and adds B to its member list. */
export function acceptReply(
  text: string,
  group: StoredGroup,
  self: LocalDevice,
  now: number,
): Result<StoredGroup, string> {
  const reply = replySchema.safeParse(decode(text));
  if (!reply.success) return err('This is not a valid reply.');
  if (reply.data.groupId !== group.groupId) return err('This reply belongs to another group.');
  const device = reply.data.device as DeviceRecord;
  if (device.id === self.device.id) return err('This reply came from this device.');
  return ok({ ...group, membership: withMember(group.membership, self, now, device) });
}

function withMember(
  current: Membership,
  self: LocalDevice,
  now: number,
  extra?: DeviceRecord,
): Membership {
  const members = [...current.members];
  for (const device of [self.device, extra]) {
    if (device && !members.some((member) => member.id === device.id)) members.push(device);
  }
  return signMembership(
    {
      groupId: current.groupId,
      version: current.version + 1,
      members,
      updatedBy: self.device.id,
      updatedAt: now,
    },
    self.identity,
  );
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function decode(text: string): unknown {
  try {
    return JSON.parse(Buffer.from(text.trim(), 'base64').toString('utf8')) as unknown;
  } catch {
    return null;
  }
}
