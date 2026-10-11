import { toBannerModel } from '@clipbridge/app/presentation';
import { describeIssue } from '@clipbridge/app/presentation';
import { type ReactElement, useState } from 'react';

import type { ClipBridgeApi } from '../../shared/ipc-contract';
import { AboutView } from './features/about/about-view';
import { useAboutPresenter } from './features/about/use-about-presenter';
import { DeviceList } from './features/devices/device-list';
import { HistoryList } from './features/history/history-list';
import { OnboardingView } from './features/onboarding/onboarding-view';
import { AddDeviceDialog } from './features/pairing/add-device-dialog';
import { SettingsPanel } from './features/settings/settings-panel';
import { ThisDevicePanel } from './features/settings/this-device-panel';
import { StatusBanner } from './features/status/status-banner';
import { TroubleshootPanel } from './features/status/troubleshoot-panel';
import { useAppSnapshot, useNow } from './state/use-app-snapshot';

export function App({ api = window.clipbridge }: { readonly api?: ClipBridgeApi }): ReactElement {
  const snapshot = useAppSnapshot(api);
  const about = useAboutPresenter(api);
  const now = useNow();
  const [troubleshooting, setTroubleshooting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  if (!snapshot) {
    return (
      <main className="app">
        <p className="muted">Starting…</p>
      </main>
    );
  }

  const { pairing } = snapshot;
  const banner = toBannerModel(snapshot.status);
  const sendError = snapshot.lastSendError ? describeIssue(snapshot.lastSendError) : null;

  const addDevice = (): void => {
    setAddError(null);
    void api.pairing.startHosting().then((result) => {
      if (!result.ok)
        setAddError(result.issue ? describeIssue(result.issue).title : result.message);
    });
  };

  return (
    <main className="app">
      <h1 className="app__title">ClipBridge</h1>

      {pairing.paired ? (
        <>
          <StatusBanner
            model={banner}
            onTroubleshoot={() => {
              setTroubleshooting(true);
            }}
            {...(snapshot.status.issue?.code === 'REMOVED_FROM_GROUP'
              ? {
                  action: {
                    label: 'Set up again',
                    onClick: () => void api.devices.resetThisDevice(),
                  },
                }
              : {})}
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
          {addError && (
            <p className="error" role="alert">
              {addError}
            </p>
          )}
          <DeviceList
            devices={snapshot.devices}
            now={now}
            api={api.devices}
            onAddDevice={addDevice}
          />
          <HistoryList items={snapshot.history} now={now} api={api} />
          <SettingsPanel settings={snapshot.settings} api={api} />
          {pairing.selfId && pairing.selfName && (
            <ThisDevicePanel
              key={pairing.selfName}
              selfId={pairing.selfId}
              selfName={pairing.selfName}
              api={api.devices}
            />
          )}
        </>
      ) : (
        <OnboardingView api={api.pairing} joining={pairing.joining} />
      )}

      {pairing.hosting && <AddDeviceDialog hosting={pairing.hosting} api={api.pairing} />}

      <footer className="app__footer">
        <AboutView state={about} />
        <p className="muted">Works only on your local network. Nothing is sent to the internet.</p>
      </footer>
    </main>
  );
}
