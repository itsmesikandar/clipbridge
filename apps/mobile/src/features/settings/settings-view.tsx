import { type ReactElement, useState } from 'react';
import { Alert, ScrollView, TextInput } from 'react-native';

import { Button, Card, Label, styles, ToggleRow, usePalette } from '@/components/ui';
import { useAppSnapshot, useContainer, useStore } from '@/state/app-context';

import { SyncService } from '../../../modules/sync-service';

/** Receive / notifications / background sync, this phone's name, recent log, reset. */
export function SettingsView(): ReactElement {
  const { controller, preferences, logger } = useContainer();
  const snapshot = useAppSnapshot();
  const prefs = useStore(preferences.prefs);
  const palette = usePalette();
  const [name, setName] = useState(snapshot.pairing.selfName ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const batteryOk = SyncService.isIgnoringBatteryOptimizations();

  const saveName = (): void => {
    const id = snapshot.pairing.selfId;
    if (!id) return;
    void controller.renameDevice(id, name).then((result) => {
      setMessage(result.ok ? 'Saved.' : result.message);
    });
  };

  const reset = (): void => {
    Alert.alert(
      'Reset this phone?',
      'It forgets your group and stops syncing. Remove it on your computer too.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => void controller.resetThisDevice() },
      ],
    );
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
    >
      <Card title="Sync">
        <ToggleRow
          label="Receive clips"
          hint="Clips copied on your computers appear here."
          value={snapshot.settings.receiveEnabled}
          onChange={(value) => void controller.updateSettings({ receiveEnabled: value })}
        />
        <ToggleRow
          label="Notifications"
          hint="Show each clip with Copy and Open buttons."
          value={snapshot.settings.notifyOnReceive}
          onChange={(value) => void controller.updateSettings({ notifyOnReceive: value })}
        />
        <ToggleRow
          label="Stay connected in the background"
          hint="Keeps a small notification so clips arrive while the app is closed."
          value={prefs.backgroundSync}
          onChange={(value) => void preferences.update({ backgroundSync: value })}
        />
        {prefs.backgroundSync && !batteryOk && (
          <>
            <Label tone="warn" small>
              Battery saving may stop ClipBridge in the background.
            </Label>
            <Button
              title="Allow background use"
              variant="secondary"
              onPress={() => {
                SyncService.openBatterySettings();
              }}
            />
          </>
        )}
      </Card>

      {snapshot.pairing.paired && (
        <Card title="This phone">
          <Label muted small>
            Name shown on your computers
          </Label>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={64}
            style={[
              styles.input,
              { color: palette.text, borderColor: palette.border, letterSpacing: 0 },
            ]}
          />
          <Button
            title="Save name"
            variant="secondary"
            onPress={saveName}
            disabled={name.trim() === ''}
          />
          {message && <Label small>{message}</Label>}
          <Button title="Reset this phone" variant="danger" onPress={reset} />
        </Card>
      )}

      <Card title="Diagnostics">
        {logger
          .recent()
          .slice(-15)
          .map((line) => (
            <Label key={`${line.at}-${line.text}`} muted small>
              {new Date(line.at).toLocaleTimeString()} {line.level.toUpperCase()} {line.text}
            </Label>
          ))}
      </Card>
    </ScrollView>
  );
}
