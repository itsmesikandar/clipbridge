import type { ClipBridgeApi } from '../../shared/ipc-contract';

declare global {
  interface Window {
    /** Typed API exposed by the preload script. */
    readonly clipbridge: ClipBridgeApi;
  }
}
