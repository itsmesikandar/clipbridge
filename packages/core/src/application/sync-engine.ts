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
import type { ClipboardChange, ClipboardPort } from '../ports/clipboard';
import type { ClockPort } from '../ports/clock';
import type { LoggerPort } from '../ports/logger';
import type { NotifierPort } from '../ports/notifier';
import type { RandomPort } from '../ports/random';
import type { Unsubscribe } from '../ports/transport';
import { type Body, MAX_HISTORY_CLIPS, type WireClip } from '../protocol/frames';
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
  /** Most recent clip that this device copied or applied. */
  private latest: Recency | null = null;
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
    const clip: Clip = {
      id: createClipId(this.deps.clock.now(), this.deps.random.randomBytes(10)),
      origin: this.options.selfId,
      createdAt: this.deps.clock.now(),
      content,
      hash: computeContentHash(content),
    };
    this.seen.add(clip.id);
    this.latest = clip;
    this.storeInHistory(clip);
    this.lastErrorStore.set(null);
    this.broadcast({ t: 'CLIP', clip: clipToWire(clip) }, null);
    return ok(clip);
  }

  // ------------------------------------------------------------------ remote side

  private handleBody(session: PeerSession, body: Body): void {
    switch (body.t) {
      case 'CLIP': {
        const clip = this.ingest(session, body.clip);
        session.send({ t: 'ACK', clipId: body.clip.id });
        if (clip) this.deliver(clip);
        return;
      }
      case 'HISTORY_REQ': {
        const clips = this.history.clipsSince(body.since, MAX_HISTORY_CLIPS).map(clipToWire);
        session.send({ t: 'HISTORY_RES', clips });
        return;
      }
      case 'HISTORY_RES': {
        let newest: Clip | null = null;
        for (const wire of body.clips) {
          const clip = this.ingest(session, wire);
          if (clip && (!newest || compareClipRecency(clip, newest) > 0)) newest = clip;
        }
        // Catching up must not replay every missed clip at the user; apply only the newest.
        if (newest) this.deliver(newest);
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

  /** Validates, deduplicates, stores and forwards a clip. Returns it if it was new. */
  private ingest(source: PeerSession, wire: WireClip): Clip | null {
    if (this.seen.has(wire.id as ClipId)) return null;
    if (!this.options.findMember(wire.origin as DeviceId)) {
      this.deps.logger.warn('dropping clip from unknown origin', { peerId: source.peer.id });
      return null;
    }
    const parsed = clipFromWire(wire);
    if (!parsed.ok) {
      this.deps.logger.warn('dropping invalid clip', {
        peerId: source.peer.id,
        code: parsed.error.code,
      });
      return null;
    }
    const clip = parsed.value;
    this.seen.add(clip.id);
    this.storeInHistory(clip);
    this.broadcast({ t: 'CLIP', clip: wire }, source.peer.id, clip.origin);
    return clip;
  }

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

  private broadcast(body: Body, exceptPeer: DeviceId | null, exceptOrigin?: DeviceId): void {
    for (const [peerId, { session }] of this.sessions) {
      if (peerId === exceptPeer || peerId === exceptOrigin || session.isClosed) continue;
      session.send(body);
    }
  }

  private storeInHistory(clip: Clip): void {
    if (this.history.add(clip)) this.historyStore.set(this.history.list());
  }
}
