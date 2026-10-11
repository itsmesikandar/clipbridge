import { requireOptionalNativeModule } from 'expo-modules-core';

export interface LanInterface {
  readonly name: string;
  readonly address: string;
  readonly prefix: number;
}

interface SyncServiceNativeModule {
  lanInterfaces(): LanInterface[];
  start(title: string, text: string): void;
  update(title: string, text: string): void;
  stop(): void;
  isRunning(): boolean;
  isIgnoringBatteryOptimizations(): boolean;
  openBatterySettings(): void;
}

/** Null where the native module does not exist (iOS, Jest). */
const native = requireOptionalNativeModule<SyncServiceNativeModule>('SyncService');

/**
 * Android foreground service that keeps the sync engine running in the background.
 * Every call is a no-op where the native module is missing.
 */
export const SyncService = {
  start(title: string, text: string): void {
    native?.start(title, text);
  },
  update(title: string, text: string): void {
    native?.update(title, text);
  },
  stop(): void {
    native?.stop();
  },
  isRunning(): boolean {
    return native?.isRunning() ?? false;
  },
  isIgnoringBatteryOptimizations(): boolean {
    return native?.isIgnoringBatteryOptimizations() ?? true;
  },
  openBatterySettings(): void {
    native?.openBatterySettings();
  },
};

/** Active IPv4 interfaces including the phone's own hotspot; null where unavailable. */
export function getLanInterfaces(): readonly LanInterface[] | null {
  return native ? native.lanInterfaces() : null;
}
