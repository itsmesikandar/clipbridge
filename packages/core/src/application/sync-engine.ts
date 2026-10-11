/**
 * Clip flow between this device and its sessions (docs/PLAN.md §10, M1 §2.1).
 *
 * - Local copies become clips and go to every connected peer.
 * - Received clips are forwarded to every other peer (flooding), deduplicated by id,
 *   so any topology works (phone → desktop → other phone).
 * - Newest wins: a clip older than the last local copy is stored but not applied.
 * - Loop prevention: a clip written to the clipboard is not picked up again as a copy.
 */

import { computeContentHash } from '../crypto/content-hash';
import {
  type Clip,
  type ClipContent,
  compareClipRecency,
  isEmptyContent,
  validateContentSize,
} from '../domain/clip';
import type { DeviceRecord } from '../domain/device';
import { type AppError, appError } from '../domain/errors';
import { type ClipId, createClipId, type DeviceId } from '../domain/ids';
import { err, ok, type Result } from '../domain/result';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import { concatBytes } from '../lib/bytes';
import type { ClipboardChange, ClipboardPort } from '../ports/clipboard';
import type { Cancel, ClockPort } from '../ports/clock';
import type { LoggerPort } from '../ports/logger';
import type { NotifierPort } from '../ports/notifier';
import type { RandomPort } from '../ports/random';
import type { Unsubscribe } from '../ports/transport';
import {
  type Body,
  IMAGE_CHUNK_BYTES,
  type ImageHeader,
  MAX_HISTORY_CLIPS,
  type WireClip,
} from '../protocol/frames';
import { clipFromWire, clipToWire } from '../protocol/wire';
import { BoundedSet } from './bounded-set';
import {
  ClipHistory,
  type ClipHistoryOptions,
  DEFAULT_HISTORY_OPTIONS,
  type HistoryEntry,
} from './clip-history';
import type { PeerSession } from './peer-session';
import { createStore, type ReadonlyStore } from './store';

export interface SyncSettings {
  /** Send local copies to other devices. */
  readonly sendEnabled: boolean;
  /** Accept clips from other devices. */
  readonly receiveEnabled: boolean;
  /** Write received clips to the clipboard automatically (desktops). */
  readonly applyToClipboard: boolean;
  /** Tell the user when a clip arrives. */
  readonly notifyOnReceive: boolean;
}

export interface SyncEngineDeps {
  readonly clock: ClockPort;
  readonly random: RandomPort;
  readonly logger: LoggerPort;
  readonly clipboard: ClipboardPort;
  readonly notifier: NotifierPort;
}

export interface SyncEngineOptions {
  readonly selfId: DeviceId;
  readonly settings: () => SyncSettings;
  readonly findMember: (id: DeviceId) => DeviceRecord | undefined;
  readonly history?: ClipHistoryOptions;
}

const SEEN_CAPACITY = 500;
/** A peer clock more than a day ahead is treated as wrong and does not move ours. */
const MAX_CLOCK_AHEAD_MS = 24 * 60 * 60 * 1000;
/** A chunked image must complete within this time. */
const ASSEMBLY_TIMEOUT_MS = 30_000;
const MAX_ASSEMBLIES_PER_PEER = 2;
/** Chunks are sent a few at a time so heartbeats and CLIP_SKIP get through. */
const CHUNKS_PER_TICK = 4;
const PUMP_INTERVAL_MS = 5;

interface OutgoingImage {
  readonly clip: Clip;
  readonly data: Uint8Array;
  readonly chunks: number;
  next: number;
}

interface ImageAssembly {
  readonly source: PeerSession;
  readonly header: ImageHeader;
  readonly parts: (Uint8Array | undefined)[];
  received: number;
  readonly cancelTimeout: Cancel;
}
/** Same content copied twice within this window counts as one copy. */
const DUPLICATE_COPY_WINDOW_MS = 2_000;

