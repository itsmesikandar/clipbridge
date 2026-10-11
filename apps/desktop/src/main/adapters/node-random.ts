import { randomBytes } from 'node:crypto';

import type { RandomPort } from '@clipbridge/core';

export class NodeRandom implements RandomPort {
  randomBytes(length: number): Uint8Array {
    return new Uint8Array(randomBytes(length));
  }
}
