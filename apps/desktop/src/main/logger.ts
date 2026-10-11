/**
 * Minimal console logger for the main process.
 *
 * Replaced by the file-based LoggerPort adapter in Milestone 2; kept as the
 * only place in main that touches the console.
 */
/* eslint-disable no-console */
export const logger = {
  info: (message: string, ...details: unknown[]): void => {
    console.info(`[main] ${message}`, ...details);
  },
  warn: (message: string, ...details: unknown[]): void => {
    console.warn(`[main] ${message}`, ...details);
  },
  error: (message: string, ...details: unknown[]): void => {
    console.error(`[main] ${message}`, ...details);
  },
};