type Recency = Pick<Clip, 'createdAt' | 'origin'>;

export class SyncEngine {
  private readonly history: ClipHistory;
  private readonly historyStore = createStore<readonly HistoryEntry[]>([]);
  private readonly lastErrorStore = createStore<AppError | null>(null);
  private readonly seen = new BoundedSet<ClipId>(SEEN_CAPACITY);
  private readonly sessions = new Map<
    DeviceId,
    { session: PeerSession; unsubscribe: Unsubscribe }
  >();
  /** Images being received, by clip id (one source per image). */
  private readonly assemblies = new Map<ClipId, ImageAssembly>();
  /** Images being sent, per session. */
  private readonly outgoing = new Map<
    PeerSession,
    { queue: OutgoingImage[]; cancel: Cancel | null }
  >();
  /** Most recent clip that this device copied or applied. */
  private latest: Recency | null = null;
  /**
   * Hybrid logical clock for `createdAt`: never behind the newest clip seen, so
   * a copy made after receiving a clip is newer even if this device's clock is
   * behind (newest-wins stays correct with clock skew between devices).
   */
  private hlc = 0;
  private lastAppliedHash: string | null = null;
  private stopWatching: Unsubscribe | null = null;

  constructor(
    private readonly options: SyncEngineOptions,
    private readonly deps: SyncEngineDeps,
  ) {
    this.history = new ClipHistory(options.history ?? DEFAULT_HISTORY_OPTIONS);
  }

  get recentClips(): ReadonlyStore<readonly HistoryEntry[]> {
    return this.historyStore;
  }

  /** Last problem with sending a clip (e.g. too large); null after a successful send. */
  get lastError(): ReadonlyStore<AppError | null> {
    return this.lastErrorStore;
  }

  start(): void {
    if (this.stopWatching || !this.deps.clipboard.watch) return;
    this.stopWatching = this.deps.clipboard.watch((change) => {
      this.handleClipboardChange(change);
    });
  }

  stop(): void {
    this.stopWatching?.();
    this.stopWatching = null;
    for (const key of [...this.assemblies.keys()]) this.abortAssembly(key, null);
    for (const session of [...this.outgoing.keys()]) this.dropOutgoing(session);
    for (const { unsubscribe } of this.sessions.values()) unsubscribe();
    this.sessions.clear();
  }

  /** Starts syncing with a newly authenticated peer and asks it for missed clips. */
  attach(session: PeerSession): void {
    this.sessions.get(session.peer.id)?.unsubscribe();
    const unsubscribeBody = session.onBody((body) => {
      this.handleBody(session, body);
    });
    const unsubscribeClose = session.onClose(() => {
      this.dropOutgoing(session);
      for (const [clipId, assembly] of this.assemblies) {
        if (assembly.source === session) this.abortAssembly(clipId, null);
      }
      const current = this.sessions.get(session.peer.id);
      if (current?.session === session) this.sessions.delete(session.peer.id);
    });
    this.sessions.set(session.peer.id, {
      session,
      unsubscribe: () => {
        unsubscribeBody();
        unsubscribeClose();
      },
    });
    session.send({ t: 'HISTORY_REQ', since: 0 });
  }

  /** Sends content chosen explicitly by the user (share sheet, "Send clipboard"). */
  sendClip(content: ClipContent): Result<Clip, AppError> {
    return this.publishLocal(content);
  }

  clearHistory(): void {
    this.history.clear();
    this.historyStore.set(this.history.list());
  }

  /** Drops expired history entries. */
  prune(): void {
    if (this.history.prune(this.deps.clock.now())) this.historyStore.set(this.history.list());
  }

  // ------------------------------------------------------------------ local side

