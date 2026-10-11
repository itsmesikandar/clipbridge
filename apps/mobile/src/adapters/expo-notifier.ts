import type { Clip, DeviceRecord, NotifierPort } from '@clipbridge/core';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const CLIP_CATEGORY = 'clip';
export const URL_CLIP_CATEGORY = 'clip-url';
export const CLIP_CHANNEL = 'clips';
export const ACTION_COPY = 'copy';
export const ACTION_OPEN = 'open';

const PREVIEW_LENGTH = 120;

/** Title and body for a received clip; pure so it can be unit-tested. */
export function describeClip(
  clip: Clip,
  from: DeviceRecord | undefined,
): { title: string; body: string } {
  const sender = from?.name ?? 'your computer';
  switch (clip.content.kind) {
    case 'url':
      return { title: `Link from ${sender}`, body: clip.content.url.slice(0, PREVIEW_LENGTH) };
    case 'text': {
      const oneLine = clip.content.text.replace(/\s+/g, ' ').trim();
      return {
        title: `Text from ${sender}`,
        body:
          oneLine.length > PREVIEW_LENGTH ? `${oneLine.slice(0, PREVIEW_LENGTH - 1)}…` : oneLine,
      };
    }
    case 'image':
      return { title: `Image from ${sender}`, body: 'Tap Copy to put it on your clipboard' };
  }
}

/** Registers the notification channel and the Copy / Open actions. Call once at startup. */
export async function setUpNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CLIP_CHANNEL, {
      name: 'Received clips',
      importance: Notifications.AndroidImportance.HIGH,
      showBadge: false,
    });
  }
  const copy = {
    identifier: ACTION_COPY,
    buttonTitle: 'Copy',
    options: { opensAppToForeground: false },
  };
  const open = {
    identifier: ACTION_OPEN,
    buttonTitle: 'Open',
    options: { opensAppToForeground: true },
  };
  await Notifications.setNotificationCategoryAsync(CLIP_CATEGORY, [copy]);
  await Notifications.setNotificationCategoryAsync(URL_CLIP_CATEGORY, [copy, open]);
}

/** Shows "Link from Office Laptop" with Copy (and Open for links). The engine skips it when notifications are off. */
export class ExpoNotifier implements NotifierPort {
  clipReceived(clip: Clip, from: DeviceRecord | undefined): void {
    const { title, body } = describeClip(clip, from);
    void Notifications.scheduleNotificationAsync({
      identifier: clip.id,
      content: {
        title,
        body,
        data: { clipId: clip.id },
        categoryIdentifier: clip.content.kind === 'url' ? URL_CLIP_CATEGORY : CLIP_CATEGORY,
      },
      trigger: Platform.OS === 'android' ? { channelId: CLIP_CHANNEL } : null,
    });
  }
}
