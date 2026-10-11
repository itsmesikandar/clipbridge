import { type ReactElement, useState } from 'react';

import type { JoiningView, PairingApi } from '../../../../shared/ipc-contract';
import { useOnboardingPresenter } from './use-onboarding-presenter';

interface OnboardingViewProps {
  readonly api: PairingApi;
  readonly joining: JoiningView;
}

export function OnboardingView({ api, joining }: OnboardingViewProps): ReactElement {
  const presenter = useOnboardingPresenter(api, joining);
  const [showManual, setShowManual] = useState(false);
  const inProgress = presenter.busy && joining.state !== 'idle' && joining.state !== 'failed';

  return (
    <>
      <section className="card" aria-label="Join my devices">
        <h2 className="card__title">Join my devices</h2>
        <p className="muted">
          On a computer that already uses ClipBridge, click <strong>Add device</strong>. Then enter
          the code it shows.
        </p>

        {joining.hosts.length > 1 && (
          <label className="field">
            <span>Computer to join</span>
            <select
              value={presenter.hostId ?? ''}
              onChange={(event) => {
                presenter.setHostId(event.currentTarget.value || null);
              }}
            >
              <option value="">Choose…</option>
              {joining.hosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="muted small">
          {joining.hosts.length === 0
            ? 'Looking for a computer that shows a code…'
            : joining.hosts.length === 1
              ? `Found a computer showing a code (${joining.hosts[0]?.label ?? ''}).`
              : `${joining.hosts.length} computers are showing a code.`}
        </p>

        <label className="field">
          <span>Code</span>
          <input
            className="code-input"
            value={presenter.code}
            placeholder="K7QM-2XPA-9FRT"
            autoComplete="off"
            spellCheck={false}
            disabled={inProgress}
            onChange={(event) => {
              presenter.setCode(event.currentTarget.value);
            }}
          />
        </label>

        {showManual ? (
          <label className="field">
            <span>Computer address (shown under the code)</span>
            <input
              value={presenter.manualAddress}
              placeholder="192.168.1.7:47821"
              disabled={inProgress}
              onChange={(event) => {
                presenter.setManualAddress(event.currentTarget.value);
              }}
            />
          </label>
        ) : (
          <button
            type="button"
            className="link"
            onClick={() => {
              setShowManual(true);
            }}
          >
            Can’t find the computer? Enter its address
          </button>
        )}

        {presenter.statusText && (
          <p className={joining.state === 'failed' ? 'error' : 'muted'} role="status">
            {presenter.statusText}
          </p>
        )}
        {presenter.error && <p className="error">{presenter.error}</p>}

        <div className="panel__actions">
          {inProgress ? (
            <button type="button" className="button button--ghost" onClick={presenter.cancel}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="button"
              disabled={presenter.code.trim() === ''}
              onClick={presenter.join}
            >
              Join
            </button>
          )}
        </div>
      </section>

      <section className="card" aria-label="Start a new group">
        <h2 className="card__title">First computer?</h2>
        <p className="muted">
          Start a new group on this computer, then add your other devices to it.
        </p>
        <div className="panel__actions">
          <button
            type="button"
            className="button button--ghost"
            disabled={presenter.busy}
            onClick={presenter.createGroup}
          >
            Start a new group
          </button>
        </div>
      </section>
    </>
  );
}
