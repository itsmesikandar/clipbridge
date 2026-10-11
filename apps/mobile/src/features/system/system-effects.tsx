import { createContext, type ReactElement, type ReactNode, useContext } from 'react';

import { type ShareOutcome, useSystemEffects } from './use-system-effects';

const ShareOutcomeContext = createContext<ShareOutcome | null>(null);

/** Runs app-wide effects once and exposes the result of the last share to screens. */
export function SystemEffects({ children }: { readonly children: ReactNode }): ReactElement {
  const shareOutcome = useSystemEffects();
  return (
    <ShareOutcomeContext.Provider value={shareOutcome}>{children}</ShareOutcomeContext.Provider>
  );
}

export function useShareOutcome(): ShareOutcome | null {
  return useContext(ShareOutcomeContext);
}
