import type { ReactElement } from 'react';

import type { BannerModel } from './status-model';

interface StatusBannerProps {
  readonly model: BannerModel;
  readonly onTroubleshoot: () => void;
}

export function StatusBanner({ model, onTroubleshoot }: StatusBannerProps): ReactElement {
  return (
    <section className={`banner banner--${model.tone}`} role="status" aria-live="polite">
      <div className="banner__text">
        <strong className="banner__title">{model.title}</strong>
        {model.message && <p className="banner__message">{model.message}</p>}
      </div>
      {model.steps.length > 0 && (
        <button type="button" className="button button--small" onClick={onTroubleshoot}>
          Troubleshoot
        </button>
      )}
    </section>
  );
}
