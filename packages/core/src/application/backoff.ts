import type { RandomPort } from '../ports/random';

export const BACKOFF = {
  initialMs: 1_000,
  maxMs: 30_000,
  /** ±20 % jitter so many devices do not retry in lockstep. */
  jitterRatio: 0.2,
} as const;

/** Delay before retry number `attempt` (0-based): 1 s, 2 s, 4 s … capped at 30 s, with jitter. */
export function backoffDelayMs(attempt: number, random: RandomPort): number {
  const base = Math.min(BACKOFF.maxMs, BACKOFF.initialMs * 2 ** Math.max(0, attempt));
  const unit = (random.randomBytes(1)[0] ?? 128) / 255; // 0..1
  const jitter = (unit * 2 - 1) * BACKOFF.jitterRatio;
  return Math.round(base * (1 + jitter));
}
