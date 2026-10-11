/** Cancels a scheduled callback. Safe to call more than once. */
export type Cancel = () => void;

/** Time source and timers. Injected so tests can control time. */
export interface ClockPort {
  /** Unix time in milliseconds. */
  now(): number;
  /** Runs `callback` once after `delayMs`. */
  schedule(delayMs: number, callback: () => void): Cancel;
}
