import { describe, expect, it } from 'vitest';

import { signMembership } from '../application/membership-service';
import { bytesToBase64 } from '../lib/base64';
import { createTestGroup, createTestMember } from '../testing/fixtures';
import { SeededRandom } from '../testing/seeded-random';
import { decodeBody, decodeFrame, encodeBody, encodeFrame } from './codec';
import type { HelloFrame } from './frames';
import {
  createAuth,
  createHello,
  deriveSessionKeys,
  type GroupKeyRing,
  type HandshakeCredentials,
  handshakeTranscript,
  negotiateGroupKey,
  verifyPeerAuth,
} from './handshake';
import { SecureChannel } from './secure-channel';
import { MAX_FRAME_CHARS, PROTOCOL_VERSION } from './version';
import {
  clipFromWire,
  clipToWire,
  membershipFromWire,
  membershipToWire,
  parseMembership,
} from './wire';

const random = new SeededRandom(3);
const group = createTestGroup(
  [
    { name: 'Laptop', platform: 'windows' },
    { name: 'Phone', platform: 'android' },
  ],
  random,
);
const [laptop, phone] = group.members as [(typeof group.members)[0], (typeof group.members)[0]];

function ring(key: Uint8Array = group.groupKey, epoch = group.epoch): GroupKeyRing {
  return { epoch, keyFor: (requested) => (requested === epoch ? key : null) };
}

function credentials(
  member = laptop,
  overrides: Partial<HandshakeCredentials> = {},
): HandshakeCredentials {
  return { deviceId: member.device.id, identity: member.identity, keys: ring(), ...overrides };
}

describe('codec', () => {
  it('round-trips a plain frame', () => {
    const hello = createHello(credentials(), 'initiator', random);
    const decoded = decodeFrame(encodeFrame(hello));
    expect(decoded).toEqual({ ok: true, value: hello });
  });

  it('reports VERSION_MISMATCH before validating the rest', () => {
    const decoded = decodeFrame(JSON.stringify({ v: 2, t: 'SOMETHING_NEW' }));
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) {
      expect(decoded.error).toMatchObject({
        code: 'VERSION_MISMATCH',
        details: { localVersion: PROTOCOL_VERSION, remoteVersion: 2 },
      });
    }
  });

  it.each([
    ['not JSON', '{nope'],
    ['an array', '[1,2]'],
    ['unknown type', JSON.stringify({ v: 1, t: 'NOPE' })],
    ['bad device id', JSON.stringify({ v: 1, t: 'AUTH', mac: 'x', sig: 'y' })],
    ['oversized', ' '.repeat(MAX_FRAME_CHARS + 1)],
  ])('rejects %s with PROTOCOL_ERROR', (_name, raw) => {
    const decoded = decodeFrame(raw);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error.code).toBe('PROTOCOL_ERROR');
  });

  it('missing version is a version mismatch with unknown remote version', () => {
    const decoded = decodeFrame('{"t":"HELLO"}');
    expect(
      !decoded.ok &&
        decoded.error.code === 'VERSION_MISMATCH' &&
        decoded.error.details.remoteVersion,
    ).toBe(null);
  });

  it('validates bodies', () => {
    expect(decodeBody(encodeBody({ t: 'PING', ts: 5 }))).toEqual({
      ok: true,
      value: { t: 'PING', ts: 5 },
    });
    expect(decodeBody('{"t":"CLIP"}').ok).toBe(false);
    expect(decodeBody('nope').ok).toBe(false);
  });
});

