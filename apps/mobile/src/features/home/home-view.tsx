import type { AppSnapshot } from '@clipbridge/app';
import {
  formatRelativeTime,
  sortDevices,
  toBannerModel,
  toDeviceRow,
} from '@clipbridge/app/presentation';
import { classifyText } from '@clipbridge/core';
import { Link } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { Image, type ImageStyle, Linking, Platform, ScrollView, View } from 'react-native';

import { imageFromClipboard } from '@/adapters/image-tools';
import { readClipboardText } from '@/adapters/platform-adapters';
import { Banner, Button, Card, Dot, Label, styles, usePalette } from '@/components/ui';
import { useShareOutcome } from '@/features/system/system-effects';
import { useContainer, useNow } from '@/state/app-context';

/** Paired home screen: status, send clipboard, recent clips, computers. */
export function HomeView({ snapshot }: { readonly snapshot: AppSnapshot }): ReactElement {
  const { controller, clipboard } = useContainer();
  const palette = usePalette();
  const now = useNow();
  const share = useShareOutcome();
  const [feedback, setFeedback] = useState<string | null>(null);
  const banner = toBannerModel(snapshot.status);
  const removed = snapshot.status.issue?.code === 'REMOVED_FROM_GROUP';
  const computers = sortDevices(snapshot.devices.filter((device) => device.role === 'hub'));

  const sendClipboard = (): void => {
    void (async () => {
      const text = await readClipboardText();
      const content = text.trim() !== '' ? classifyText(text) : await imageFromClipboard();
      if (!content) {
        setFeedback('The clipboard is empty.');
        return;
      }
      const sent = controller.sendClip(content);
      setFeedback(sent.ok ? 'Sent.' : sent.message);
    })().catch(() => {
      setFeedback('Could not read the clipboard.');
    });
  };

  const copy = (id: string): void => {
    const content = controller.clipContent(id);
    if (!content) return;
    void clipboard.write(content).then((result) => {
      setFeedback(result.ok ? 'Copied.' : result.error.message);
    });
  };

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
    >
      <Banner tone={banner.tone} title={banner.title} message={banner.message}>
        {banner.steps.map((step) => (
          <Label key={step} small>
            • {step}
          </Label>
        ))}
        {removed && (
          <Button title="Set up again" onPress={() => void controller.resetThisDevice()} />
        )}
        {snapshot.status.issue?.code === 'LOCAL_NETWORK_PERMISSION' && (
          <Button title="Open Settings" onPress={() => void Linking.openSettings()} />
        )}
      </Banner>
      {Platform.OS === 'ios' && (
        <Label muted small>
          Clips from your computers arrive while ClipBridge is open. Opening it catches up on what
          you missed.
        </Label>
      )}

      {share && <Label tone={share.ok ? 'ok' : 'error'}>{share.message}</Label>}

      <Card title="Send to your computers">
        <Label muted small>
          Tip: in any app, tap Share → ClipBridge.
        </Label>
        <Button title="Send clipboard" onPress={sendClipboard} disabled={removed} />
        {feedback && <Label small>{feedback}</Label>}
      </Card>

      <Card title="Recent">
        {snapshot.history.length === 0 ? (
          <Label muted>Copy something on your computer — it shows up here.</Label>
        ) : (
          snapshot.history.map((item) => (
            <View key={item.id} style={styles.row}>
              {item.thumbnail && (
                <Image
                  source={{ uri: item.thumbnail }}
                  style={thumbnailStyle}
                  accessibilityLabel="Image"
                />
              )}
              <View style={styles.flex}>
                <Label>{item.preview}</Label>
                <Label muted small>
                  {item.fromName} · {formatRelativeTime(item.createdAt, now)}
                </Label>
              </View>
              {item.kind === 'url' && (
                <Button
                  title="Open"
                  variant="secondary"
                  onPress={() => void Linking.openURL(item.preview)}
                />
              )}
              <Button
                title="Copy"
                variant="secondary"
                onPress={() => {
                  copy(item.id);
                }}
              />
            </View>
          ))
        )}
      </Card>

      <Card title="Computers" right={<Link href="/settings">Settings</Link>}>
        {computers.length === 0 ? (
          <Label muted>No computer in your group yet.</Label>
        ) : (
          computers.map((peer) => {
            const row = toDeviceRow(peer, now);
            return (
              <View key={row.id} style={styles.row}>
                <Dot tone={row.tone} />
                <View style={styles.flex}>
                  <Label>{row.name}</Label>
                  <Label muted small>
                    {row.platformLabel} · {row.stateLabel}
                  </Label>
                  {row.detail && (
                    <Label tone="error" small>
                      {row.detail}
                    </Label>
                  )}
                </View>
              </View>
            );
          })
        )}
      </Card>
    </ScrollView>
  );
}

const thumbnailStyle: ImageStyle = { width: 48, height: 48, borderRadius: 6 };
