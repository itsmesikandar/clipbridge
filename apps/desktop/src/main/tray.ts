import { Menu, nativeImage, Tray } from 'electron';

import trayIconPath from '../../resources/tray-icon.png?asset';

export interface TrayActions {
  readonly onOpen: () => void;
  readonly onQuit: () => void;
}

/** Creates the system tray icon. The app keeps running in the tray when the window is closed. */
export function createTray(actions: TrayActions): Tray {
  const tray = new Tray(nativeImage.createFromPath(trayIconPath));
  tray.setToolTip('ClipBridge');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open ClipBridge', click: actions.onOpen },
      { type: 'separator' },
      { label: 'Quit', click: actions.onQuit },
    ]),
  );
  tray.on('click', actions.onOpen);
  return tray;
}
