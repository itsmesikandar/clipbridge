import { type AppError, appError } from '../domain/errors';
import { err, ok, type Result } from '../domain/result';
import { type Body, bodySchema, type PlainFrame, plainFrameSchema } from './frames';
import { MAX_FRAME_CHARS, PROTOCOL_VERSION } from './version';

export type DecodeError = AppError<'PROTOCOL_ERROR' | 'VERSION_MISMATCH'>;

export function encodeFrame(frame: PlainFrame): string {
  return JSON.stringify(frame);
}

/**
 * Parses one raw frame. The version is checked before the schema so that a
 * newer peer gets a clear VERSION_MISMATCH instead of a generic protocol error.
 */
export function decodeFrame(raw: string): Result<PlainFrame, DecodeError> {
  if (raw.length > MAX_FRAME_CHARS) return err(protocolError('frame too large'));

  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return err(protocolError('frame is not an object'));
  }

  const remoteVersion = (value as { v?: unknown }).v;
  if (remoteVersion !== PROTOCOL_VERSION) {
    return err(
      appError('VERSION_MISMATCH', `peer protocol version ${String(remoteVersion)}`, {
        peerId: null,
        localVersion: PROTOCOL_VERSION,
        remoteVersion: typeof remoteVersion === 'number' ? remoteVersion : null,
      }),
    );
  }

  const result = plainFrameSchema.safeParse(value);
  if (!result.success) return err(protocolError(`invalid frame: ${summarize(result.error)}`));
  return ok(result.data);
}

export function encodeBody(body: Body): string {
  return JSON.stringify(body);
}

export function decodeBody(raw: string): Result<Body, AppError<'PROTOCOL_ERROR'>> {
  const parsed = parseJson(raw);
  if (!parsed.ok) return parsed;
  const result = bodySchema.safeParse(parsed.value);
  if (!result.success) return err(protocolError(`invalid body: ${summarize(result.error)}`));
  return ok(result.data);
}

function parseJson(raw: string): Result<unknown, AppError<'PROTOCOL_ERROR'>> {
  try {
    return ok(JSON.parse(raw) as unknown);
  } catch {
    return err(protocolError('frame is not valid JSON'));
  }
}

function protocolError(reason: string): AppError<'PROTOCOL_ERROR'> {
  return appError('PROTOCOL_ERROR', reason, { reason });
}

function summarize(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): string {
  const first = error.issues[0];
  if (!first) return 'unknown';
  const path = first.path.map(String).join('.') || '(root)';
  return `${path}: ${first.message}`;
}
