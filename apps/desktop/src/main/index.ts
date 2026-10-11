import { join } from 'node:path';

import { app, BrowserWindow, powerMonitor, type Tray } from 'electron';

import { type Container, createContainer } from './container';
import { registerAppInfoHandlers } from './ipc/register-app-info-handlers';
import { registerPairingHandlers } from './ipc/register-pairing-handlers';
import { registerStateHandlers } from './ipc/register-state-handlers';
import { createTray } from './tray';
import { createMainWindow } from './window';

interface MainState {
  window: BrowserWindow | null;
  /** Held for the app lifetime so the tray icon is not garbage-collected. */
  tray: Tray | null;
  container: Container | null;
  isQuitting: boolean;
}

const state: MainState = { window: null, tray: null, container: null, isQuitting: false };

/** Re-announce on the LAN shortly after the network settles. */
const DISCOVERY_RESTART_DELAY_MS = 1_500;

const devMode = !app.isPackaged || process.env.CLIPBRIDGE_DEV === '1';
const profile = devMode ? sanitizeProfile(process.env.CLIPBRIDGE_PROFILE) : null;

function sanitizeProfile(value: string | undefined): string | null {
  const cleaned = value?.replace(/[^a-z0-9-]/gi, '').slice(0, 16) ?? '';
  return cleaned.length > 0 ? cleaned : null;
}

function showMainWindow(): void {
  const existing = state.window;
  if (!existing || existing.isDestroyed()) {
    const window = createMainWindow((reason) => {
      state.container?.logger.error('renderer process gone', { reason });
    });
    // Closing the window hides it; ClipBridge keeps syncing from the tray.
    window.on('close', (event) => {
      if (!state.isQuitting) {
        event.preventDefault();
        window.hide();
      }
    });
    state.window = window;
    return;
  }
  if (existing.isMinimized()) existing.restore();
  existing.show();
  existing.focus();
}

function quit(): void {
  state.isQuitting = true;
  app.quit();
}

function watchNetwork(container: Container): void {
  let restartTimer: NodeJS.Timeout | null = null;
  const restartDiscovery = (): void => {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
      void container.discovery.restart();
    }, DISCOVERY_RESTART_DELAY_MS);
  };
  container.networkInfo.onChange((snapshot) => {
    container.logger.info('network changed', { kind: snapshot.kind, subnet: snapshot.subnet });
    restartDiscovery();
  });
  powerMonitor.on('resume', () => {
    container.logger.info('system resumed');
    container.networkInfo.refresh();
    restartDiscovery();
    // Connections from before sleep are probably dead; reconnect now instead of waiting for heartbeats.
    void container.controller.resume();
  });
}

async function start(): Promise<void> {
  const container = createContainer({ devMode, profile, showWindow: showMainWindow });
  state.container = container;

  registerAppInfoHandlers();
  registerStateHandlers(container.controller, () => BrowserWindow.getAllWindows());
  registerPairingHandlers(container.controller);

  await container.controller.init();
  watchNetwork(container);

  state.tray = createTray({ onOpen: showMainWindow, onQuit: quit });
  showMainWindow();
  container.logger.info(`ClipBridge ${app.getVersion()} started`, { devMode, profile });
}

function bootstrap(): void {
  if (profile) {
    // Separate data (and single-instance lock) per profile, for testing on one machine.
    app.setPath('userData', join(app.getPath('appData'), `ClipBridge-${profile}`));
  }
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.setAppUserModelId('com.clipbridge.app');

  app.on('second-instance', showMainWindow);
  app.on('activate', showMainWindow);
  app.on('before-quit', (event) => {
    const container = state.container;
    if (!container) return;
    // Shut down once: close peer connections and unpublish mDNS, then quit.
    state.container = null;
    state.isQuitting = true;
    event.preventDefault();
    void Promise.allSettled([
      container.controller.shutdown(),
      container.discovery.destroy(),
    ]).finally(() => {
      app.quit();
    });
  });
  // Stay alive in the tray when all windows are closed (all platforms).
  app.on('window-all-closed', () => undefined);

  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      state.container?.logger.error('failed to start', {
        error: error instanceof Error ? error.message : String(error),
      });
      app.exit(1);
    });
}

bootstrap();
