import { createSimpleStore, type SimpleStore } from '@clipbridge/app';
import type { ReadonlyStore, StoragePort } from '@clipbridge/core';

export interface MobilePrefs {
  /** Android: keep a foreground service running so clips arrive while the app is closed. */
  readonly backgroundSync: boolean;
  /** Write received clips straight to the clipboard while ClipBridge is open. */
  readonly autoCopyOnOpen: boolean;
}

const KEY = 'mobile-prefs';
const DEFAULTS: MobilePrefs = { backgroundSync: true, autoCopyOnOpen: false };

/** Phone-only settings, stored next to the shared ones. */
export class MobilePreferences {
  private readonly store: SimpleStore<MobilePrefs> = createSimpleStore(DEFAULTS);

  constructor(private readonly storage: StoragePort) {}

  get prefs(): ReadonlyStore<MobilePrefs> {
    return this.store;
  }

  async load(): Promise<void> {
    const stored = await this.storage.get(KEY);
    if (!stored || typeof stored !== 'object') return;
    const values = stored as Partial<Record<keyof MobilePrefs, unknown>>;
    this.store.set({
      backgroundSync: values.backgroundSync !== false,
      autoCopyOnOpen: values.autoCopyOnOpen === true,
    });
  }

  async update(patch: Partial<MobilePrefs>): Promise<void> {
    const next = { ...this.store.get(), ...patch };
    this.store.set(next);
    await this.storage.set(KEY, next);
  }
}
