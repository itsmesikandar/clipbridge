import { app, ipcMain } from 'electron';

import { type AppInfo, IPC_CHANNELS } from '../../shared/ipc-contract';
import { buildAppInfo } from '../app-info';

export function registerAppInfoHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, (): AppInfo =>
    buildAppInfo(app.getVersion(), process.platform),
  );
}
