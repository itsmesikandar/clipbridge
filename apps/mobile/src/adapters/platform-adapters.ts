/** Small adapters for core ports backed by Expo modules. */

import {
  type AppError,
  appError,
  base64ToBytes,
  bytesToBase64,
  type Cancel,
  type ClipboardPort,
  type ClipContent,
  type ClockPort,
  err,
  type LogContext,
  type LoggerPort,
  ok,
  type RandomPort,
  type Result,
  type SecureStoragePort,
  type StoragePort,
} from '@clipbridge/core';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

export class SystemClock implements ClockPort {
  now(): number {
    return Date.now();
  }

  schedule(delayMs: number, callback: () => void): Cancel {
    const timer = setTimeout(callback, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }
}

/** Cryptographically secure bytes from the OS (expo-crypto). */
export class ExpoRandom implements RandomPort {
  randomBytes(length: number): Uint8Array {
    return Crypto.getRandomBytes(length);
  }
}

/**
 * Phones can write the clipboard but cannot read it in the background, so
 * there is no `watch`; the user sends explicitly (share sheet, "Send clipboard").
 */
export class ExpoClipboard implements ClipboardPort {
  async write(content: ClipContent): Promise<Result<void, AppError>> {
    try {
      if (content.kind === 'image') {
        return err(
          appError('CLIPBOARD_ACCESS_FAILED', 'images arrive in M6', { operation: 'write' }),
        );
      }
      await Clipboard.setStringAsync(content.kind === 'text' ? content.text : content.url);
      return ok(undefined);
    } catch (error) {
      return err(
        appError(
          'CLIPBOARD_ACCESS_FAILED',
          error instanceof Error ? error.message : String(error),
          {
            operation: 'write',
          },
        ),
      );
    }
  }
}

/** Reads the clipboard; only call it after a user action while the app is open. */
export async function readClipboardText(): Promise<string> {
  return Clipboard.getStringAsync();
}

const STORAGE_PREFIX = 'clipbridge:';

export class AsyncJsonStorage implements StoragePort {
  async get(key: string): Promise<unknown> {
    const value = await AsyncStorage.getItem(STORAGE_PREFIX + key);
    return value === null ? undefined : (JSON.parse(value) as unknown);
  }

  async set(key: string, value: unknown): Promise<void> {
    await AsyncStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_PREFIX + key);
  }
}

/** Secrets in the Android Keystore / iOS Keychain (expo-secure-store). */
export class ExpoSecureStorage implements SecureStoragePort {
  async get(key: string): Promise<Uint8Array | null> {
    const value = await SecureStore.getItemAsync(key);
    return value === null ? null : base64ToBytes(value);
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    await SecureStore.setItemAsync(key, bytesToBase64(value));
  }

  async delete(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  }
}

export interface LogLine {
  readonly at: number;
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly text: string;
}

/** Console logger that also keeps the last lines for the diagnostics screen. */
export class RingBufferLogger implements LoggerPort {
  private readonly lines: LogLine[] = [];

  constructor(private readonly capacity = 200) {}

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }
  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }
  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  recent(): readonly LogLine[] {
    return this.lines;
  }

  private write(level: LogLine['level'], message: string, context: LogContext | undefined): void {
    const text = context ? `${message} ${JSON.stringify(context)}` : message;
    this.lines.push({ at: Date.now(), level, text });
    if (this.lines.length > this.capacity) this.lines.shift();
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'log' : level](`[clipbridge] ${text}`);
    }
  }
}