describe('wire conversion', () => {
  const base = {
    id: '018bcfe5-6800-7000-8000-000000000000',
    origin: laptop.device.id,
    createdAt: 1,
  };

  it('round-trips text, url and image clips and recomputes the hash', () => {
    for (const wire of [
      { ...base, kind: 'text' as const, text: 'hi' },
      { ...base, kind: 'url' as const, url: 'https://a.b' },
      {
        ...base,
        kind: 'image' as const,
        mime: 'image/png' as const,
        data: bytesToBase64(new Uint8Array([1, 2, 3])),
      },
    ]) {
      const clip = clipFromWire(wire);
      expect(clip.ok).toBe(true);
      if (clip.ok) {
        expect(clip.value.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(clipToWire(clip.value)).toEqual(wire);
      }
    }
  });

  it('rejects broken image data', () => {
    const clip = clipFromWire({ ...base, kind: 'image', mime: 'image/png', data: 'abc' });
    expect(!clip.ok && clip.error.code).toBe('PROTOCOL_ERROR');
  });

  it('round-trips membership', () => {
    expect(membershipFromWire(membershipToWire(group.membership))).toEqual(group.membership);
  });

  it('parses stored membership and rejects garbage', () => {
    const stored: unknown = JSON.parse(JSON.stringify(group.membership));
    expect(parseMembership(stored)).toEqual({ ok: true, value: group.membership });
    expect(parseMembership({ version: 'x' }).ok).toBe(false);
  });
});

describe('handshake', () => {
  function runHandshake(
    initiator: HandshakeCredentials,
    responder: HandshakeCredentials,
  ): { initiatorHello: HelloFrame; responderHello: HelloFrame; transcript: Uint8Array } {
    const initiatorHello = createHello(initiator, 'initiator', random);
    const responderHello = createHello(responder, 'responder', random);
    return {
      initiatorHello,
      responderHello,
      transcript: handshakeTranscript(initiatorHello, responderHello),
    };
  }

  it('authenticates both members and agrees on directional keys', () => {
    const a = credentials(laptop);
    const b = credentials(phone);
    const { initiatorHello, responderHello, transcript } = runHandshake(a, b);

    const verifiedByA = verifyPeerAuth({
      groupKey: group.groupKey,
      membership: group.membership,
      transcript,
      peerHello: responderHello,
      peerAuth: createAuth(b, 'responder', transcript, group.groupKey),
    });
    const verifiedByB = verifyPeerAuth({
      groupKey: group.groupKey,
      membership: group.membership,
      transcript,
      peerHello: initiatorHello,
      peerAuth: createAuth(a, 'initiator', transcript, group.groupKey),
    });
    expect(verifiedByA.ok && verifiedByA.value.id).toBe(phone.device.id);
    expect(verifiedByB.ok && verifiedByB.value.id).toBe(laptop.device.id);

    const keysA = deriveSessionKeys(group.groupKey, transcript, 'initiator');
    const keysB = deriveSessionKeys(group.groupKey, transcript, 'responder');
    expect(keysA.sendKey).toEqual(keysB.receiveKey);
    expect(keysA.receiveKey).toEqual(keysB.sendKey);
    expect(keysA.sendKey).not.toEqual(keysA.receiveKey);
  });

  function verifyFrom(
    responder: HandshakeCredentials,
    tweak: Partial<{ hello: Partial<HelloFrame> }> = {},
  ) {
    const { responderHello, transcript } = runHandshake(credentials(laptop), responder);
    const peerHello = { ...responderHello, ...tweak.hello };
    return verifyPeerAuth({
      groupKey: group.groupKey,
      membership: group.membership,
      transcript,
      peerHello,
      peerAuth: createAuth(
        responder,
        'responder',
        transcript,
        responder.keys.keyFor(1) ?? new Uint8Array(32),
      ),
    });
  }

  it.each([
    [
      'wrong group key',
      () => verifyFrom(credentials(phone, { keys: ring(random.randomBytes(32)) })),
      'bad-mac',
    ],
    [
      'device not in member list',
      () => {
        const outsider = createTestMember({ name: 'Colleague', platform: 'windows' }, random);
        return verifyFrom(credentials(outsider));
      },
      'not-a-member',
    ],
    [
      'claims another member’s id',
      () => verifyFrom(credentials(phone), { hello: { deviceId: laptop.device.id } }),
      'key-mismatch',
    ],
    [
      'member id with a different key',
      () => {
        const impostor = createTestMember({ name: 'Phone', platform: 'android' }, random);
        return verifyFrom(credentials(impostor, { deviceId: phone.device.id }), {
          hello: { deviceId: phone.device.id },
        });
      },
      'key-mismatch',
    ],
  ])('rejects %s', (_name, run, reason) => {
    const result = run();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.details.reason).toBe(reason);
  });

  it('negotiates the lower epoch when both sides still have that key', () => {
    const key1 = random.randomBytes(32);
    const key2 = random.randomBytes(32);
    const key3 = random.randomBytes(32);
    const keys: GroupKeyRing = {
      epoch: 3,
      keyFor: (epoch) => ({ 1: null, 2: key2, 3: key3 })[epoch] ?? null,
    };
    expect(negotiateGroupKey(keys, 5)).toEqual({ epoch: 3, key: key3 });
    expect(negotiateGroupKey(keys, 2)).toEqual({ epoch: 2, key: key2 });
    expect(negotiateGroupKey(keys, 1)).toBeNull();
    expect(key1).toHaveLength(32);
  });

  it('rejects a signature from the wrong identity', () => {
    const b = credentials(phone);
    const { responderHello, transcript } = runHandshake(credentials(laptop), b);
    const forged = createAuth(
      { ...b, identity: createTestMember({ name: 'x', platform: 'ios' }, random).identity },
      'responder',
      transcript,
      group.groupKey,
    );
    const result = verifyPeerAuth({
      groupKey: group.groupKey,
      membership: group.membership,
      transcript,
      peerHello: responderHello,
      peerAuth: forged,
    });
    expect(!result.ok && result.error.details.reason).toBe('bad-signature');
  });

  it('rejects an AUTH computed for a different transcript (replay)', () => {
    const b = credentials(phone);
    const first = runHandshake(credentials(laptop), b);
    const second = runHandshake(credentials(laptop), b);
    const result = verifyPeerAuth({
      groupKey: group.groupKey,
      membership: group.membership,
      transcript: second.transcript,
      peerHello: second.responderHello,
      peerAuth: createAuth(b, 'responder', first.transcript, group.groupKey),
    });
    expect(!result.ok && result.error.details.reason).toBe('bad-mac');
  });
});

