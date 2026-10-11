import type { PeerView } from '@clipbridge/core';
import type { ReactElement } from 'react';

import { sortDevices, toDeviceRow } from './device-model';

interface DeviceListProps {
  readonly devices: readonly PeerView[];
  readonly now: number;
}

export function DeviceList({ devices, now }: DeviceListProps): ReactElement {
  return (
    <section className="card" aria-label="Devices">
      <h2 className="card__title">Devices</h2>
      {devices.length === 0 ? (
        <p className="muted">No other devices in your group yet.</p>
      ) : (
        <ul className="list">
          {sortDevices(devices).map((peer) => {
            const row = toDeviceRow(peer, now);
            return (
              <li key={row.id} className="list__item">
                <span className={`dot dot--${row.tone}`} aria-hidden="true" />
                <div className="list__body">
                  <span className="list__title">{row.name}</span>
                  <span className="list__meta">
                    {row.platformLabel} · {row.stateLabel}
                  </span>
                  {row.detail && <span className="list__detail">{row.detail}</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
