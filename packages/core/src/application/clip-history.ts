import { type Clip, compareClipRecency } from '../domain/clip';
import type { ClipId, DeviceId } from '../domain/ids';

export interface HistoryEntry {
  readonly clip: Clip;
  /** Devices that acknowledged receiving the clip. */
  readonly deliveredTo: readonly DeviceId[];
}

export interface ClipHistoryOptions {
  readonly limit: number;
  readonly ttlMs: number;
}

export const DEFAULT_HISTORY_OPTIONS: ClipHistoryOptions = {
  limit: 20,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
};

/** Recent clips, newest first, bounded by count and age (docs/PLAN.md §8.5). */
export class ClipHistory {
  private entries: HistoryEntry[] = [];

  constructor(private readonly options: ClipHistoryOptions = DEFAULT_HISTORY_OPTIONS) {}

  /** Adds a clip; returns false if a clip with the same id is already stored. */
  add(clip: Clip): boolean {
    if (this.entries.some((entry) => entry.clip.id === clip.id)) return false;
    this.entries = [...this.entries, { clip, deliveredTo: [] }]
      .sort((a, b) => compareClipRecency(b.clip, a.clip))
      .slice(0, this.options.limit);
    return true;
  }

  markDelivered(clipId: ClipId, deviceId: DeviceId): boolean {
    let changed = false;
    this.entries = this.entries.map((entry) => {
      if (entry.clip.id !== clipId || entry.deliveredTo.includes(deviceId)) return entry;
      changed = true;
      return { ...entry, deliveredTo: [...entry.deliveredTo, deviceId] };
    });
    return changed;
  }

  /** Drops entries older than the TTL; returns true if anything was removed. */
  prune(nowMs: number): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (entry) => nowMs - entry.clip.createdAt <= this.options.ttlMs,
    );
    return this.entries.length !== before;
  }

  list(): readonly HistoryEntry[] {
    return this.entries;
  }

  /** Clips created strictly after `sinceMs`, oldest first, at most `max`. */
  clipsSince(sinceMs: number, max: number): readonly Clip[] {
    return this.entries
      .filter((entry) => entry.clip.createdAt > sinceMs)
      .slice(0, max)
      .map((entry) => entry.clip)
      .reverse();
  }

  newest(): Clip | undefined {
    return this.entries[0]?.clip;
  }

  clear(): void {
    this.entries = [];
  }
}
