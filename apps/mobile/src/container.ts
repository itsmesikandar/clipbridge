/**
 * Composition root of the mobile app: the only place that knows concrete
 * adapters (docs/PLAN.md §5.6). Created once per JS runtime.
 */

import { AppController, CredentialStore } from '@clipbridge/app';
import type { DevicePlatform, EnginePorts } from '@clipbridge/core';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import { ExpoNetworkInfo } from './adapters/expo-network-info';
import { ExpoNotifier } from './adapters/expo-notifier';
import {
  AsyncJsonStorage,
  ExpoClipboard,
  ExpoRandom,
  ExpoSecureStorage,
  RingBufferLogger,
  SystemClock,
} from './adapters/platform-adapters';
import { RnWebSocketTransport } from './adapters/rn-websocket-transport';
import { ZeroconfDiscovery } from './adapters/zeroconf-discovery';
import { MobilePreferences } from './state/mobile-preferences';

export interface MobileContainer {
  readonly controller: AppController;
  readonly logger: RingBufferLogger;
  readonly clipboard: ExpoClipboard;
  readonly preferences: MobilePreferences;
}

let instance: MobileContainer | null = null;

/** Returns the app's single container (kept across Fast Refresh in development). */
export function getContainer(): MobileContainer {
  instance ??= createContainer();
  return instance;
}

function createContainer(): MobileContainer {
  const logger = new RingBufferLogger();
  const random = new ExpoRandom();
  const discovery = new ZeroconfDiscovery(logger);
  const networkInfo = new ExpoNetworkInfo(() => discovery.localNetworkPermission());
  const clipboard = new ExpoClipboard();
  const ports: EnginePorts = {
    clock: new SystemClock(),
    random,
    logger,
    transport: new RnWebSocketTransport(),
    discovery,
    networkInfo,
    clipboard,
    notifier: new ExpoNotifier(),
  };
  networkInfo.onChange(() => {
    discovery.restart();
  });

  const storage = new AsyncJsonStorage();
  const platform: DevicePlatform = Platform.OS === 'ios' ? 'ios' : 'android';
  const controller = new AppController({
    ports,
    credentials: new CredentialStore(storage, new ExpoSecureStorage(), random),
    storage,
    logger,
    platform,
    defaultDeviceName: (Device.deviceName ?? Device.modelName ?? 'Phone').slice(0, 64),
    appVersion: '0.1.0',
    logFile: 'In-app log (Diagnostics)',
    // Phones never show a pairing QR code.
    renderQr: () => Promise.resolve(''),
  });

  return { controller, logger, clipboard, preferences: new MobilePreferences(storage) };
}
