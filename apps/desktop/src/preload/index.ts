import { contextBridge, ipcRenderer } from 'electron';

import { type AppInfo, type ClipBridgeApi, IPC_CHANNELS } from '../shared/ipc-contract';

/**
 * The only bridge between the sandboxed renderer and the main process.
 * Exposes a small typed API; never expose `ipcRenderer` itself.
 */
const api: ClipBridgeApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo) as Promise<AppInfo>,
};

contextBridge.exposeInMainWorld('clipbridge', api);
