import type { ReactElement } from 'react';

import type { ClipBridgeApi, SettingsPatch, SettingsView } from '../../../../shared/ipc-contract';

const OPTIONS: readonly { key: keyof SettingsView; label: string; hint: string }[] = [
  {
    key: 'sendEnabled',
    label: 'Send from this computer',
    hint: 'Copies here go to your other devices.',
  },
  {
    key: 'receiveEnabled',
    label: 'Receive on this computer',
    hint: 'Clips from other devices land in this clipboard.',
  },
  {
    key: 'notifyOnReceive',
    label: 'Show notifications',
    hint: 'A small notice when a clip arrives.',
  },
];

interface SettingsPanelProps {
  readonly settings: SettingsView;
  readonly api: Pick<ClipBridgeApi, 'updateSettings'>;
}

export function SettingsPanel({ settings, api }: SettingsPanelProps): ReactElement {
  const toggle = (key: keyof SettingsView): void => {
    const patch: SettingsPatch = { [key]: !settings[key] };
    void api.updateSettings(patch);
  };

  return (
    <section className="card" aria-label="Settings">
      <h2 className="card__title">Settings</h2>
      {OPTIONS.map((option) => (
        <label key={option.key} className="switch">
          <input
            type="checkbox"
            checked={settings[option.key]}
            onChange={() => {
              toggle(option.key);
            }}
          />
          <span className="switch__text">
            <span>{option.label}</span>
            <span className="list__meta">{option.hint}</span>
          </span>
        </label>
      ))}
    </section>
  );
}
