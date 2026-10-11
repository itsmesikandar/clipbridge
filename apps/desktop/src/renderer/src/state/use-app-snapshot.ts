import { useEffect, useState } from 'react';

import type { AppSnapshot, ClipBridgeApi } from '../../../shared/ipc-contract';

/** Current app state from the main process, kept up to date by pushes. Null while loading. */
export function useAppSnapshot(
  api: Pick<ClipBridgeApi, 'getState' | 'onStateChanged'>,
): AppSnapshot | null {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = api.onStateChanged((next) => {
      if (active) setSnapshot(next);
    });
    void api.getState().then((initial) => {
      // A push may already have arrived; never overwrite newer state.
      if (active) setSnapshot((current) => current ?? initial);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  return snapshot;
}

/** Re-renders periodically so relative times ("2 min ago") stay correct. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
