/** Image clips: chunked transfer, integrity, limits and catch-up (Milestone 6). */

import { describe, expect, it } from 'vitest';

import { computeContentHash } from '../crypto/content-hash';
import { CLIP_LIMITS, type ClipContent } from '../domain/clip';
import type { DeviceRecord } from '../domain/device';
import type { AppError } from '../domain/errors';
import type { ClipId, DeviceId } from '../domain/ids';
import { bytesToBase64 } from '../lib/base64';
import type { Unsubscribe } from '../ports/transport';
import { type Body, IMAGE_CHUNK_BYTES } from '../protocol/frames';
import { FakeClock } from '../testing/fake-clock';
import { FakeClipboard, FakeNotifier, MemoryLogger } from '../testing/fakes';
import { createTestGroup, type TestMember } from '../testing/fixtures';
import { TestHarness } from '../testing/harness';
import { SeededRandom } from '../testing/seeded-random';
import type { PeerSession } from './peer-session';
import { SyncEngine } from './sync-engine';

const HOME = '192.168.1.0/24';

type ImageContent = Extract<ClipContent, { kind: 'image' }>;

/** Fingerprints of clip contents; deep-equality on megabytes of bytes is very slow. */
const ids = (contents: readonly ClipContent[]): string[] => contents.map(computeContentHash);

/** A deterministic fake PNG of `size` bytes. */
function image(size: number, seed = 1): ClipContent {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) data[i] = (i * 31 + seed) & 0xff;
  return { kind: 'image', mime: 'image/png', data };
}

function group() {
  const random = new SeededRandom(66);
  const testGroup = createTestGroup(
    [
      { name: 'Laptop-1', platform: 'windows' },
      { name: 'Laptop-2', platform: 'macos' },
      { name: 'Pixel', platform: 'android' },
      { name: 'iPhone', platform: 'ios' },
    ],
    random,
  );
  const harness = new TestHarness(testGroup);
  const [l1, l2, p1, p2] = testGroup.members as [TestMember, TestMember, TestMember, TestMember];
  const devices = {
    l1: harness.addDevice(l1, { subnet: HOME }),
    l2: harness.addDevice(l2, { subnet: HOME }),
    p1: harness.addDevice(p1, { subnet: HOME }),
    p2: harness.addDevice(p2, { subnet: HOME }),
  };
  return { harness, devices };
}

// Megabytes through base64 + encryption are slow under coverage instrumentation.
describe('image sync', { timeout: 20_000 }, () => {
  it('a 1.2 MB screenshot (five chunks) reaches every device intact', async () => {
    const { harness, devices } = group();
    await harness.startAll(Object.values(devices));
    const screenshot = image(1_200_000 + 123);
    devices.l1.clipboard.userCopies(screenshot);
    await harness.clock.advance(500);

    expect(ids(devices.l2.clipboard.writes)).toEqual(ids([screenshot]));
    for (const phone of [devices.p1, devices.p2]) {
      expect(ids(phone.notifier.received.map((r) => r.clip.content))).toEqual(ids([screenshot]));
    }
    expect(devices.l1.engine.history.get()[0]?.deliveredTo).toHaveLength(3);
  });

  it('a photo shared on one phone reaches the computers and the other phone', async () => {
    const { harness, devices } = group();
    await harness.startAll(Object.values(devices));
    const photo: ClipContent = { ...(image(800_000, 9) as ImageContent), mime: 'image/jpeg' };
    expect(devices.p1.engine.sendClip(photo).ok).toBe(true);
    await harness.clock.advance(500);
    expect(ids(devices.l1.clipboard.writes)).toEqual(ids([photo]));
    expect(ids(devices.l2.clipboard.writes)).toEqual(ids([photo]));
    expect(ids(devices.p2.notifier.received.map((r) => r.clip.content))).toEqual(ids([photo]));
  });

  it('refuses images over 10 MB', async () => {
    const { harness, devices } = group();
    await harness.startAll([devices.l1]);
    const result = devices.p1.engine.sendClip(image(CLIP_LIMITS.imageBytes + 1));
    expect(!result.ok && result.error).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      details: { kind: 'image', limitBytes: CLIP_LIMITS.imageBytes },
    });
  });

  it('a phone that was off gets the text history and only the newest image', async () => {
    const { harness, devices } = group();
    await harness.startAll([devices.l1]);
    devices.l1.clipboard.userCopies(image(300_000, 1));
    await harness.clock.advance(1_000);
    devices.l1.clipboard.userCopies({ kind: 'text', text: 'note' });
    await harness.clock.advance(1_000);
    const latest = image(300_000, 2);
    devices.l1.clipboard.userCopies(latest);
    await harness.clock.advance(1_000);

    await harness.startAll([devices.p1]);
    await harness.clock.advance(500);
    const contents = devices.p1.engine.history.get().map((entry) => entry.clip.content);
    expect(ids(contents)).toEqual(ids([latest, { kind: 'text', text: 'note' }]));
    expect(ids(devices.p1.notifier.received.map((r) => r.clip.content))).toEqual(ids([latest]));
  });

  it('keeps only the newest three images in history', async () => {
    const { harness, devices } = group();
    await harness.startAll([devices.l1]);
    for (let seed = 1; seed <= 5; seed++) {
      devices.l1.clipboard.userCopies(image(1_000, seed));
      await harness.clock.advance(1_000);
    }
    expect(devices.l1.engine.history.get()).toHaveLength(3);
  });
});

