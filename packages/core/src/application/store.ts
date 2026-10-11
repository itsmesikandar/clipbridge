import type { Unsubscribe } from '../ports/transport';

/** Read-only observable value; what the UI subscribes to. */
export interface ReadonlyStore<T> {
  get(): T;
  /** Calls `listener` on every change (not immediately). */
  subscribe(listener: (value: T) => void): Unsubscribe;
}

export interface Store<T> extends ReadonlyStore<T> {
  set(value: T): void;
  update(change: (current: T) => T): void;
}

/** Minimal observable value; notifies only when the value identity changes. */
export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();

  const set = (next: T): void => {
    if (Object.is(next, value)) return;
    value = next;
    for (const listener of [...listeners]) listener(value);
  };

  return {
    get: () => value,
    set,
    update: (change) => {
      set(change(value));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