describe('SecureChannel', () => {
  const transcript = random.randomBytes(32);
  const makePair = (): [SecureChannel, SecureChannel] => [
    new SecureChannel(deriveSessionKeys(group.groupKey, transcript, 'initiator'), random),
    new SecureChannel(deriveSessionKeys(group.groupKey, transcript, 'responder'), random),
  ];

  it('delivers bodies in both directions', () => {
    const [a, b] = makePair();
    expect(b.open(a.seal({ t: 'PING', ts: 1 }))).toEqual({ ok: true, value: { t: 'PING', ts: 1 } });
    expect(a.open(b.seal({ t: 'PONG', ts: 1 }))).toEqual({ ok: true, value: { t: 'PONG', ts: 1 } });
  });

  it('hides the body type on the wire', () => {
    const [a] = makePair();
    const frame = a.seal({ t: 'HISTORY_REQ', since: 0 });
    expect(JSON.stringify(frame)).not.toContain('HISTORY');
  });

  it('rejects replayed and reordered frames', () => {
    const [a, b] = makePair();
    const first = a.seal({ t: 'PING', ts: 1 });
    const second = a.seal({ t: 'PING', ts: 2 });
    expect(b.open(second).ok).toBe(true);
    expect(b.open(first).ok).toBe(false);
    expect(b.open(second).ok).toBe(false);
  });

  it('rejects a frame reflected back to its sender', () => {
    const [a] = makePair();
    const frame = a.seal({ t: 'PING', ts: 1 });
    expect(a.open(frame).ok).toBe(false);
  });

  it('rejects a frame whose sequence number was changed', () => {
    const [a, b] = makePair();
    const frame = a.seal({ t: 'PING', ts: 1 });
    expect(b.open({ ...frame, s: frame.s + 5 }).ok).toBe(false);
  });

  it('rejects garbage ciphertext', () => {
    const [, b] = makePair();
    expect(
      b.open({ v: 1, t: 'SEC', s: 0, n: bytesToBase64(new Uint8Array(24)), c: 'AAAA' }).ok,
    ).toBe(false);
    expect(b.open({ v: 1, t: 'SEC', s: 0, n: 'bad', c: 'bad' }).ok).toBe(false);
  });
});

describe('membership signing', () => {
  it('produces a membership whose wire form validates', () => {
    const signed = signMembership(
      { ...group.membership, version: 2, updatedBy: phone.device.id },
      phone.identity,
    );
    expect(signed.signature).toHaveLength(88);
  });
});
