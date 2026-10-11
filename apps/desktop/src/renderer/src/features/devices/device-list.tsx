import { sortDevices, toDeviceRow } from '@clipbridge/app/presentation';
import type { PeerView } from '@clipbridge/core';
import { type ReactElement, useState } from 'react';

import type { DevicesApi } from '../../../../shared/ipc-contract';

interface DeviceListProps {
  readonly devices: readonly PeerView[];
  readonly now: number;
  readonly api: Pick<DevicesApi, 'rename' | 'remove'>;
  readonly onAddDevice: () => void;
}

export function DeviceList({ devices, now, api, onAddDevice }: DeviceListProps): ReactElement {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveName = (): void => {
    if (!editing) return;
    void api.rename(editing.id, editing.name).then((result) => {
      if (result.ok) setEditing(null);
      else setError(result.message);
    });
  };

  const remove = (peer: PeerView): void => {
    const confirmed = window.confirm(
      `Remove "${peer.name}"?\n\nIt will stop receiving clips immediately. Your other devices get a new key.`,
    );
    if (!confirmed) return;
    void api.remove(peer.id).then((result) => {
      if (!result.ok) setError(result.message);
    });
  };

  return (
    <section className="card" aria-label="Devices">
      <header className="card__header">
        <h2 className="card__title">Devices</h2>
        <button type="button" className="button button--small" onClick={onAddDevice}>
          Add device
        </button>
      </header>
      {devices.length === 0 ? (
        <p className="muted">
          No other devices yet. Click "Add device" to pair your phone or another computer.
        </p>
      ) : (
        <ul className="list">
          {sortDevices(devices).map((peer) => {
            const row = toDeviceRow(peer, now);
            const isEditing = editing?.id === row.id;
            return (
              <li key={row.id} className="list__item">
                <span className={`dot dot--${row.tone}`} aria-hidden="true" />
                <div className="list__body">
                  {isEditing ? (
                    <input
                      aria-label="Device name"
                      value={editing.name}
                      maxLength={64}
                      autoFocus
                      onChange={(event) => {
                        setEditing({ id: row.id, name: event.currentTarget.value });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') saveName();
                        if (event.key === 'Escape') setEditing(null);
                      }}
                    />
                  ) : (
                    <span className="list__title">{row.name}</span>
                  )}
                  <span className="list__meta">
                    {row.platformLabel} · {row.stateLabel}
                  </span>
                  {row.detail && <span className="list__detail">{row.detail}</span>}
                </div>
                {isEditing ? (
                  <button type="button" className="button button--small" onClick={saveName}>
                    Save
                  </button>
                ) : (
                  <span className="list__actions">
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => {
                        setEditing({ id: row.id, name: row.name });
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small button--danger"
                      onClick={() => {
                        remove(peer);
                      }}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
