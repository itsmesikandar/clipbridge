import type { BannerModel } from '@clipbridge/app/presentation';
import type { ReactElement } from 'react';

interface StatusBannerProps {
  readonly model: BannerModel;
  readonly onTroubleshoot: () => void;
  /** Extra button for problems with a direct fix (e.g. "Set up again"). */
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

export function StatusBanner({ model, onTroubleshoot, action }: StatusBannerProps): ReactElement {
  return (
    <section className={`banner banner--${model.tone}`} role="status" aria-live="polite">
      <div className="banner__text">
        <strong className="banner__title">{model.title}</strong>
        {model.message && <p className="banner__message">{model.message}</p>}
      </div>
      {action && (
        <button type="button" className="button button--small" onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {model.steps.length > 0 && (
        <button type="button" className="button button--small" onClick={onTroubleshoot}>
          Troubleshoot
        </button>
      )}
    </section>
  );
}