  private handleClipboardChange(change: ClipboardChange): void {
    if (change.sensitive) return;
    if (!this.options.settings().sendEnabled) return;
    const hash = computeContentHash(change.content);
    if (hash === this.lastAppliedHash) return; // our own write echoing back
    const newest = this.history.newest();
    if (
      newest?.origin === this.options.selfId &&
      newest.hash === hash &&
      this.deps.clock.now() - newest.createdAt < DUPLICATE_COPY_WINDOW_MS
    ) {
      return;
    }
    const result = this.publishLocal(change.content);
    if (!result.ok) {
      this.deps.logger.warn('local copy not sent', { code: result.error.code });
    }
  }

  private publishLocal(content: ClipContent): Result<Clip, AppError> {
    if (isEmptyContent(content)) {
      return err(appError('PROTOCOL_ERROR', 'empty clip', { reason: 'empty clip' }));
    }
    const sized = validateContentSize(content);
    if (!sized.ok) {
      this.lastErrorStore.set(sized.error);
      return sized;
    }
    const createdAt = this.nextTimestamp();
    const clip: Clip = {
      id: createClipId(createdAt, this.deps.random.randomBytes(10)),
      origin: this.options.selfId,
      createdAt,
      content,
      hash: computeContentHash(content),
    };
    this.seen.add(clip.id);
    this.latest = clip;
    this.storeInHistory(clip);
    this.lastErrorStore.set(null);
    this.broadcastClip(clip, null);
    return ok(clip);
  }

  // ------------------------------------------------------------------ remote side

  private handleBody(session: PeerSession, body: Body): void {
    switch (body.t) {
      case 'CLIP': {
        const clip = this.ingestWire(session, body.clip);
        session.send({ t: 'ACK', clipId: body.clip.id });
        if (clip) this.deliver(clip);
        return;
      }
      case 'CLIP_START':
        this.startAssembly(session, body.clip);
        return;
      case 'CLIP_CHUNK':
        this.addChunk(session, body.clipId as ClipId, body.index, body.data);
        return;
      case 'CLIP_SKIP':
        this.skipOutgoing(session, body.clipId as ClipId);
        return;
      case 'HISTORY_REQ': {
        // Text and links in one message; images are big, so only the newest one, in chunks.
        const clips = this.history.clipsSince(body.since, MAX_HISTORY_CLIPS);
        const newestImage = [...clips].reverse().find((clip) => clip.content.kind === 'image');
        session.send({
          t: 'HISTORY_RES',
          clips: clips.filter((clip) => clip.content.kind !== 'image').map(clipToWire),
          newestImage: newestImage
            ? { createdAt: newestImage.createdAt, origin: newestImage.origin }
            : null,
        });
        if (newestImage) this.sendClipTo(session, newestImage);
        return;
      }
      case 'HISTORY_RES': {
        let newest: Clip | null = null;
        for (const wire of body.clips) {
          const clip = this.ingestWire(session, wire);
          if (clip && (!newest || compareClipRecency(clip, newest) > 0)) newest = clip;
        }
        // Catching up must not replay every missed clip at the user; apply only the newest.
        // If a newer image is on its way, it will be delivered when it arrives.
        const image = body.newestImage;
        const imageIsNewer =
          image !== null &&
          newest !== null &&
          compareClipRecency(
            { createdAt: image.createdAt, origin: image.origin as DeviceId },
            newest,
          ) > 0;
        if (newest && !imageIsNewer) this.deliver(newest);
        return;
      }
      case 'ACK':
        if (this.history.markDelivered(body.clipId as ClipId, session.peer.id)) {
          this.historyStore.set(this.history.list());
        }
        return;
      case 'MEMBERSHIP':
      case 'KEY_ROTATE':
      case 'PING':
      case 'PONG':
        return; // handled elsewhere
    }
  }

  private ingestWire(source: PeerSession, wire: WireClip): Clip | null {
    if (this.seen.has(wire.id as ClipId)) return null;
    const parsed = clipFromWire(wire);
    if (!parsed.ok) {
      this.deps.logger.warn('dropping invalid clip', {
        peerId: source.peer.id,
        code: parsed.error.code,
      });
      return null;
    }
    return this.ingest(source, parsed.value);
  }