/** A session whose incoming bodies the test controls. */
class FakeSession implements PeerSession {
  readonly sent: Body[] = [];
  readonly remoteAddress = 'fake';
  readonly epoch = 1;
  isClosed = false;
  private readonly listeners = new Set<(body: Body) => void>();

  constructor(readonly peer: DeviceRecord) {}

  send(body: Body): void {
    this.sent.push(body);
  }
  onBody(listener: (body: Body) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  onClose(_listener: (reason: AppError) => void): Unsubscribe {
    return () => undefined;
  }
  close(): void {
    this.isClosed = true;
  }
  receive(body: Body): void {
    for (const listener of [...this.listeners]) listener(body);
  }
}

describe('chunk reassembly', () => {
  const random = new SeededRandom(3);
  const testGroup = createTestGroup(
    [
      { name: 'Laptop', platform: 'windows' },
      { name: 'Phone', platform: 'android' },
    ],
    random,
  );
  const [laptop, phone] = testGroup.members as [TestMember, TestMember];

  function setup() {
    const clock = new FakeClock();
    const clipboard = new FakeClipboard();
    const logger = new MemoryLogger();
    const sync = new SyncEngine(
      {
        selfId: laptop.device.id,
        settings: () => ({
          sendEnabled: true,
          receiveEnabled: true,
          applyToClipboard: true,
          notifyOnReceive: false,
        }),
        findMember: (id) => testGroup.membership.members.find((member) => member.id === id),
      },
      { clock, random, logger, clipboard, notifier: new FakeNotifier() },
    );
    const session = new FakeSession(phone.device);
    sync.attach(session);
    return { clock, clipboard, logger, session };
  }

  function chunksOf(content: ImageContent, id: string): [Body, Body, ...Body[]] {
    const count = Math.ceil(content.data.length / IMAGE_CHUNK_BYTES);
    const bodies: Body[] = [
      {
        t: 'CLIP_START',
        clip: {
          id,
          origin: phone.device.id,
          createdAt: 1,
          kind: 'image',
          mime: content.mime,
          size: content.data.length,
          hash: computeContentHash(content),
          chunks: count,
        },
      },
    ];
    for (let index = 0; index < count; index++) {
      const slice = content.data.subarray(
        index * IMAGE_CHUNK_BYTES,
        (index + 1) * IMAGE_CHUNK_BYTES,
      );
      bodies.push({ t: 'CLIP_CHUNK', clipId: id, index, data: bytesToBase64(slice) });
    }
    // START plus at least one chunk.
    return bodies as [Body, Body, ...Body[]];
  }

  const id = (n: number): ClipId => `018bcfe5-6800-7000-8000-00000000000${n}` as ClipId;
  const content = image(IMAGE_CHUNK_BYTES * 2 + 10) as Extract<ClipContent, { kind: 'image' }>;

  it('reassembles chunks that arrive out of order and acknowledges', () => {
    const { clipboard, session } = setup();
    const [start, ...chunks] = chunksOf(content, id(1));
    session.receive(start);
    for (const chunk of chunks.reverse()) session.receive(chunk);
    expect(ids(clipboard.writes)).toEqual(ids([content]));
    expect(session.sent).toContainEqual({ t: 'ACK', clipId: id(1) });
  });

  it('drops an image whose bytes do not match the announced hash', () => {
    const { clipboard, session, logger } = setup();
    const [start, first, ...rest] = chunksOf(content, id(2));
    session.receive(start);
    session.receive({
      ...(first as Extract<Body, { t: 'CLIP_CHUNK' }>),
      data: bytesToBase64(new Uint8Array(IMAGE_CHUNK_BYTES)),
    });
    for (const chunk of rest) session.receive(chunk);
    expect(clipboard.writes).toEqual([]);
    expect(logger.entries.some((entry) => entry.message === 'image failed integrity check')).toBe(
      true,
    );
  });

  it('gives up on an incomplete image after 30 seconds', async () => {
    const { clock, clipboard, session, logger } = setup();
    const [start, first] = chunksOf(content, id(3));
    session.receive(start);
    session.receive(first);
    await clock.advance(30_000);
    expect(clipboard.writes).toEqual([]);
    expect(logger.entries.some((entry) => entry.message === 'image transfer timed out')).toBe(true);
  });

  it('limits how many images one peer can send at once', () => {
    const { session, logger } = setup();
    for (let n = 4; n <= 6; n++) session.receive(chunksOf(content, id(n))[0]);
    expect(logger.entries.some((entry) => entry.message === 'too many images in flight')).toBe(
      true,
    );
  });

  it('asks other senders to stop when the image is already arriving or known', () => {
    const { session } = setup();
    const [start, ...chunks] = chunksOf(content, id(8));
    session.receive(start);
    expect(session.sent.filter((body) => body.t === 'CLIP_SKIP')).toHaveLength(0);
    for (const chunk of chunks) session.receive(chunk);
    // The same image offered again (e.g. forwarded by another device): stop sending it.
    session.receive(start);
    expect(session.sent).toContainEqual({ t: 'CLIP_SKIP', clipId: id(8) });
  });

  it('stops sending chunks after CLIP_SKIP and paces the rest', async () => {
    const { clock, session } = setup();
    session.sent.length = 0;
    // Make the engine send an image by letting it answer a history request.
    const sync = new SyncEngine(
      {
        selfId: phone.device.id,
        settings: () => ({
          sendEnabled: true,
          receiveEnabled: true,
          applyToClipboard: false,
          notifyOnReceive: false,
        }),
        findMember: (memberId) =>
          testGroup.membership.members.find((member) => member.id === memberId),
      },
      {
        clock,
        random,
        logger: new MemoryLogger(),
        clipboard: new FakeClipboard(),
        notifier: new FakeNotifier(),
      },
    );
    const peer = new FakeSession(laptop.device);
    sync.attach(peer);
    const big = image(IMAGE_CHUNK_BYTES * 10) as ImageContent;
    const sent = sync.sendClip(big);
    if (!sent.ok) throw new Error('send failed');
    const chunkCount = (): number => peer.sent.filter((body) => body.t === 'CLIP_CHUNK').length;
    expect(peer.sent.some((body) => body.t === 'CLIP_START')).toBe(true);
    expect(chunkCount()).toBe(0); // nothing until the pump runs
    await clock.advance(5);
    expect(chunkCount()).toBe(4);
    peer.receive({ t: 'CLIP_SKIP', clipId: sent.value.id });
    await clock.advance(100);
    expect(chunkCount()).toBe(4);
  });

  it('ignores chunks for unknown transfers', () => {
    const { clipboard, session } = setup();
    session.receive({ t: 'CLIP_CHUNK', clipId: id(7), index: 0, data: 'AAAA' });
    expect(clipboard.writes).toEqual([]);
  });
});

export type { DeviceId };
