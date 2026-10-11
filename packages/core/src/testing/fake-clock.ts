import type { Cancel, ClockPort } from '../ports/clock';

interface Timer {
  readonly id: number;
  readonly at: number;
  readonly callback: () => void;
}

/**
 * Lets pending promise callbacks run. Several rounds, because one settled
 * promise often schedules the next.
 */
export async function settle(rounds = 50): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

/** Manually advanced clock for deterministic tests of timeouts, retries and heartbeats. */
export class FakeClock implements ClockPort {
  private timers: Timer[] = [];
  private nextId = 1;

  constructor(private current = Date.UTC(2026, 0, 1)) {}

  now(): number {
    return this.current;
  }

  schedule(delayMs: number, callback: () => void): Cancel {
    const timer: Timer = { id: this.nextId++, at: this.current + Math.max(0, delayMs), callback };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((candidate) => candidate.id !== timer.id);
    };
  }

  /** Moves time forward, running due timers in order and settling promises after each. */
  async advance(ms: number): Promise<void> {
    const target = this.current + ms;
    await settle();
    for (;;) {
      const next = this.nextDue(target);
      if (!next) break;
      this.timers = this.timers.filter((timer) => timer.id !== next.id);
      this.current = next.at;
      next.callback();
      await settle();
    }
    this.current = target;
    await settle();
  }

  get pendingTimers(): number {
    return this.timers.length;
  }

  private nextDue(target: number): Timer | undefined {
    let next: Timer | undefined;
    for (const timer of this.timers) {
      if (timer.at > target) continue;
      if (!next || timer.at < next.at || (timer.at === next.at && timer.id < next.id)) next = timer;
    }
    return next;
  }
}