  /** Deduplicates, stores and forwards a validated clip. Returns it if it was new. */
  private ingest(source: PeerSession, clip: Clip): Clip | null {
    if (this.seen.has(clip.id)) return null;
    if (!this.options.findMember(clip.origin)) {
      this.deps.logger.warn('dropping clip from unknown origin', { peerId: source.peer.id });
      return null;
    }
    this.observeTimestamp(clip.createdAt);
    this.seen.add(clip.id);
    this.storeInHistory(clip);
    this.broadcastClip(clip, source.peer.id, clip.origin);
    return clip;
  }

  // ------------------------------------------------------------------ chunked images

  private startAssembly(source: PeerSession, header: ImageHeader): void {
    const clipId = header.id as ClipId;
    // Already have it, or another peer is sending it: ask this one to stop.
    if (this.seen.has(clipId) || this.assemblies.has(clipId)) {
      source.send({ t: 'CLIP_SKIP', clipId });
      return;
    }
    const inFlight = [...this.assemblies.values()].filter((a) => a.source === source).length;
    if (inFlight >= MAX_ASSEMBLIES_PER_PEER) {
      this.deps.logger.warn('too many images in flight', { peerId: source.peer.id });
      source.send({ t: 'CLIP_SKIP', clipId });
      return;
    }
    const cancelTimeout = this.deps.clock.schedule(ASSEMBLY_TIMEOUT_MS, () => {
      this.assemblies.delete(clipId);
      this.deps.logger.warn('image transfer timed out', { peerId: source.peer.id });
    });
    this.assemblies.set(clipId, {
      source,
      header,
      parts: new Array<Uint8Array | undefined>(header.chunks),
      received: 0,
      cancelTimeout,
    });
  }

  private addChunk(source: PeerSession, clipId: ClipId, index: number, data: string): void {
    const assembly = this.assemblies.get(clipId);
    if (assembly?.source !== source || index >= assembly.header.chunks || assembly.parts[index]) {
      return;
    }
    const bytes = base64ToBytes(data);
    if (!bytes || bytes.length > IMAGE_CHUNK_BYTES) {
      this.abortAssembly(clipId, 'invalid chunk');
      return;
    }
    assembly.parts[index] = bytes;
    assembly.received += 1;
    if (assembly.received < assembly.header.chunks) return;

    this.abortAssembly(clipId, null);
    const { header } = assembly;
    const image = concatBytes(
      ...assembly.parts.filter((part): part is Uint8Array => part !== undefined),
    );
    const content: ClipContent = { kind: 'image', mime: header.mime, data: image };
    const hash = computeContentHash(content);
    if (image.length !== header.size || hash !== header.hash) {
      this.deps.logger.warn('image failed integrity check', { peerId: source.peer.id });
      return;
    }
    const clip: Clip = {
      id: clipId,
      origin: header.origin as DeviceId,
      createdAt: header.createdAt,
      content,
      hash,
    };
    const fresh = this.ingest(source, clip);
    source.send({ t: 'ACK', clipId });
    if (fresh) this.deliver(fresh);
  }

  private abortAssembly(clipId: ClipId, reason: string | null): void {
    const assembly = this.assemblies.get(clipId);
    if (!assembly) return;
    assembly.cancelTimeout();
    this.assemblies.delete(clipId);
    if (reason) this.deps.logger.warn('image transfer aborted', { reason });
  }

  /** Queues an image for a session and starts the chunk pump. */
  private queueImage(session: PeerSession, clip: Clip, data: Uint8Array): void {
    const chunks = Math.max(1, Math.ceil(data.length / IMAGE_CHUNK_BYTES));
    const state = this.outgoing.get(session) ?? { queue: [], cancel: null };
    state.queue.push({ clip, data, chunks, next: 0 });
    this.outgoing.set(session, state);
    state.cancel ??= this.deps.clock.schedule(PUMP_INTERVAL_MS, () => {
      this.pump(session);
    });
  }

