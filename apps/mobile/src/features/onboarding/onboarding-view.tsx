import type { JoiningView } from '@clipbridge/app';
import { describeJoinState } from '@clipbridge/app/presentation';
import { router } from 'expo-router';
import { type ReactElement, useEffect, useState } from 'react';
import { ScrollView, TextInput } from 'react-native';

import { Button, Card, Label, styles, usePalette } from '@/components/ui';
import { useContainer } from '@/state/app-context';

/** First run: scan the QR code shown by "Add device" on a computer, or type its code. */
export function OnboardingView({ joining }: { readonly joining: JoiningView }): ReactElement {
  const { controller } = useContainer();
  const palette = usePalette();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy =
    joining.state === 'connecting' ||
    joining.state === 'verifying' ||
    joining.state === 'awaiting-approval';
  const status = describeJoinState(joining.state, joining.error);

  useEffect(() => {
    void controller.startJoinSearch();
    return () => {
      controller.stopJoinSearch();
    };
  }, [controller]);

  const joinWithCode = (): void => {
    setError(null);
    void controller
      .join({ code, hostId: joining.hosts[0]?.id ?? null, address: null })
      .then((result) => {
        if (!result.ok && !result.issue) setError(result.message);
      });
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
    >
      <Card title="Connect to your computer">
        <Label muted>
          On your computer, open ClipBridge and click “Add device”. Then scan the QR code it shows.
        </Label>
        <Button
          title="Scan QR code"
          onPress={() => {
            router.push('/scan');
          }}
          disabled={busy}
        />
      </Card>

      <Card title="Or type the code">
        <Label muted small>
          {joining.hosts.length === 0
            ? 'Looking for a computer that shows a code… Make sure this phone uses the same Wi-Fi.'
            : `Found ${joining.hosts.length === 1 ? 'a computer' : `${joining.hosts.length} computers`} showing a code.`}
        </Label>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="K7QM-2XPA-9FRT"
          placeholderTextColor={palette.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!busy}
          style={[styles.input, { color: palette.text, borderColor: palette.border }]}
          accessibilityLabel="Pairing code"
        />
        {busy ? (
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => {
              controller.cancelJoin();
            }}
          />
        ) : (
          <Button
            title="Join"
            onPress={joinWithCode}
            disabled={code.trim() === '' || joining.hosts.length === 0}
          />
        )}
      </Card>

      {status && <Label tone={joining.state === 'failed' ? 'error' : 'info'}>{status}</Label>}
      {error && <Label tone="error">{error}</Label>}
      <Label muted small>
        ClipBridge works only on your local network. Nothing is sent to the internet.
      </Label>
    </ScrollView>
  );
}
