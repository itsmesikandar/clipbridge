import { describeJoinState } from '@clipbridge/app/presentation';
import { useEffect, useState } from 'react';

import type { JoiningView, PairingApi } from '../../../../shared/ipc-contract';

export interface OnboardingPresenter {
  readonly code: string;
  readonly setCode: (code: string) => void;
  readonly hostId: string | null;
  readonly setHostId: (id: string | null) => void;
  readonly manualAddress: string;
  readonly setManualAddress: (address: string) => void;
  readonly busy: boolean;
  readonly statusText: string | null;
  readonly error: string | null;
  readonly createGroup: () => void;
  readonly join: () => void;
  readonly cancel: () => void;
}

/** First-run screen: create a group or join one; searches for computers showing a code. */
export function useOnboardingPresenter(api: PairingApi, joining: JoiningView): OnboardingPresenter {
  const [code, setCode] = useState('');
  const [hostId, setHostId] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void api.startJoinSearch();
    return () => {
      void api.stopJoinSearch();
    };
  }, [api]);

  const inProgress = ['connecting', 'verifying', 'awaiting-approval'].includes(joining.state);

  return {
    code,
    setCode,
    hostId,
    setHostId,
    manualAddress,
    setManualAddress,
    busy: inProgress || creating,
    statusText: describeJoinState(joining.state, joining.error),
    error,
    createGroup: () => {
      setCreating(true);
      setError(null);
      void api
        .createGroup()
        .then((result) => {
          if (!result.ok) setError(result.message);
        })
        .finally(() => {
          setCreating(false);
        });
    },
    join: () => {
      setError(null);
      const address = manualAddress.trim();
      void api.join({ code, hostId, address: address === '' ? null : address }).then((result) => {
        // Failures during the exchange are shown via `joining.state`; this covers input errors.
        if (!result.ok && !result.issue) setError(result.message);
      });
    },
    cancel: () => {
      void api.cancelJoin();
    },
  };
}