  private pump(session: PeerSession): void {
    const state = this.outgoing.get(session);
    if (!state) return;
    state.cancel = null;
    let budget = CHUNKS_PER_TICK;
    while (budget > 0 && state.queue.length > 0 && !session.isClosed) {
      const item = state.queue[0];
      if (!item) break;
      const start = item.next * IMAGE_CHUNK_BYTES;
      const slice = item.data.subarray(start, start + IMAGE_CHUNK_BYTES);
      session.send({
        t: 'CLIP_CHUNK',
        clipId: item.clip.id,
        index: item.next,
        data: bytesToBase64(slice),
      });
      item.next += 1;
      budget -= 1;
      if (item.next >= item.chunks) state.queue.shift();
    }
    if (state.queue.length === 0 || session.isClosed) {
      this.outgoing.delete(session);
      return;
    }
    state.cancel = this.deps.clock.schedule(PUMP_INTERVAL_MS, () => {
      this.pump(session);
    });
  }

  private skipOutgoing(session: PeerSession, clipId: ClipId): void {
    const state = this.outgoing.get(session);
    if (!state) return;
    const remaining = state.queue.filter((item) => item.clip.id !== clipId);
    state.queue.splice(0, state.queue.length, ...remaining);
  }

  private dropOutgoing(session: PeerSession): void {
    this.outgoing.get(session)?.cancel?.();
    this.outgoing.delete(session);
  }

  // ------------------------------------------------------------------ delivery

  private deliver(clip: Clip): void {
    const settings = this.options.settings();
    if (!settings.receiveEnabled || clip.origin === this.options.selfId) return;
    if (this.latest && compareClipRecency(clip, this.latest) <= 0) return;
    this.latest = clip;

    if (settings.applyToClipboard) {
      this.lastAppliedHash = clip.hash;
      void this.deps.clipboard.write(clip.content).then((written) => {
        if (!written.ok)
          this.deps.logger.warn('clipboard write failed', { code: written.error.code });
      });
    }
    if (settings.notifyOnReceive) {
      this.deps.notifier.clipReceived(clip, this.options.findMember(clip.origin));
    }
  }

  private broadcastClip(clip: Clip, exceptPeer: DeviceId | null, exceptOrigin?: DeviceId): void {
    for (const [peerId, { session }] of this.sessions) {
      if (peerId === exceptPeer || peerId === exceptOrigin || session.isClosed) continue;
      this.sendClipTo(session, clip);
    }
  }

  /** Text and links in one CLIP message; images as CLIP_START, then paced CLIP_CHUNKs. */
  private sendClipTo(session: PeerSession, clip: Clip): void {
    const { content } = clip;
    if (content.kind !== 'image') {
      session.send({ t: 'CLIP', clip: clipToWire(clip) });
      return;
    }
    session.send({
      t: 'CLIP_START',
      clip: {
        id: clip.id,
        origin: clip.origin,
        createdAt: clip.createdAt,
        kind: 'image',
        mime: content.mime,
        size: content.data.length,
        hash: clip.hash,
        chunks: Math.max(1, Math.ceil(content.data.length / IMAGE_CHUNK_BYTES)),
      },
    });
    this.queueImage(session, clip, content.data);
  }

  private nextTimestamp(): number {
    this.hlc = Math.max(this.deps.clock.now(), this.hlc + 1);
    return this.hlc;
  }

  /** Moves the logical clock forward; ignores clocks set far in the future. */
  private observeTimestamp(createdAt: number): void {
    if (createdAt - this.deps.clock.now() > MAX_CLOCK_AHEAD_MS) return;
    this.hlc = Math.max(this.hlc, createdAt);
  }

  private storeInHistory(clip: Clip): void {
    if (this.history.add(clip)) this.historyStore.set(this.history.list());
  }
}
