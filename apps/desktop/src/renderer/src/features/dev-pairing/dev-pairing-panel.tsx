import { type ReactElement, useState } from 'react';

import type { DevPairingApi, PairingView } from '../../../../shared/ipc-contract';
import { useDevPairingPresenter } from './use-dev-pairing-presenter';

interface DevPairingPanelProps {
  readonly pairing: PairingView;
  readonly api: DevPairingApi;
}

/** Temporary developer pairing (Milestone 2). Replaced by QR/code pairing in Milestone 3. */
export function DevPairingPanel({ pairing, api }: DevPairingPanelProps): ReactElement {
  const presenter = useDevPairingPresenter(api);
  const [incoming, setIncoming] = useState('');

  return (
    <section className="card card--dev" aria-label="Developer pairing">
      <h2 className="card__title">Developer pairing</h2>
      <p className="muted">
        Temporary until real pairing (QR / code) arrives. Group:{' '}
        {pairing.paired ? `${pairing.groupId ?? ''} · ${pairing.memberCount} member(s)` : 'none'}
      </p>

      <div className="panel__actions">
        {pairing.paired ? (
          <>
            <button
              type="button"
              className="button"
              disabled={presenter.busy}
              onClick={presenter.showInvite}
            >
              Show invite
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={presenter.busy}
              onClick={presenter.leaveGroup}
            >
              Leave group
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button"
            disabled={presenter.busy}
            onClick={presenter.createGroup}
          >
            Create group
          </button>
        )}
      </div>

      {presenter.outgoing && (
        <label className="field">
          <span>{presenter.outgoingLabel}</span>
          <textarea
            readOnly
            value={presenter.outgoing}
            rows={3}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
        </label>
      )}

      <label className="field">
        <span>Paste an invite or reply from the other computer</span>
        <textarea
          value={incoming}
          rows={3}
          onChange={(event) => {
            setIncoming(event.currentTarget.value);
          }}
        />
      </label>
      <div className="panel__actions">
        {!pairing.paired && (
          <button
            type="button"
            className="button"
            disabled={presenter.busy || incoming.trim() === ''}
            onClick={() => {
              presenter.joinWithInvite(incoming);
              setIncoming('');
            }}
          >
            Join with invite
          </button>
        )}
        {pairing.paired && (
          <button
            type="button"
            className="button"
            disabled={presenter.busy || incoming.trim() === ''}
            onClick={() => {
              presenter.acceptReply(incoming);
              setIncoming('');
            }}
          >
            Accept reply
          </button>
        )}
      </div>
      {presenter.error && <p className="error">{presenter.error}</p>}
    </section>
  );
}
