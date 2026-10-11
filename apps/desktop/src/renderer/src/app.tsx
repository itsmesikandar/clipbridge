import { type ReactElement, useState } from 'react';

import type { ClipBridgeApi } from '../../shared/ipc-contract';
import { AboutView } from './features/about/about-view';
import { useAboutPresenter } from './features/about/use-about-presenter';
import { DevPairingPanel } from './features/dev-pairing/dev-pairing-panel';
import { DeviceList } from './features/devices/device-list';
import { HistoryList } from './features/history/history-list';
import { SettingsPanel } from './features/settings/settings-panel';
import { StatusBanner } from './features/status/status-banner';
import { toBannerModel } from './features/status/status-model';
import { TroubleshootPanel } from './features/status/troubleshoot-panel';
import { describeIssue } from './i18n/issue-text';
import { useAppSnapshot, useNow } from './state/use-app-snapshot';

export function App({ api = window.clipbridge }: { readonly api?: ClipBridgeApi }): ReactElement {
  const snapshot = useAppSnapshot(api);
  const about = useAboutPresenter(api);
  const now = useNow();
  const [troubleshooting, setTroubleshooting] = useState(false);

  if (!snapshot) {
    return (
      <main className="app">
        <p className="muted">Starting…</p>
      </main>
    );
  }

  const banner = toBannerModel(snapshot.status);
  const sendError = snapshot.lastSendError ? describeIssue(snapshot.lastSendError) : null;

  return (
    <main className="app">
      <h1 className="app__title">ClipBridge</h1>
      <StatusBanner
        model={banner}
        onTroubleshoot={() => {
          setTroubleshooting(true);
        }}
      />
      {troubleshooting && (
        <TroubleshootPanel
          model={banner}
          api={api}
          onClose={() => {
            setTroubleshooting(false);
          }}
        />
      )}
      {sendError && (
        <p className="error" role="alert">
          {sendError.title}: {sendError.message}
        </p>
      )}
      {snapshot.pairing.devMode && <DevPairingPanel pairing={snapshot.pairing} api={api.dev} />}
      {snapshot.pairing.paired && <DeviceList devices={snapshot.devices} now={now} />}
      {snapshot.pairing.paired && <HistoryList items={snapshot.history} now={now} api={api} />}
      <SettingsPanel settings={snapshot.settings} api={api} />
      <footer className="app__footer">
        <AboutView state={about} />
        <p className="muted">Works only on your local network. Nothing is sent to the internet.</p>
      </footer>
    </main>
  );
}
