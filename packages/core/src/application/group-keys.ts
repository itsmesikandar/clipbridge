import type { GroupKeyRing } from '../protocol/handshake';

export interface EpochKey {
  readonly epoch: number;
  readonly key: Uint8Array;
}

/** Previous keys kept so devices that missed a rotation can still connect and catch up. */
export const MAX_PREVIOUS_KEYS = 3;

/** The current group key plus a few previous ones (docs/PLAN.md §8.4). */
export class GroupKeys implements GroupKeyRing {
  private currentKey: EpochKey;
  private previousKeys: EpochKey[];

  constructor(current: EpochKey, previous: readonly EpochKey[] = []) {
    this.currentKey = current;
    this.previousKeys = previous
      .filter((entry) => entry.epoch < current.epoch)
      .sort((a, b) => b.epoch - a.epoch)
      .slice(0, MAX_PREVIOUS_KEYS);
  }

  get epoch(): number {
    return this.currentKey.epoch;
  }

  get current(): EpochKey {
    return this.currentKey;
  }

  get previous(): readonly EpochKey[] {
    return this.previousKeys;
  }

  keyFor(epoch: number): Uint8Array | null {
    if (epoch === this.currentKey.epoch) return this.currentKey.key;
    return this.previousKeys.find((entry) => entry.epoch === epoch)?.key ?? null;
  }

  /** Makes `next` current; ignores keys that are not newer. Returns true if applied. */
  rotate(next: EpochKey): boolean {
    if (next.epoch <= this.currentKey.epoch) return false;
    this.previousKeys = [this.currentKey, ...this.previousKeys].slice(0, MAX_PREVIOUS_KEYS);
    this.currentKey = next;
    return true;
  }
}
