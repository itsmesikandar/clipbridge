import { createServer } from 'node:net';

import type { Listener, TransportConnection } from '@clipbridge/core';
import { afterEach, describe, expect, it } from 'vitest';

import { causeFromError, WsTransport } from './ws-transport';

const transport = new WsTransport();
const listeners: Listener[] = [];

afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
});

async function listen(
  onConnection: (connection: TransportConnection) => void,
  port = 0,
): Promise<Listener> {
  const result = await transport.listen(port, onConnection);
  if (!result.ok) throw new Error(result.error.message);
  listeners.push(result.value);
  return result.value;
}

function nextMessage(connection: TransportConnection): Promise<string> {
  return new Promise((resolve) => {
    const unsubscribe = connection.onMessage((data) => {
      unsubscribe();
      resolve(data);
    });
  });
}

describe('WsTransport on localhost', () => {
  it('connects, exchanges text frames both ways and reports closure once', async () => {
    let accept: (connection: TransportConnection) => void = () => undefined;
    const accepted = new Promise<TransportConnection>((resolve) => {
      accept = resolve;
    });
    const listener = await listen((connection) => {
      accept(connection);
    });
    const dialed = await transport.dial({ host: '127.0.0.1', port: listener.port }, 2_000);
    if (!dialed.ok) throw new Error('dial failed');
    const client = dialed.value;
    const serverSide = await accepted;
    expect(client.remoteAddress).toBe(`127.0.0.1:${listener.port}`);

    const toServer = nextMessage(serverSide);
    client.send('{"hello":"server"}');
    expect(await toServer).toBe('{"hello":"server"}');

    const toClient = nextMessage(client);
    serverSide.send('ünïcødé 🚀');
    expect(await toClient).toBe('ünïcødé 🚀');

    const closedOnServer = new Promise<{ local: boolean; reason: string }>((resolve) => {
      serverSide.onClose(resolve);
    });
    const clientCloses: unknown[] = [];
    client.onClose((info) => clientCloses.push(info));
    client.close('bye');
    expect(await closedOnServer).toEqual({ local: false, reason: 'bye' });
    expect(clientCloses).toEqual([{ local: true, reason: 'bye' }]);

    // Late listeners are told immediately; sending after close is ignored.
    const late: unknown[] = [];
    client.onClose((info) => late.push(info));
    expect(late).toHaveLength(1);
    client.send('ignored');
  });

  it('reports a refused connection as PEER_UNREACHABLE (refused)', async () => {
    const port = await freePort();
    const dialed = await transport.dial({ host: '127.0.0.1', port }, 2_000);
    expect(dialed.ok).toBe(false);
    if (!dialed.ok) {
      expect(dialed.error).toMatchObject({
        code: 'PEER_UNREACHABLE',
        details: { cause: 'refused', address: `127.0.0.1:${port}` },
      });
    }
  });

  it('falls back to a free port when the preferred one is taken', async () => {
    const first = await listen(() => undefined);
    const second = await listen(() => undefined, first.port);
    expect(second.port).not.toBe(first.port);
    expect(second.port).toBeGreaterThan(0);
  });
});

describe('causeFromError', () => {
  const withCode = (code: string, message = code): Error =>
    Object.assign(new Error(message), { code });

  it.each([
    [withCode('ECONNREFUSED'), 'refused'],
    [withCode('ETIMEDOUT'), 'timeout'],
    [new Error('Opening handshake has timed out'), 'timeout'],
    [withCode('EHOSTUNREACH'), 'unreachable'],
    [withCode('ENETUNREACH'), 'unreachable'],
    [new Error('weird'), 'unknown'],
    ['not an error', 'unknown'],
  ] as const)('%s → %s', (error, cause) => {
    expect(causeFromError(error)).toBe(cause);
  });
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => {
        resolve(port);
      });
    });
  });
}
