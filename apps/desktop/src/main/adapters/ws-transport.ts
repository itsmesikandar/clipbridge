import type { AddressInfo } from 'node:net';

import {
  type AppError,
  appError,
  err,
  type Listener,
  ok,
  type PeerAddress,
  type PeerUnreachableCause,
  type Result,
  type TransportCloseInfo,
  type TransportConnection,
  type TransportPort,
  type Unsubscribe,
} from '@clipbridge/core';
import { type RawData, WebSocket, WebSocketServer } from 'ws';

/** Largest frame accepted from a peer (core limits clips further). */
export const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024;

const NORMAL_CLOSURE = 1000;
/** WebSocket close reasons are limited to 123 bytes. */
const MAX_CLOSE_REASON = 120;

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

class WsConnection implements TransportConnection {
  private closeInfo: TransportCloseInfo | null = null;
  private closedLocally = false;
  private readonly messageListeners = new Set<(data: string) => void>();
  private readonly closeListeners = new Set<(info: TransportCloseInfo) => void>();

  constructor(
    private readonly socket: WebSocket,
    readonly remoteAddress: string,
  ) {
    socket.on('message', (data, isBinary) => {
      if (isBinary) return; // protocol frames are text
      const text = rawToString(data);
      for (const listener of [...this.messageListeners]) listener(text);
    });
    socket.on('close', (_code, reason) => {
      this.finish({ local: this.closedLocally, reason: reason.toString('utf8') || 'closed' });
    });
    socket.on('error', () => {
      // 'close' follows every 'error'; nothing else to do here.
    });
  }

  send(data: string): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(data);
  }

  close(reason: string): void {
    if (this.closeInfo) return;
    this.closedLocally = true;
    this.socket.close(NORMAL_CLOSURE, reason.slice(0, MAX_CLOSE_REASON));
    // Do not wait for the peer's close frame to report closure locally.
    this.finish({ local: true, reason });
    setTimeout(() => {
      this.socket.terminate();
    }, 2_000).unref();
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

/** Maps Node socket errors to the reason shown to the user. */
export function causeFromError(error: unknown): PeerUnreachableCause {
  const code = error instanceof Error && 'code' in error ? String(error.code) : '';
  const message = error instanceof Error ? error.message : '';
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ETIMEDOUT' || /timed? ?out/i.test(message)) return 'timeout';
  if (['EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL', 'ENOTFOUND'].includes(code))
    return 'unreachable';
  return 'unknown';
}

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

/** WebSocket transport: a server for incoming peers and a client for dialing. */
export class WsTransport implements TransportPort {
  dial(address: PeerAddress, timeoutMs: number): Promise<Result<TransportConnection, AppError>> {
    const target = `${formatHost(address.host)}:${address.port}`;
    return new Promise((resolve) => {
      const socket = new WebSocket(`ws://${target}`, {
        handshakeTimeout: timeoutMs,
        maxPayload: MAX_PAYLOAD_BYTES,
        perMessageDeflate: false,
      });
      const fail = (cause: PeerUnreachableCause, message: string): void => {
        socket.removeAllListeners();
        socket.on('error', () => undefined);
        socket.terminate();
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
      socket.once('open', () => {
        socket.removeAllListeners('error');
        resolve(ok(new WsConnection(socket, target)));
      });
      socket.once('error', (error) => {
        fail(causeFromError(error), error.message);
      });
      socket.once('unexpected-response', (_request, response) => {
        fail('refused', `HTTP ${String(response.statusCode)}`);
      });
    });
  }

  listen(
    preferredPort: number,
    onConnection: (connection: TransportConnection) => void,
  ): Promise<Result<Listener, AppError>> {
    return this.tryListen(preferredPort, onConnection).then(async (first) => {
      if (first.ok || preferredPort === 0) return first;
      // Preferred port busy (e.g. a second instance): let the OS pick a free one.
      return this.tryListen(0, onConnection);
    });
  }

  private tryListen(
    port: number,
    onConnection: (connection: TransportConnection) => void,
  ): Promise<Result<Listener, AppError>> {
    return new Promise((resolve) => {
      const server = new WebSocketServer({
        port,
        host: '0.0.0.0',
        maxPayload: MAX_PAYLOAD_BYTES,
        perMessageDeflate: false,
      });
      server.once('error', () => {
        server.close();
        resolve(err(appError('PORT_IN_USE', `cannot listen on port ${port}`, { port })));
      });
      server.once('listening', () => {
        server.removeAllListeners('error');
        server.on('error', () => undefined);
        server.on('connection', (socket, request) => {
          const remote = `${request.socket.remoteAddress ?? 'unknown'}:${String(request.socket.remotePort ?? 0)}`;
          onConnection(new WsConnection(socket, remote));
        });
        const actualPort = (server.address() as AddressInfo).port;
        resolve(
          ok({
            port: actualPort,
            close: () =>
              new Promise<void>((done) => {
                for (const client of server.clients) client.terminate();
                server.close(() => {
                  done();
                });
              }),
          }),
        );
      });
    });
  }
}
