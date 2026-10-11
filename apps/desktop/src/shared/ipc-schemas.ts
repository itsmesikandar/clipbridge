/**
 * Runtime validation of renderer → main IPC input. The renderer is treated as
 * untrusted: every payload is checked before it reaches the app controller.
 */

import { z } from 'zod';

import type { SettingsPatch } from './ipc-contract';

const settingsPatchSchema = z
  .object({
    sendEnabled: z.boolean(),
    receiveEnabled: z.boolean(),
    notifyOnReceive: z.boolean(),
  })
  .partial()
  .strict();

/** Returns a validated settings patch without undefined keys, or null. */
export function parseSettingsPatch(input: unknown): SettingsPatch | null {
  const parsed = settingsPatchSchema.safeParse(input);
  if (!parsed.success) return null;
  return Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => value !== undefined));
}

export const historyItemIdSchema = z.string().min(1).max(64);

export const pairingTextSchema = z
  .string()
  .min(1)
  .max(64 * 1024);
