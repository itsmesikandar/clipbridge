/** Plain key-value storage for non-secret data (members, settings, history). */
export interface StoragePort {
  /** Returns the stored JSON value, or undefined. Callers validate the shape. */
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** OS-protected storage for secrets (identity keys, group key). */
export interface SecureStoragePort {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}
