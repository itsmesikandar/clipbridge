import type { Clip } from '../domain/clip';
import type { DeviceRecord } from '../domain/device';

export interface NotifierPort {
  /** Tells the user a clip arrived (toast on desktop, notification with Copy/Open on phones). */
  clipReceived(clip: Clip, from: DeviceRecord | undefined): void;
}
