import { type ReactElement, useState } from 'react';

import type { ClipBridgeApi, HistoryItemView } from '../../../../shared/ipc-contract';
import { formatRelativeTime } from '../../lib/format-time';

const KIND_LABELS = { text: 'Text', url: 'Link', image: 'Image' } as const;

interface HistoryListProps {
  readonly items: readonly HistoryItemView[];
  readonly now: number;
  readonly api: Pick<ClipBridgeApi, 'copyHistoryItem' | 'clearHistory'>;
}

export function HistoryList({ items, now, api }: HistoryListProps): ReactElement {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = (id: string): void => {
    void api.copyHistoryItem(id).then((result) => {
      if (result.ok) setCopiedId(id);
    });
  };

  return (
    <section className="card" aria-label="Recent clips">
      <header className="card__header">
        <h2 className="card__title">Recent</h2>
        {items.length > 0 && (
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => void api.clearHistory()}
          >
            Clear
          </button>
        )}
      </header>
      {items.length === 0 ? (
        <p className="muted">Copy something on any device — it shows up here.</p>
      ) : (
        <ul className="list">
          {items.map((item) => (
            <li key={item.id} className="list__item">
              <span className="tag">{KIND_LABELS[item.kind]}</span>
              <div className="list__body">
                <span className="list__title list__title--clip" title={item.preview}>
                  {item.preview}
                </span>
                <span className="list__meta">
                  {item.fromName} · {formatRelativeTime(item.createdAt, now)}
                  {item.fromThisDevice && item.deliveredCount > 0
                    ? ` · delivered to ${item.deliveredCount}`
                    : ''}
                </span>
              </div>
              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  copy(item.id);
                }}
              >
                {copiedId === item.id ? 'Copied' : 'Copy'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
