import type { BannerModel } from '@clipbridge/app/presentation';
import { subnetLabel } from '@clipbridge/core';
import { type ReactElement, useState } from 'react';

import type { ClipBridgeApi } from '../../../../shared/ipc-contract';
import { useDiagnosticsPresenter } from './use-diagnostics-presenter';

interface TroubleshootPanelProps {
  readonly model: BannerModel;
  readonly api: Pick<ClipBridgeApi, 'getDiagnostics'>;
  readonly onClose: () => void;
}

export function TroubleshootPanel({ model, api, onClose }: TroubleshootPanelProps): ReactElement {
  const { diagnostics, refresh, report } = useDiagnosticsPresenter(api);
  const [copied, setCopied] = useState(false);

  const copyReport = (): void => {
    if (!report) return;
    void navigator.clipboard.writeText(report).then(() => {
      setCopied(true);
    });
  };

  return (
    <section className="panel" aria-label="Troubleshoot">
      <header className="panel__header">
        <h2>{model.title}</h2>
        <button type="button" className="button button--ghost" onClick={onClose}>
          Close
        </button>
      </header>
      {model.message && <p>{model.message}</p>}
      {model.steps.length > 0 && (
        <>
          <h3>Try this</h3>
          <ol className="steps">
            {model.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      )}

      <h3>This device</h3>
      {diagnostics ? (
        <dl className="facts">
          <dt>Name</dt>
          <dd>{diagnostics.deviceName}</dd>
          <dt>Network</dt>
          <dd>
            {diagnostics.network?.subnet
              ? `${diagnostics.network.kind} · ${subnetLabel(diagnostics.network.subnet)}`
              : 'Not connected'}
          </dd>
          <dt>IP address</dt>
          <dd>{diagnostics.network?.ipv4 ?? '—'}</dd>
          <dt>Port</dt>
          <dd>{diagnostics.listenPort ?? 'Not listening'}</dd>
        </dl>
      ) : (
        <p className="muted">Loading…</p>
      )}

      <div className="panel__actions">
        <button type="button" className="button" onClick={refresh}>
          Refresh
        </button>
        <button type="button" className="button" onClick={copyReport} disabled={!report}>
          {copied ? 'Copied' : 'Copy diagnostics'}
        </button>
      </div>
    </section>
  );
}
