import { type ClipContent, contentFingerprintBytes } from '../domain/clip';
import { bytesToHex } from '../lib/bytes';
import { sha256 } from './primitives';

/** SHA-256 (hex) of a clip's kind and payload. Equal content gives an equal hash on every device. */
export function computeContentHash(content: ClipContent): string {
  return bytesToHex(sha256(contentFingerprintBytes(content)));
}
