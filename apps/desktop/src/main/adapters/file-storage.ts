import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SecureStoragePort, StoragePort } from '@clipbridge/core';

const KEY_PATTERN = /^[a-z0-9-]+$/;

function fileFor(directory: string, key: string, extension: string): string {
  if (!KEY_PATTERN.test(key)) throw new Error(`Invalid storage key: ${key}`);
  return join(directory, `${key}.${extension}`);
}

/** Writes via a temp file + rename, so a crash never leaves a half-written file. */
async function writeAtomically(path: string, data: string | Uint8Array): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** One JSON file per key. For non-secret data (member list, settings). */
export class JsonFileStorage implements StoragePort {
  constructor(private readonly directory: string) {}

  async get(key: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(fileFor(this.directory, key, 'json'), 'utf8')) as unknown;
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeAtomically(fileFor(this.directory, key, 'json'), JSON.stringify(value, null, 2));
  }

  async delete(key: string): Promise<void> {
    await rm(fileFor(this.directory, key, 'json'), { force: true });
  }
}

/** Encrypts and decrypts with the OS keychain (Electron `safeStorage`). */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/**
 * Secrets encrypted by the OS (DPAPI on Windows, Keychain on macOS) before they
 * touch the disk. Refuses to store anything if OS encryption is unavailable.
 */
export class EncryptedFileStorage implements SecureStoragePort {
  constructor(
    private readonly directory: string,
    private readonly cipher: SecretCipher,
  ) {}

  async get(key: string): Promise<Uint8Array | null> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(fileFor(this.directory, key, 'bin'));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    this.assertAvailable();
    return new Uint8Array(Buffer.from(this.cipher.decryptString(encrypted), 'base64'));
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    this.assertAvailable();
    await mkdir(this.directory, { recursive: true });
    const encrypted = this.cipher.encryptString(Buffer.from(value).toString('base64'));
    await writeAtomically(fileFor(this.directory, key, 'bin'), encrypted);
  }

  async delete(key: string): Promise<void> {
    await rm(fileFor(this.directory, key, 'bin'), { force: true });
  }

  private assertAvailable(): void {
    if (!this.cipher.isEncryptionAvailable()) {
      throw new Error('OS secret storage is not available');
    }
  }
}
