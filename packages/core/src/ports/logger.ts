export type LogContext = Readonly<Record<string, string | number | boolean | null>>;

/**
 * Structured logger. Callers must never pass clip contents or key material;
 * context values are limited to primitives to make that harder to do by accident.
 */
export interface LoggerPort {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
