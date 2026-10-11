import { type BrowserWindow, ipcMain } from 'electron';

import { type AppSnapshot, IPC_CHANNELS, type IpcResult } from '../../shared/ipc-contract';
import { historyItemIdSchema, parseSettingsPatch } from '../../shared/ipc-schemas';
import type { AppController } from '../app-controller';

/** Coalesces bursts of state changes (e.g. 4 peers connecting) into one push. */
const PUSH_DELAY_MS = 50;

export function registerStateHandlers(
  controller: AppController,
  windows: () => readonly BrowserWindow[],
): () => void {
  ipcMain.handle(IPC_CHANNELS.getState, (): AppSnapshot => controller.snapshot.get());

  ipcMain.handle(IPC_CHANNELS.updateSettings, async (_event, input: unknown): Promise<void> => {
    const patch = parseSettingsPatch(input);
    if (!patch) throw new Error('Invalid settings');
    await controller.updateSettings(patch);
  });

  ipcMain.handle(
    IPC_CHANNELS.copyHistoryItem,
    (_event, input: unknown): Promise<IpcResult<void>> => {
      const id = historyItemIdSchema.safeParse(input);
      if (!id.success) return Promise.resolve({ ok: false, message: 'Invalid item.' });
      return controller.copyHistoryItem(id.data);
    },
  );

  ipcMain.handle(IPC_CHANNELS.clearHistory, (): void => {
    controller.clearHistory();
  });

  ipcMain.handle(IPC_CHANNELS.getDiagnostics, () => controller.diagnostics());

  let pending: NodeJS.Timeout | null = null;
  const unsubscribe = controller.snapshot.subscribe(() => {
    pending ??= setTimeout(() => {
      pending = null;
      const snapshot = controller.snapshot.get();
      for (const window of windows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.stateChanged, snapshot);
      }
    }, PUSH_DELAY_MS);
  });

  return () => {
    unsubscribe();
    if (pending) clearTimeout(pending);
  };
}
