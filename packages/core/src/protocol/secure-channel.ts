import { aeadDecrypt, aeadEncrypt } from '../crypto/primitives';
import { type AppError, appError } from '../domain/errors';
import { err, type Result } from '../domain/result';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import { utf8Decode, utf8Encode } from '../lib/utf8';
import type { RandomPort } from '../ports/random';
import { decodeBody, encodeBody } from './codec';
import type { Body, SecureFrame } from './frames';
import type { SessionKeys } from './handshake';
import { PROTOCOL_VERSION } from './version';

/**
 * Encrypts bodies into `SEC` frames after the handshake. The sequence number is
 * authenticated (associated data) and must strictly increase, so recorded
 * frames cannot be replayed or reordered.
 */
export class SecureChannel {
  private nextSendSeq = 0;
  private lastReceivedSeq = -1;

  constructor(
    private readonly keys: SessionKeys,
    private readonly random: RandomPort,
  ) {}

  seal(body: Body): SecureFrame {
    const seq = this.nextSendSeq++;
    const sealed = aeadEncrypt(
      this.keys.sendKey,
      utf8Encode(encodeBody(body)),
      associatedData(seq),
      this.random,
    );
    return {
      v: PROTOCOL_VERSION,
      t: 'SEC',
      s: seq,
      n: bytesToBase64(sealed.nonce),
      c: bytesToBase64(sealed.ciphertext),
    };
  }

  open(frame: SecureFrame): Result<Body, AppError<'PROTOCOL_ERROR'>> {
    if (frame.s <= this.lastReceivedSeq) return err(protocolError('replayed or reordered frame'));
    const nonce = base64ToBytes(frame.n);
    const ciphertext = base64ToBytes(frame.c);
    if (!nonce || !ciphertext) return err(protocolError('invalid base64 in secure frame'));

    const plaintext = aeadDecrypt(
      this.keys.receiveKey,
      { nonce, ciphertext },
      associatedData(frame.s),
    );
    if (!plaintext) return err(protocolError('secure frame failed authentication'));

    this.lastReceivedSeq = frame.s;
    return decodeBody(utf8Decode(plaintext));
  }
}

function associatedData(seq: number): Uint8Array {
  return utf8Encode(`clipbridge/sec/v${PROTOCOL_VERSION}|${seq}`);
}

function protocolError(reason: string): AppError<'PROTOCOL_ERROR'> {
  return appError('PROTOCOL_ERROR', reason, { reason });
}
