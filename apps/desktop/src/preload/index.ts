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
  dev: {
    createGroup: () => ipcRenderer.invoke(IPC_CHANNELS.devCreateGroup),
    exportInvite: () => ipcRenderer.invoke(IPC_CHANNELS.devExportInvite),
    importInvite: (invite) => ipcRenderer.invoke(IPC_CHANNELS.devImportInvite, invite),
    importReply: (reply) => ipcRenderer.invoke(IPC_CHANNELS.devImportReply, reply),
    leaveGroup: () => ipcRenderer.invoke(IPC_CHANNELS.devLeaveGroup),
  },
};

contextBridge.exposeInMainWorld('clipbridge', api);
