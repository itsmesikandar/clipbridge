import type { AppSnapshot } from '@clipbridge/app';
import type { ReadonlyStore } from '@clipbridge/core';
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';

import { getContainer, type MobileContainer } from '../container';

const ContainerContext = createContext<MobileContainer | null>(null);

/** Starts the app layer once and gives screens access to it. */
export function AppProvider({ children }: { readonly children: ReactNode }): ReactElement | null {
  const [container] = useState(getContainer);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([container.controller.init(), container.preferences.load()]).then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, [container]);

  if (!ready) return null;
  return <ContainerContext.Provider value={container}>{children}</ContainerContext.Provider>;
}

export function useContainer(): MobileContainer {
  const container = useContext(ContainerContext);
  if (!container) throw new Error('useContainer must be used inside <AppProvider>');
  return container;
}

/** Subscribes a component to a store from the app layer. */
export function useStore<T>(store: ReadonlyStore<T>): T {
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.get(),
  );
}

export function useAppSnapshot(): AppSnapshot {
  return useStore(useContainer().controller.snapshot);
}

/** Re-renders periodically so relative times stay correct. */
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
