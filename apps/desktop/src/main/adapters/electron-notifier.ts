import type { Clip, DeviceRecord, NotifierPort } from '@clipbridge/core';

export interface NotificationContent {
  readonly title: string;
  readonly body: string;
  /** http(s) URL to open when the notification is clicked. */
  readonly openUrl: string | null;
}

const PREVIEW_LENGTH = 120;

/** Builds the text of a "clip received" notification. Pure, so it is unit-tested. */
export function describeReceivedClip(
  clip: Clip,
  from: DeviceRecord | undefined,
): NotificationContent {
  const sender = from?.name ?? 'another device';
  switch (clip.content.kind) {
    case 'url':
      return {
        title: `Link from ${sender}`,
        body: clip.content.url.slice(0, PREVIEW_LENGTH),
        openUrl: clip.content.url,
      };
    case 'text': {
      const oneLine = clip.content.text.replace(/\s+/g, ' ').trim();
      const body =
        oneLine.length > PREVIEW_LENGTH ? `${oneLine.slice(0, PREVIEW_LENGTH - 1)}…` : oneLine;
      return { title: `Text from ${sender}`, body, openUrl: null };
    }
    case 'image':
      return { title: `Image from ${sender}`, body: 'Copied to your clipboard', openUrl: null };
  }
}

export type ShowNotification = (content: NotificationContent) => void;

/** Shows a desktop notification; the platform call is injected by the composition root. */
export class DesktopNotifier implements NotifierPort {
  constructor(private readonly show: ShowNotification) {}

  clipReceived(clip: Clip, from: DeviceRecord | undefined): void {
    this.show(describeReceivedClip(clip, from));
  }
}
