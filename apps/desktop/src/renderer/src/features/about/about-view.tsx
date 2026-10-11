import type { ReactElement } from 'react';

import type { AboutState } from './use-about-presenter';

const PLATFORM_LABELS = { windows: 'Windows', macos: 'macOS', linux: 'Linux' } as const;

export function AboutView({ state }: { readonly state: AboutState }): ReactElement {
  switch (state.status) {
    case 'loading':
      return <p className="about about--muted">Loading…</p>;
    case 'error':
      return <p className="about about--error">Could not load app info: {state.message}</p>;
    case 'ready':
      return (
        <dl className="about">
          <dt>App</dt>
          <dd>{state.info.appVersion}</dd>
          <dt>Core</dt>
          <dd>{state.info.coreVersion}</dd>
          <dt>Protocol</dt>
          <dd>v{state.info.protocolVersion}</dd>
          <dt>Platform</dt>
          <dd>{PLATFORM_LABELS[state.info.platform]}</dd>
        </dl>
      );
  }
}
