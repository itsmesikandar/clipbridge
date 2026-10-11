import { ipcMain } from 'electron';

import { IPC_CHANNELS, type IpcResult } from '../../shared/ipc-contract';
import { pairingTextSchema } from '../../shared/ipc-schemas';
import type { AppController } from '../app-controller';

const invalidText: IpcResult<never> = { ok: false, message: 'Paste the text you received.' };

/** Development-only pairing (Milestone 2); the controller refuses calls outside dev mode. */
export function registerDevHandlers(controller: AppController): void {
  ipcMain.handle(IPC_CHANNELS.devCreateGroup, () => controller.dev.createGroup());
  ipcMain.handle(IPC_CHANNELS.devExportInvite, () => controller.dev.exportInvite());
  ipcMain.handle(IPC_CHANNELS.devImportInvite, (_event, input: unknown) => {
    const text = pairingTextSchema.safeParse(input);
    return text.success ? controller.dev.importInvite(text.data) : invalidText;
  });
  ipcMain.handle(IPC_CHANNELS.devImportReply, (_event, input: unknown) => {
    const text = pairingTextSchema.safeParse(input);
    return text.success ? controller.dev.importReply(text.data) : invalidText;
  });
  ipcMain.handle(IPC_CHANNELS.devLeaveGroup, () => controller.dev.leaveGroup());
}
