import { svgToDataUrl, toHostingModel } from '@clipbridge/app/presentation';
import type { ReactElement } from 'react';

import type { HostingView, PairingApi } from '../../../../shared/ipc-contract';
import { useNow } from '../../state/use-app-snapshot';

interface AddDeviceDialogProps {
  readonly hosting: HostingView;
  readonly api: Pick<PairingApi, 'approveJoin' | 'denyJoin' | 'stopHosting'>;
}

/** "Add device": QR for phones, code for computers, then Allow / Deny. */
export function AddDeviceDialog({ hosting, api }: AddDeviceDialogProps): ReactElement {
  const now = useNow(1_000);
  const model = toHostingModel(hosting, now);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={model.title}>
      <section className="dialog">
        <h2>{model.title}</h2>

        {model.phase === 'show-code' && (
          <>
            <p className="muted">On a phone: scan this QR code in the ClipBridge app.</p>
            <img className="qr" src={svgToDataUrl(hosting.qrSvg)} alt="Pairing QR code" />
            <p className="muted">On a computer: choose "Join my devices" and enter this code.</p>
            <p className="code" aria-label="Pairing code">
              {hosting.code}
            </p>
            <p className="muted">{model.message}</p>
            <p className="muted small">This computer: {hosting.address}</p>
            <div className="panel__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void api.stopHosting()}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {model.phase === 'approve' && (
          <>
            <p>{model.message}</p>
            <div className="panel__actions">
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void api.denyJoin()}
              >
                Deny
              </button>
              <button type="button" className="button" onClick={() => void api.approveJoin()}>
                Allow
              </button>
            </div>
          </>
        )}

        {(model.phase === 'done' || model.phase === 'ended') && (
          <>
            {model.message && <p>{model.message}</p>}
            <div className="panel__actions">
              <button type="button" className="button" onClick={() => void api.stopHosting()}>
                Close
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
