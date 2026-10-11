import type { AppError } from '../domain/errors';
import type { Result } from '../domain/result';

export type Unsubscribe = () => void;

export interface PeerAddress {
  readonly host: string;
  readonly port: number;
}

export interface TransportCloseInfo {
  /** True when this side called `close()`. */
  readonly local: boolean;
  readonly reason: string;
}

/** One bidirectional, message-framed connection (a WebSocket in production). */
export interface TransportConnection {
  readonly remoteAddress: string;
  /** Sends one text frame. Ignored after the connection closed. */
  send(data: string): void;
  close(reason: string): void;
  onMessage(listener: (data: string) => void): Unsubscribe;
  /** Called exactly once. Registering after close calls the listener immediately. */
  onClose(listener: (info: TransportCloseInfo) => void): Unsubscribe;
}

export interface Listener {
  readonly port: number;
  close(): Promise<void>;
}

export interface TransportPort {
  /**
   * Opens a connection. Failures are mapped to `PEER_UNREACHABLE`
   * (cause: refused / timeout / unreachable).
   */
  dial(address: PeerAddress, timeoutMs: number): Promise<Result<TransportConnection, AppError>>;
  /**
   * Accepts incoming connections (hubs only). Implementations try `preferredPort`
   * first and fall back to a free port; `PORT_IN_USE` if none can be opened.
   */
  listen?(
    preferredPort: number,
    onConnection: (connection: TransportConnection) => void,
  ): Promise<Result<Listener, AppError>>;
}
