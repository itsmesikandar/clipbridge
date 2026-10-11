import { useEffect, useState } from 'react';

import type { AppInfo, ClipBridgeApi } from '../../../../shared/ipc-contract';

export type AboutState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly info: AppInfo }
  | { readonly status: 'error'; readonly message: string };

/** Loads app/core/protocol versions for the About section. */
export function useAboutPresenter(api: Pick<ClipBridgeApi, 'getAppInfo'>): AboutState {
  const [state, setState] = useState<AboutState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api
      .getAppInfo()
      .then((info) => {
        if (!cancelled) setState({ status: 'ready', info });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  return state;
}
