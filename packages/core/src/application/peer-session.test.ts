import { describe, expect, it } from 'vitest';

import type { AppError } from '../domain/errors';
import type { Result } from '../domain/result';
import { FakeClock } from '../testing/fake-clock';
import { MemoryLogger } from '../testing/fakes';
import { createTestGroup, createTestMember, type TestMember } from '../testing/fixtures';
import { InMemoryNetwork } from '../testing/in-memory-network';
import { SeededRandom } from '../testing/seeded-random';
import { GroupKeys } from './group-keys';
import {
  establishSession,
  type PeerSession,
  SESSION_TIMING,
  type SessionContext,
} from './peer-session';

const random = new SeededRandom(11);
const group = createTestGroup(
  [
    { name: 'Laptop', platform: 'windows' },
    { name: 'Phone', platform: 'android' },
  ],
  random,
);
const [laptop, phone] = group.members as [TestMember, TestMember];

function context(member: TestMember, groupKey = group.groupKey): SessionContext {
  return {
    credentials: {
      deviceId: member.device.id,
      identity: member.identity,
      keys: new GroupKeys({ epoch: group.epoch, key: groupKey }),
    },
    membership: () => group.membership,
  };
}

async function connectPair(
  options: { serverContext?: SessionContext; clientContext?: SessionContext } = {},
) {
  const clock = new FakeClock();
  const network = new InMemoryNetwork();
  const server = network.createNode('laptop', { subnet: '192.168.1.0/24' });
  const client = network.createNode('phone', { subnet: '192.168.1.0/24' });
  const deps = { clock, random, logger: new MemoryLogger() };

  const accepted: { result: Promise<Result<PeerSession, AppError>> | null } = { result: null };
  const listening = await server.transport.listen?.(47821, (connection) => {
    accepted.result = establishSession(
      connection,
      'responder',
      options.serverContext ?? context(laptop),
      deps,
    );
  });
  if (!listening?.ok) throw new Error('listen failed');

  const dialed = await client.transport.dial({ host: 'laptop', port: 47821 }, 1_000);
  if (!dialed.ok) throw new Error('dial failed');
  const clientResult = establishSession(
    dialed.value,
    'initiator',
    options.clientContext ?? context(phone),
    deps,
  );
  await clock.advance(10);
  if (!accepted.result) throw new Error('server never accepted');
  return {
    clock,
    network,
    clientConnection: dialed.value,
    client: await clientResult,
    server: await accepted.result,
  };
}

