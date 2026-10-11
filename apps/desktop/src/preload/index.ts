import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import { type AppSnapshot, type ClipBridgeApi, IPC_CHANNELS } from '../shared/ipc-contract';

/**
 * The only bridge between the sandboxed renderer and the main process.
 * Exposes a small typed API; never expose `ipcRenderer` itself.
 */
const api: ClipBridgeApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  getState: () => ipcRenderer.invoke(IPC_CHANNELS.getState),
  onStateChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, snapshot: AppSnapshot): void => {
      listener(snapshot);
    };
    ipcRenderer.on(IPC_CHANNELS.stateChanged, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.stateChanged, handler);
    };
  },
  updateSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch),
  copyHistoryItem: (id) => ipcRenderer.invoke(IPC_CHANNELS.copyHistoryItem, id),
  clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.clearHistory),
  getDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.getDiagnostics),
  pairing: {
    createGroup: () => ipcRenderer.invoke(IPC_CHANNELS.createGroup),
    startHosting: () => ipcRenderer.invoke(IPC_CHANNELS.startHosting),
    stopHosting: () => ipcRenderer.invoke(IPC_CHANNELS.stopHosting),
    approveJoin: () => ipcRenderer.invoke(IPC_CHANNELS.approveJoin),
    denyJoin: () => ipcRenderer.invoke(IPC_CHANNELS.denyJoin),
    startJoinSearch: () => ipcRenderer.invoke(IPC_CHANNELS.startJoinSearch),
    stopJoinSearch: () => ipcRenderer.invoke(IPC_CHANNELS.stopJoinSearch),
    join: (input) => ipcRenderer.invoke(IPC_CHANNELS.join, input),
    cancelJoin: () => ipcRenderer.invoke(IPC_CHANNELS.cancelJoin),
  },
  devices: {
    rename: (id, name) => ipcRenderer.invoke(IPC_CHANNELS.renameDevice, id, name),
    remove: (id) => ipcRenderer.invoke(IPC_CHANNELS.removeDevice, id),
    resetThisDevice: () => ipcRenderer.invoke(IPC_CHANNELS.resetThisDevice),
  },
};

contextBridge.exposeInMainWorld('clipbridge', api);
