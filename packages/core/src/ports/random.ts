/** Cryptographically secure random source. */
export interface RandomPort {
  randomBytes(length: number): Uint8Array;
}
