import type { AppController } from '@clipbridge/app';
import { ipcMain } from 'electron';

import { type ActionResult, IPC_CHANNELS } from '../../shared/ipc-contract';
import { deviceIdSchema, deviceNameSchema, joinRequestSchema } from '../../shared/ipc-schemas';

const invalid: ActionResult<never> = { ok: false, message: 'Invalid input.' };

/** Group setup, "Add device", joining, and device management. */
export function registerPairingHandlers(controller: AppController): void {
  ipcMain.handle(IPC_CHANNELS.createGroup, () => controller.createGroup());
  ipcMain.handle(IPC_CHANNELS.startHosting, () => controller.startHosting());
  ipcMain.handle(IPC_CHANNELS.stopHosting, () => {
    controller.stopHosting();
  });
  ipcMain.handle(IPC_CHANNELS.approveJoin, () => {
    controller.approveJoin();
  });
  ipcMain.handle(IPC_CHANNELS.denyJoin, () => {
    controller.denyJoin();
  });
  ipcMain.handle(IPC_CHANNELS.startJoinSearch, () => controller.startJoinSearch());
  ipcMain.handle(IPC_CHANNELS.stopJoinSearch, () => {
    controller.stopJoinSearch();
  });
  ipcMain.handle(IPC_CHANNELS.join, (_event, input: unknown) => {
    const request = joinRequestSchema.safeParse(input);
    return request.success ? controller.join(request.data) : invalid;
  });
  ipcMain.handle(IPC_CHANNELS.cancelJoin, () => {
    controller.cancelJoin();
  });

  ipcMain.handle(IPC_CHANNELS.renameDevice, (_event, id: unknown, name: unknown) => {
    const parsedId = deviceIdSchema.safeParse(id);
    const parsedName = deviceNameSchema.safeParse(name);
    return parsedId.success && parsedName.success
      ? controller.renameDevice(parsedId.data, parsedName.data)
      : invalid;
  });
  ipcMain.handle(IPC_CHANNELS.removeDevice, (_event, id: unknown) => {
    const parsedId = deviceIdSchema.safeParse(id);
    return parsedId.success ? controller.removeDevice(parsedId.data) : invalid;
  });
  ipcMain.handle(IPC_CHANNELS.resetThisDevice, () => controller.resetThisDevice());
}
