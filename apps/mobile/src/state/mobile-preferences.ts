import { createSimpleStore, type SimpleStore } from '@clipbridge/app';
import type { ReadonlyStore, StoragePort } from '@clipbridge/core';

export interface MobilePrefs {
  /** Keep a foreground service running so clips arrive while the app is closed. */
  readonly backgroundSync: boolean;
}

const KEY = 'mobile-prefs';
const DEFAULTS: MobilePrefs = { backgroundSync: true };

/** Phone-only settings, stored next to the shared ones. */
export class MobilePreferences {
  private readonly store: SimpleStore<MobilePrefs> = createSimpleStore(DEFAULTS);

  constructor(private readonly storage: StoragePort) {}

  get prefs(): ReadonlyStore<MobilePrefs> {
    return this.store;
  }

  async load(): Promise<void> {
    const stored = await this.storage.get(KEY);
    if (stored && typeof stored === 'object' && 'backgroundSync' in stored) {
      this.store.set({ backgroundSync: stored.backgroundSync !== false });
    }
  }

  async update(patch: Partial<MobilePrefs>): Promise<void> {
    const next = { ...this.store.get(), ...patch };
    this.store.set(next);
    await this.storage.set(KEY, next);
  }
}
