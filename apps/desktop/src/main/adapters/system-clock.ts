import type { Cancel, ClockPort } from '@clipbridge/core';

export class SystemClock implements ClockPort {
  now(): number {
    return Date.now();
  }

  schedule(delayMs: number, callback: () => void): Cancel {
    const timer = setTimeout(callback, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }
}
