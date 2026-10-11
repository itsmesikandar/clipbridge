import {
  type AppError,
  appError,
  err,
  ok,
  type PeerAddress,
  type PeerUnreachableCause,
  type Result,
  type TransportCloseInfo,
  type TransportConnection,
  type TransportPort,
  type Unsubscribe,
} from '@clipbridge/core';

/** Wraps React Native's built-in WebSocket as a core connection. */
class RnWebSocketConnection implements TransportConnection {
  private closeInfo: TransportCloseInfo | null = null;
  private closedLocally = false;
  private readonly messageListeners = new Set<(data: string) => void>();
  private readonly closeListeners = new Set<(info: TransportCloseInfo) => void>();

  constructor(
    private readonly socket: WebSocket,
    readonly remoteAddress: string,
  ) {
    socket.onmessage = (event: WebSocketMessageEvent) => {
      if (typeof event.data !== 'string') return; // protocol frames are text
      const data = event.data;
      for (const listener of [...this.messageListeners]) listener(data);
    };
    socket.onclose = (event: WebSocketCloseEvent) => {
      this.finish({ local: this.closedLocally, reason: event.reason ?? 'closed' });
    };
    socket.onerror = () => {
      // onclose follows.
    };
  }

  send(data: string): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(data);
  }

  close(reason: string): void {
    if (this.closeInfo) return;
    this.closedLocally = true;
    this.socket.close(1000, reason.slice(0, 120));
    this.finish({ local: true, reason });
  }

  onMessage(listener: (data: string) => void): Unsubscribe {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onClose(listener: (info: TransportCloseInfo) => void): Unsubscribe {
    if (this.closeInfo) {
      listener(this.closeInfo);
      return () => undefined;
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  private finish(info: TransportCloseInfo): void {
    if (this.closeInfo) return;
    this.closeInfo = info;
    this.messageListeners.clear();
    const listeners = [...this.closeListeners];
    this.closeListeners.clear();
    for (const listener of listeners) listener(info);
  }
}

/** Maps the error text React Native reports for a failed connection to a cause. */
export function causeFromMessage(message: string): PeerUnreachableCause {
  if (/refused|ECONNREFUSED/i.test(message)) return 'refused';
  if (/timed? ?out|ETIMEDOUT/i.test(message)) return 'timeout';
  if (/unreachable|no route|EHOSTUNREACH|ENETUNREACH/i.test(message)) return 'unreachable';
  return 'unknown';
}

/** Client-only transport: phones dial computers, they never listen (docs/PLAN.md §6.2). */
export class RnWebSocketTransport implements TransportPort {
  dial(address: PeerAddress, timeoutMs: number): Promise<Result<TransportConnection, AppError>> {
    const target = `${address.host}:${address.port}`;
    return new Promise((resolve) => {
      const socket = new WebSocket(`ws://${target}`);
      let settled = false;
      const fail = (cause: PeerUnreachableCause, message: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.onopen = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
        resolve(
          err(
            appError('PEER_UNREACHABLE', `cannot reach ${target}: ${message}`, {
              peerId: null,
              peerName: null,
              address: target,
              cause,
            }),
          ),
        );
      };
      const timer = setTimeout(() => {
        fail('timeout', 'connection timed out');
      }, timeoutMs);
      socket.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok(new RnWebSocketConnection(socket, target)));
      };
      socket.onerror = (event: Event) => {
        const message = (event as Event & { message?: string }).message ?? 'connection failed';
        fail(causeFromMessage(message), message);
      };
      socket.onclose = (event: WebSocketCloseEvent) => {
        fail('refused', event.reason ?? 'closed before opening');
      };
    });
  }
}
