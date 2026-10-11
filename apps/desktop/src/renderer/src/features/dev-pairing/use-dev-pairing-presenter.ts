import { useState } from 'react';

import type { DevPairingApi, IpcResult } from '../../../../shared/ipc-contract';

export interface DevPairingPresenter {
  readonly busy: boolean;
  readonly error: string | null;
  /** Text to hand to the other device (invite or reply). */
  readonly outgoing: string | null;
  readonly outgoingLabel: string | null;
  readonly createGroup: () => void;
  readonly showInvite: () => void;
  readonly joinWithInvite: (text: string) => void;
  readonly acceptReply: (text: string) => void;
  readonly leaveGroup: () => void;
}

export function useDevPairingPresenter(api: DevPairingApi): DevPairingPresenter {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outgoing, setOutgoing] = useState<{ text: string; label: string } | null>(null);

  function run<T>(action: () => Promise<IpcResult<T>>, onSuccess: (value: T) => void): void {
    setBusy(true);
    setError(null);
    void action()
      .then((result) => {
        if (result.ok) onSuccess(result.value);
        else setError(result.message);
      })
      .finally(() => {
        setBusy(false);
      });
  }

  return {
    busy,
    error,
    outgoing: outgoing?.text ?? null,
    outgoingLabel: outgoing?.label ?? null,
    createGroup: () => {
      run(
        () => api.createGroup(),
        () => {
          setOutgoing(null);
        },
      );
    },
    showInvite: () => {
      run(
        () => api.exportInvite(),
        (text) => {
          setOutgoing({
            text,
            label: 'Invite — paste it into "Join with invite" on the other computer',
          });
        },
      );
    },
    joinWithInvite: (text) => {
      run(
        () => api.importInvite(text),
        (reply) => {
          setOutgoing({
            text: reply,
            label: 'Reply — paste it into "Accept reply" on the inviting computer',
          });
        },
      );
    },
    acceptReply: (text) => {
      run(
        () => api.importReply(text),
        () => {
          setOutgoing(null);
        },
      );
    },
    leaveGroup: () => {
      run(
        () => api.leaveGroup(),
        () => {
          setOutgoing(null);
        },
      );
    },
  };
}
