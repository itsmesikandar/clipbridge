import {
  bytesToBase64,
  deviceIdFromSignPublicKey,
  type DevicePlatform,
  type DeviceRecord,
  type EpochKey,
  type GroupCredentials,
  identityFromSeeds,
  type LocalDevice,
  MAX_PREVIOUS_KEYS,
  parseMembership,
  type RandomPort,
  type SecureStoragePort,
  type StoragePort,
} from '@clipbridge/core';
import { z } from 'zod';

const KEYS = {
  identity: 'identity',
  groupKey: 'group-key',
  previousKeys: 'previous-keys',
  device: 'device',
  group: 'group',
} as const;

const SECRET_KEY_BYTES = 32;
/** One stored previous key: 4-byte big-endian epoch + 32-byte key. */
const EPOCH_KEY_BYTES = 4 + SECRET_KEY_BYTES;

const storedDeviceSchema = z.object({ name: z.string().min(1).max(64), addedAt: z.number().int() });
const storedGroupSchema = z.object({ epoch: z.number().int().min(1), membership: z.unknown() });

/**
 * Persists this device's identity and group credentials.
 * Secrets (identity keys, group keys) go to OS-encrypted storage; the rest is plain JSON.
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

  /** Remembers this device's own name (shown to other devices when it pairs). */
  async saveDeviceName(name: string, addedAt: number): Promise<void> {
    await this.storage.set(KEYS.device, { name, addedAt });
  }

  /** Returns the saved group, or null if this device is not paired (or the data is damaged). */
  async loadGroup(): Promise<GroupCredentials | null> {
    const stored = storedGroupSchema.safeParse(await this.storage.get(KEYS.group));
    const groupKey = await this.secure.get(KEYS.groupKey);
    if (!stored.success || groupKey?.length !== SECRET_KEY_BYTES) return null;
    const membership = parseMembership(stored.data.membership);
    if (!membership.ok) return null;
    const previousKeys = decodeEpochKeys(
      (await this.secure.get(KEYS.previousKeys)) ?? new Uint8Array(0),
    );
    return { epoch: stored.data.epoch, groupKey, membership: membership.value, previousKeys };
  }

  async saveGroup(group: GroupCredentials): Promise<void> {
    await this.secure.set(KEYS.groupKey, group.groupKey);
    await this.secure.set(KEYS.previousKeys, encodeEpochKeys(group.previousKeys ?? []));
    await this.storage.set(KEYS.group, { epoch: group.epoch, membership: group.membership });
  }

  async clearGroup(): Promise<void> {
    await this.storage.delete(KEYS.group);
    await this.secure.delete(KEYS.groupKey);
    await this.secure.delete(KEYS.previousKeys);
  }
}

export function encodeEpochKeys(keys: readonly EpochKey[]): Uint8Array {
  const kept = keys.slice(0, MAX_PREVIOUS_KEYS);
  const out = new Uint8Array(kept.length * EPOCH_KEY_BYTES);
  const view = new DataView(out.buffer);
  kept.forEach((entry, index) => {
    const offset = index * EPOCH_KEY_BYTES;
    view.setUint32(offset, entry.epoch);
    out.set(entry.key, offset + 4);
  });
  return out;
}

export function decodeEpochKeys(bytes: Uint8Array): EpochKey[] {
  if (bytes.length % EPOCH_KEY_BYTES !== 0) return [];
  const keys: EpochKey[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.length; offset += EPOCH_KEY_BYTES) {
    keys.push({
      epoch: view.getUint32(offset),
      key: bytes.slice(offset + 4, offset + EPOCH_KEY_BYTES),
    });
  }
  return keys;
}
