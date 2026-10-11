import type { RandomPort } from '../ports/random';

/**
 * Deterministic random bytes (SplitMix64-style) for reproducible tests.
 * NOT cryptographically secure — never use outside tests.
 */
export class SeededRandom implements RandomPort {
  private state: bigint;

  constructor(seed = 1) {
    this.state = BigInt(seed) & 0xffff_ffff_ffff_ffffn;
  }

  randomBytes(length: number): Uint8Array {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i += 8) {
      let z = (this.state = (this.state + 0x9e37_79b9_7f4a_7c15n) & 0xffff_ffff_ffff_ffffn);
      z = ((z ^ (z >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & 0xffff_ffff_ffff_ffffn;
      z = ((z ^ (z >> 27n)) * 0x94d0_49bb_1331_11ebn) & 0xffff_ffff_ffff_ffffn;
      z ^= z >> 31n;
      for (let j = 0; j < 8 && i + j < length; j++)
        out[i + j] = Number((z >> BigInt(j * 8)) & 0xffn);
    }
    return out;
  }
}
