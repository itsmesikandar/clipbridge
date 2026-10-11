import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';

/**
 * Creates the main window with the Electron security baseline from
 * docs/PLAN.md §5.5: isolated, sandboxed renderer without Node access that
 * cannot open new windows or navigate away from the app.
 */
export function createMainWindow(onRendererGone: (reason: string) => void): BrowserWindow {
  const window = new BrowserWindow({
    width: 440,
    height: 680,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'ClipBridge',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    onRendererGone(details.reason);
  });

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return window;
}
