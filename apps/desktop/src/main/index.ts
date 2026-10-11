import { app, type BrowserWindow, type Tray } from 'electron';

import { registerAppInfoHandlers } from './ipc/register-app-info-handlers';
import { logger } from './logger';
import { createTray } from './tray';
import { createMainWindow } from './window';

interface MainState {
  window: BrowserWindow | null;
  /** Held for the app lifetime so the tray icon is not garbage-collected. */
  tray: Tray | null;
  isQuitting: boolean;
}

const state: MainState = { window: null, tray: null, isQuitting: false };

function showMainWindow(): void {
  const existing = state.window;
  if (!existing || existing.isDestroyed()) {
    const window = createMainWindow();
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

function bootstrap(): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  app.on('second-instance', showMainWindow);
  app.on('activate', showMainWindow);
  app.on('before-quit', () => {
    state.isQuitting = true;
  });
  // Stay alive in the tray when all windows are closed (all platforms).
  app.on('window-all-closed', () => undefined);

  app
    .whenReady()
    .then(() => {
      registerAppInfoHandlers();
      state.tray = createTray({ onOpen: showMainWindow, onQuit: quit });
      showMainWindow();
      logger.info(`ClipBridge ${app.getVersion()} started`);
    })
    .catch((error: unknown) => {
      logger.error('Failed to start', error);
      app.exit(1);
    });
}

bootstrap();
