import type { ReadonlyStore, Unsubscribe } from '@clipbridge/core';

export interface SimpleStore<T> extends ReadonlyStore<T> {
  set(value: T): void;
}

/** Observable value for main-process state (same contract as core's stores). */
export function createSimpleStore<T>(initial: T): SimpleStore<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return;
      value = next;
      for (const listener of [...listeners]) listener(value);
    },
    subscribe: (listener): Unsubscribe => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
