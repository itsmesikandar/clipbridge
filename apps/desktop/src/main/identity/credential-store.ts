import {
  bytesToBase64,
  deviceIdFromSignPublicKey,
  type DevicePlatform,
  type DeviceRecord,
  type GroupCredentials,
  identityFromSeeds,
  type LocalDevice,
  type Membership,
  parseMembership,
  type RandomPort,
  type SecureStoragePort,
  type StoragePort,
} from '@clipbridge/core';
import { z } from 'zod';

const KEYS = {
  identity: 'identity',
  groupKey: 'group-key',
  device: 'device',
  group: 'group',
} as const;

const SECRET_KEY_BYTES = 32;

const storedDeviceSchema = z.object({ name: z.string().min(1).max(64), addedAt: z.number().int() });
const storedGroupSchema = z.object({
  groupId: z.string().min(1),
  epoch: z.number().int().min(1),
  membership: z.unknown(),
});

export interface StoredGroup extends GroupCredentials {
  readonly groupId: string;
}

/**
 * Persists this device's identity and group membership.
 * Secrets (identity keys, group key) go to OS-encrypted storage; the rest is plain JSON.
 */
export class CredentialStore {
  constructor(
    private readonly storage: StoragePort,
    private readonly secure: SecureStoragePort,
    private readonly random: RandomPort,
  ) {}

  /** Loads the identity, creating and saving one on first launch. */
  async loadOrCreateDevice(
    defaultName: string,
    platform: DevicePlatform,
    now: number,
  ): Promise<LocalDevice> {
    let seeds = await this.secure.get(KEYS.identity);
    if (seeds?.length !== SECRET_KEY_BYTES * 2) {
      seeds = this.random.randomBytes(SECRET_KEY_BYTES * 2);
      await this.secure.set(KEYS.identity, seeds);
    }
    const identity = identityFromSeeds(
      seeds.slice(0, SECRET_KEY_BYTES),
      seeds.slice(SECRET_KEY_BYTES),
    );

    const storedDevice = storedDeviceSchema.safeParse(await this.storage.get(KEYS.device));
    const meta = storedDevice.success ? storedDevice.data : { name: defaultName, addedAt: now };
    if (!storedDevice.success) await this.storage.set(KEYS.device, meta);

    const device: DeviceRecord = {
      id: deviceIdFromSignPublicKey(identity.signPublicKey),
      name: meta.name,
      platform,
      signPublicKey: bytesToBase64(identity.signPublicKey),
      boxPublicKey: bytesToBase64(identity.boxPublicKey),
      addedAt: meta.addedAt,
    };
    return { device, identity };
  }

  /** Returns the saved group, or null if this device is not paired (or the data is damaged). */
  async loadGroup(): Promise<StoredGroup | null> {
    const stored = storedGroupSchema.safeParse(await this.storage.get(KEYS.group));
    const groupKey = await this.secure.get(KEYS.groupKey);
    if (!stored.success || groupKey?.length !== SECRET_KEY_BYTES) return null;
    const membership = parseMembership(stored.data.membership);
    if (!membership.ok) return null;
    return {
      groupId: stored.data.groupId,
      epoch: stored.data.epoch,
      groupKey,
      membership: membership.value,
    };
  }

  async saveGroup(group: StoredGroup): Promise<void> {
    await this.secure.set(KEYS.groupKey, group.groupKey);
    await this.storage.set(KEYS.group, {
      groupId: group.groupId,
      epoch: group.epoch,
      membership: group.membership,
    });
  }

  async saveMembership(groupId: string, epoch: number, membership: Membership): Promise<void> {
    await this.storage.set(KEYS.group, { groupId, epoch, membership });
  }

  async clearGroup(): Promise<void> {
    await this.storage.delete(KEYS.group);
    await this.secure.delete(KEYS.groupKey);
  }
}
