/**
 * App-wide side effects that are not tied to one screen:
 * notification setup and actions, the Android background service, and
 * clips shared to ClipBridge from other apps.
 */

import { type AppSnapshot, createSimpleStore } from '@clipbridge/app';
import { toBannerModel } from '@clipbridge/app/presentation';
import { classifyText } from '@clipbridge/core';
import * as Notifications from 'expo-notifications';
import { useShareIntentContext } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { Linking } from 'react-native';

import { SyncService } from '../../../modules/sync-service';
import { ACTION_COPY, ACTION_OPEN, setUpNotifications } from '../../adapters/expo-notifier';
import type { MobileContainer } from '../../container';
import { useAppSnapshot, useContainer, useStore } from '../../state/app-context';

export interface ShareOutcome {
  readonly ok: boolean;
  readonly message: string;
}

/** Runs all system effects; returns the result of the last share, if any. */
export function useSystemEffects(): ShareOutcome | null {
  const container = useContainer();
  const snapshot = useAppSnapshot();
  useNotifications(container, snapshot.pairing.paired);
  useBackgroundService(container, snapshot);
  return useIncomingShares(container);
}

function useNotifications(container: MobileContainer, paired: boolean): void {
  useEffect(() => {
    void setUpNotifications();
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleNotificationAction(container, response);
    });
    // The app may have been started by tapping an action.
    const launchResponse = Notifications.getLastNotificationResponse();
    if (launchResponse) void handleNotificationAction(container, launchResponse);
    return () => {
      subscription.remove();
    };
  }, [container]);

  useEffect(() => {
    if (paired) void Notifications.requestPermissionsAsync();
  }, [paired]);
}

async function handleNotificationAction(
  container: MobileContainer,
  response: Notifications.NotificationResponse,
): Promise<void> {
  const clipId = (response.notification.request.content.data as { clipId?: unknown }).clipId;
  if (typeof clipId !== 'string') return;
  const content = container.controller.clipContent(clipId);
  if (!content) return;
  if (response.actionIdentifier === ACTION_COPY) {
    const written = await container.clipboard.write(content);
    if (written.ok)
      await Notifications.dismissNotificationAsync(response.notification.request.identifier);
  } else if (response.actionIdentifier === ACTION_OPEN && content.kind === 'url') {
    await Linking.openURL(content.url);
  }
  Notifications.clearLastNotificationResponse();
}

/** Keeps the Android foreground service in step with pairing, status and the setting. */
function useBackgroundService(container: MobileContainer, snapshot: AppSnapshot): void {
  const prefs = useStore(container.preferences.prefs);
  const removed = snapshot.status.issue?.code === 'REMOVED_FROM_GROUP';
  const shouldRun = snapshot.pairing.paired && prefs.backgroundSync && !removed;
  const banner = toBannerModel(snapshot.status);

  useEffect(() => {
    if (shouldRun) SyncService.start('ClipBridge', banner.title);
    else SyncService.stop();
    // Only start/stop here; text updates below.
  }, [shouldRun]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (shouldRun) SyncService.update('ClipBridge', banner.title);
  }, [shouldRun, banner.title]);
}

/** Last share result, kept outside React so the effect only updates an external store. */
const shareOutcomeStore = createSimpleStore<ShareOutcome | null>(null);

/** Sends text and links shared to ClipBridge from other apps (share sheet). */
function useIncomingShares(container: MobileContainer): ShareOutcome | null {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!hasShareIntent) return;
    const raw = (shareIntent.webUrl ?? shareIntent.text ?? '').trim();
    const key = `${raw}|${shareIntent.meta?.title ?? ''}`;
    if (handled.current === key) return;
    handled.current = key;
    resetShareIntent();
    shareOutcomeStore.set(sendShared(container, raw));
  }, [hasShareIntent, shareIntent, resetShareIntent, container]);

  return useStore(shareOutcomeStore);
}

export function sendShared(
  container: Pick<MobileContainer, 'controller'>,
  raw: string,
): ShareOutcome {
  if (raw === '') return { ok: false, message: 'Only text and links can be sent for now.' };
  const sent = container.controller.sendClip(classifyText(raw));
  if (!sent.ok) return { ok: false, message: sent.message };
  const connected = container.controller.snapshot.get().status.connectedCount;
  return {
    ok: true,
    message:
      connected > 0
        ? `Sent to ${connected} computer${connected === 1 ? '' : 's'}.`
        : 'Saved. It will be sent when a computer is online.',
  };
}
