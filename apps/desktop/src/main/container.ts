/**
 * Composition root of the main process: the only place that knows concrete
 * adapter classes and Electron modules (docs/PLAN.md §5.5).
 */

import { hostname } from 'node:os';
import { join } from 'node:path';

import { AppController, CredentialStore } from '@clipbridge/app';
import type { EnginePorts } from '@clipbridge/core';
import { app, clipboard, Notification, safeStorage, shell } from 'electron';
import { toString as renderQrCode } from 'qrcode';

import { BonjourDiscovery } from './adapters/bonjour-discovery';
import { ElectronClipboard } from './adapters/electron-clipboard';
import { DesktopNotifier, type NotificationContent } from './adapters/electron-notifier';
import { FileLogger } from './adapters/file-logger';
import { EncryptedFileStorage, JsonFileStorage } from './adapters/file-storage';
import { NodeNetworkInfo } from './adapters/node-network-info';
import { NodeRandom } from './adapters/node-random';
import { SystemClock } from './adapters/system-clock';
import { WsTransport } from './adapters/ws-transport';
import { toDesktopPlatform } from './app-info';

export interface Container {
  readonly controller: AppController;
  readonly logger: FileLogger;
  readonly discovery: BonjourDiscovery;
  readonly networkInfo: NodeNetworkInfo;
}

export interface ContainerOptions {
  readonly devMode: boolean;
  /** Brings the main window to the front (a device wants to join). */
  readonly showWindow: () => void;
  /** Suffix for running several instances on one machine (development). */
  readonly profile: string | null;
}

function showNotification(content: NotificationContent): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: content.title, body: content.body, silent: true });
  const url = content.openUrl;
  if (url && /^https?:\/\//i.test(url)) {
    notification.on('click', () => {
      void shell.openExternal(url);
    });
  }
  notification.show();
}

export function createContainer(options: ContainerOptions): Container {
  const userData = app.getPath('userData');
  const logFile = join(userData, 'logs', 'main.log');
  const logger = new FileLogger({
    filePath: logFile,
    minLevel: options.devMode ? 'debug' : 'info',
    maxBytes: 1024 * 1024,
    keepFiles: 3,
    mirrorToConsole: options.devMode,
  });

  const random = new NodeRandom();
  const networkInfo = new NodeNetworkInfo();
  const discovery = new BonjourDiscovery(logger);
  const ports: EnginePorts = {
    clock: new SystemClock(),
    random,
    logger,
    transport: new WsTransport(),
    discovery,
    networkInfo,
    clipboard: new ElectronClipboard(clipboard),
    notifier: new DesktopNotifier(showNotification),
  };

  const storage = new JsonFileStorage(join(userData, 'data'));
  const secureStorage = new EncryptedFileStorage(join(userData, 'secure'), safeStorage);
  const baseName =
    hostname()
      .replace(/\.local$/i, '')
      .slice(0, 48) || 'Computer';

  const controller = new AppController({
    ports,
    credentials: new CredentialStore(storage, secureStorage, random),
    storage,
    logger,
    platform: toDesktopPlatform(process.platform),
    defaultDeviceName: options.profile ? `${baseName} (${options.profile})` : baseName,
    appVersion: app.getVersion(),
    logFile,
    renderQr: (text) => renderQrCode(text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
    requestAttention: (message) => {
      options.showWindow();
      showNotification({ title: 'ClipBridge', body: message, openUrl: null });
    },
  });

  return { controller, logger, discovery, networkInfo };
}
