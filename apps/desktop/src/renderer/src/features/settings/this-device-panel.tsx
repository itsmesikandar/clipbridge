import { type ReactElement, useState } from 'react';

import type { DevicesApi } from '../../../../shared/ipc-contract';

interface ThisDevicePanelProps {
  readonly selfId: string;
  readonly selfName: string;
  readonly api: Pick<DevicesApi, 'rename' | 'resetThisDevice'>;
}

/** Name of this computer and the "forget my group" escape hatch. */
export function ThisDevicePanel({ selfId, selfName, api }: ThisDevicePanelProps): ReactElement {
  const [name, setName] = useState(selfName);
  const [message, setMessage] = useState<string | null>(null);

  const save = (): void => {
    void api.rename(selfId, name).then((result) => {
      setMessage(result.ok ? 'Saved.' : result.message);
    });
  };

  const reset = (): void => {
    const confirmed = window.confirm(
      'Reset this computer?\n\nIt forgets your group and stops syncing. Also remove it on another device so it gets a new key.',
    );
    if (confirmed) void api.resetThisDevice();
  };

  return (
    <section className="card" aria-label="This computer">
      <h2 className="card__title">This computer</h2>
      <label className="field">
        <span>Name shown on your other devices</span>
        <span className="field__row">
          <input
            value={name}
            maxLength={64}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setMessage(null);
            }}
          />
          <button
            type="button"
            className="button button--small"
            disabled={name.trim() === '' || name === selfName}
            onClick={save}
          >
            Save
          </button>
        </span>
      </label>
      {message && <p className="muted small">{message}</p>}
      <div className="panel__actions">
        <button
          type="button"
          className="button button--ghost button--danger button--small"
          onClick={reset}
        >
          Reset this computer
        </button>
      </div>
    </section>
  );
}