describe('establishSession', () => {
  it('authenticates both sides and exchanges encrypted bodies', async () => {
    const { client, server, clock } = await connectPair();
    if (!client.ok || !server.ok) throw new Error('handshake failed');
    expect(client.value.peer.id).toBe(laptop.device.id);
    expect(server.value.peer.id).toBe(phone.device.id);

    const received: string[] = [];
    server.value.onBody((body) => received.push(body.t));
    client.value.send({ t: 'HISTORY_REQ', since: 0 });
    await clock.advance(1);
    expect(received).toEqual(['HISTORY_REQ']);
  });

  it('rejects a device holding the wrong group key; both sides learn why', async () => {
    const { client, server } = await connectPair({
      clientContext: context(phone, random.randomBytes(32)),
    });
    expect(!server.ok && server.error).toMatchObject({
      code: 'AUTH_FAILED',
      details: { reason: 'bad-mac' },
    });
    expect(!client.ok && client.error.code).toBe('AUTH_FAILED');
  });

  it('rejects a device that is not a member', async () => {
    const outsider = createTestMember({ name: 'Colleague', platform: 'android' }, random);
    const { server } = await connectPair({ clientContext: context(outsider) });
    expect(!server.ok && server.error).toMatchObject({
      code: 'AUTH_FAILED',
      details: { reason: 'not-a-member' },
    });
  });

  it('times out a silent peer', async () => {
    const clock = new FakeClock();
    const network = new InMemoryNetwork();
    const server = network.createNode('laptop', { subnet: '10.0.0.0/24' });
    const client = network.createNode('phone', { subnet: '10.0.0.0/24' });
    await server.transport.listen?.(1, () => undefined); // accepts but never answers
    const dialed = await client.transport.dial({ host: 'laptop', port: 1 }, 1_000);
    if (!dialed.ok) throw new Error('dial failed');
    const result = establishSession(dialed.value, 'initiator', context(phone), {
      clock,
      random,
      logger: new MemoryLogger(),
    });
    await clock.advance(SESSION_TIMING.handshakeTimeoutMs);
    expect(await result).toMatchObject({
      ok: false,
      error: { code: 'CONNECTION_LOST', details: { reason: 'handshake-timeout' } },
    });
  });

  it('reports VERSION_MISMATCH when the peer speaks a newer protocol', async () => {
    const clock = new FakeClock();
    const network = new InMemoryNetwork();
    const server = network.createNode('laptop', { subnet: '10.0.0.0/24' });
    const client = network.createNode('phone', { subnet: '10.0.0.0/24' });
    const sent: string[] = [];
    await server.transport.listen?.(1, (connection) => {
      connection.onMessage((data) => sent.push(data));
      connection.send(JSON.stringify({ v: 2, t: 'HELLO_V2' }));
    });
    const dialed = await client.transport.dial({ host: 'laptop', port: 1 }, 1_000);
    if (!dialed.ok) throw new Error('dial failed');
    const result = establishSession(dialed.value, 'initiator', context(phone), {
      clock,
      random,
      logger: new MemoryLogger(),
    });
    await clock.advance(1);
    expect(await result).toMatchObject({
      ok: false,
      error: { code: 'VERSION_MISMATCH', details: { remoteVersion: 2, localVersion: 1 } },
    });
    expect(sent.some((frame) => frame.includes('"code":"VERSION_MISMATCH"'))).toBe(true);
  });
});

describe('established session', () => {
  it('closes with heartbeat-timeout when the peer goes silent', async () => {
    const { client, server, clock, network } = await connectPair();
    if (!client.ok || !server.ok) throw new Error('handshake failed');
    const reasons: string[] = [];
    client.value.onClose((reason) => reasons.push(reason.code));

    await clock.advance(SESSION_TIMING.heartbeatIntervalMs * 2);
    expect(client.value.isClosed).toBe(false); // heartbeats keep it alive

    network.block('laptop', 'phone');
    await clock.advance(SESSION_TIMING.deadAfterMs + SESSION_TIMING.heartbeatIntervalMs * 2);
    expect(client.value.isClosed).toBe(true);
    expect(reasons).toEqual(['CONNECTION_LOST']);
  });

  it('closes on garbage after the handshake and tells the peer', async () => {
    const { client, server, clock, clientConnection } = await connectPair();
    if (!client.ok || !server.ok) throw new Error('handshake failed');
    const serverReasons: string[] = [];
    server.value.onClose((reason) => serverReasons.push(reason.code));
    clientConnection.send('{"v":1,"t":"HELLO"}');
    await clock.advance(1);
    expect(server.value.isClosed).toBe(true);
    expect(serverReasons).toEqual(['PROTOCOL_ERROR']);
    expect(client.value.isClosed).toBe(true);
  });

  it('delivers an ERROR frame from the peer as the close reason', async () => {
    const { client, server, clock } = await connectPair();
    if (!client.ok || !server.ok) throw new Error('handshake failed');
    const reasons: AppError[] = [];
    client.value.onClose((reason) => reasons.push(reason));
    server.value.close(
      { code: 'REMOVED_FROM_GROUP', message: 'bye', details: {} },
      'REMOVED_FROM_GROUP',
    );
    await clock.advance(1);
    expect(reasons.map((reason) => reason.code)).toEqual(['REMOVED_FROM_GROUP']);
    // Listeners registered after close are called immediately.
    const late: string[] = [];
    client.value.onClose((reason) => late.push(reason.code));
    expect(late).toEqual(['REMOVED_FROM_GROUP']);
  });
});
