# M1 — Shared Core

**Status:** ✅ Done — 158 tests, 95.8 % line coverage.

**Goal:** all the "brain" of ClipBridge in `packages/core`: domain model, protocol, crypto, sync engine, peer management, error diagnosis. Pure TypeScript, no UI, no real network — proven by tests.

**Depends on:** M0.

---

## 1. What we build

| Module         | Content                                                                                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/`         | base64, UTF-8, byte helpers, canonical JSON — no platform APIs (Hermes lacks `TextDecoder`)                                                                           |
| `domain/`      | `Clip`, `DeviceRecord`, `Membership`, `NetworkSnapshot`, `PeerView`, `ConnectionStatus`, ids (`DeviceId`, `ClipId` = UUIDv7), `AppError` with typed details, `Result` |
| `ports/`       | `ClipboardPort`, `TransportPort`, `DiscoveryPort`, `SecureStoragePort`, `StoragePort`, `NotifierPort`, `NetworkInfoPort`, `LoggerPort`, `ClockPort`, `RandomPort`     |
| `crypto/`      | AEAD (XChaCha20-Poly1305), HKDF, HMAC, SHA-256, Ed25519, X25519, sealed box, group tag, content hash                                                                  |
| `protocol/`    | zod schemas for all frames and bodies (PLAN §7), codec with version check, handshake, `SecureChannel`, wire conversion                                                |
| `application/` | `PeerSession`, `PeerManager`, `SyncEngine`, `ClipHistory`, membership service, `diagnose()`, `createEngine()`                                                         |
| `testing/`     | `InMemoryNetwork` (subnets, firewalls, app closed), `FakeClock`, `FakeClipboard`, `FakeNotifier`, `MemoryLogger`, `SeededRandom`, fixtures, `TestHarness`             |

## 2. How it works

### 2.1 Clip lifecycle inside the engine

```
ClipboardPort.watch(change)                 (desktop) — or engine.sendClip(content) (phone share)
  → skip if sensitive, sending disabled, empty, or hash == lastAppliedHash (our own write)
  → skip if the same content was copied < 2 s ago
  → check size limits → PAYLOAD_TOO_LARGE
  → Clip { id: UUIDv7, origin: self, createdAt: now, hash }
  → history + seen-ids; send CLIP to every session

Session body CLIP from peer P
  → seen? → only ACK
  → origin must be a member; schema + size valid; hash recomputed
  → store in history; forward to every session except P and the origin
  → if receive enabled and newer than the latest clip on this device:
        desktop: write to clipboard (and remember hash → no echo)
        phone:   NotifierPort.clipReceived (user taps Copy / Open)
  → ACK to P (sender marks "delivered")

On every new session: HISTORY_REQ → HISTORY_RES; only the newest missed clip is applied/notified.
```

### 2.2 Handshake and secure channel (`protocol/`)

Pure functions, tested without any network: `createHello`, `handshakeTranscript`, `createAuth`, `verifyPeerAuth` (epoch, id ↔ key, member list, MAC, signature), `deriveSessionKeys` (one key per direction). `SecureChannel` seals bodies into `SEC` frames with strictly increasing sequence numbers. Details: PLAN §7.1, §8.3.

### 2.3 PeerSession and PeerManager

- `establishSession()` runs the handshake on a transport connection (10 s timeout), answers bad input with an `ERROR` frame, then keeps the session alive with heartbeats (PING every 15 s, dead after 35 s silence).
- `PeerManager`: hubs listen and advertise; between hubs the smaller id dials; phones dial hubs. Uses discovered addresses and the last known address. Retries with backoff (1 s → 30 s, ±20 % jitter); network change retries immediately. Every failure is stored as the peer's `lastError`.

### 2.4 Diagnosis (`diagnose()`)

Pure function: network snapshot + permission + peer views + time searching → `ConnectionStatus { kind, connectedCount, peerCount, issue }`. Rules in priority order:

1. removed from group → `REMOVED_FROM_GROUP`
2. no Wi-Fi/LAN (or mobile data only) → `NO_NETWORK`
3. iOS Local Network denied → `LOCAL_NETWORK_PERMISSION`
4. no other members → `NOT_PAIRED`
5. some connected → `CONNECTED` / `PARTIAL` (phones count only computers)
6. phone in a group without computers → `NO_DESKTOP_ONLINE`
7. a peer failed with `VERSION_MISMATCH` or `AUTH_FAILED` → that error
8. a discovered peer cannot be reached → `PEER_UNREACHABLE` (firewall, VPN)
9. less than 10 s searching → `SEARCHING`
10. all known peers were last seen on another subnet → `DIFFERENT_NETWORK` (with both subnets)
11. otherwise → `NO_DESKTOP_ONLINE` (phone) / `NO_PEERS` (computer)

### 2.5 Public API

```ts
const engine = createEngine({ self, group, ports, settings, onMembershipChanged });
await engine.start(); // Result: PORT_IN_USE, LOCAL_NETWORK_PERMISSION, …
engine.status; // ReadonlyStore<ConnectionStatus>
engine.peers; // ReadonlyStore<PeerView[]>
engine.history; // ReadonlyStore<HistoryEntry[]>
engine.lastSendError; // ReadonlyStore<AppError | null>
engine.sendClip(content); // phones: share sheet
engine.updateSettings({ sendEnabled, receiveEnabled, applyToClipboard, notifyOnReceive });
await engine.stop();
```

Stores are a tiny `get` / `subscribe` observable — no RxJS.

## 3. Tasks

- [x] `Result`, `AppError` with typed details per code
- [x] Domain entities + validation
- [x] Ports (interfaces only, documented)
- [x] Protocol schemas + codec + version check
- [x] Crypto primitives with official test vectors (FIPS 180-2, RFC 4231, RFC 8032, RFC 7748)
- [x] Handshake functions + `SecureChannel`
- [x] Sealed box for key rotation
- [x] `ClipHistory` (bounded, TTL) and seen-id cache (500)
- [x] `SyncEngine` (send, receive, forward, dedupe, loop prevention, newest-wins, limits, catch-up, ACK)
- [x] `PeerManager` (dial rules, backoff, heartbeat via sessions, last known address)
- [x] `diagnose()` rules
- [x] `createEngine` composition + stores, membership exchange and removal
- [x] Test doubles in `@clipbridge/core/testing`

## 4. Tests

| File                         | Covers                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `lib/lib.test.ts`            | base64 (RFC 4648 vectors), UTF-8 incl. invalid input, bytes, canonical JSON                                   |
| `domain/domain.test.ts`      | URL detection, size limits, recency order, UUIDv7, roles, subnets                                             |
| `crypto/crypto.test.ts`      | known-answer vectors, AEAD tamper detection, signatures, sealed box, group tag                                |
| `protocol/protocol.test.ts`  | codec, version mismatch, handshake failures (wrong key, epoch, outsider, impostor, replay), replay protection |
| `application/*.test.ts`      | backoff, history, membership merge, one test per diagnosis rule, session timeouts and heartbeats              |
| `application/engine.test.ts` | 3 laptops + 2 phones end to end; ownership (colleague, intruder, removed device); every network failure       |

## 5. Decisions made during M1

- **Test doubles live in `@clipbridge/core/testing`**, not a separate `test-utils` package: test-utils needs core and core's tests need test-utils, which is a circular dependency. The subpath export keeps them platform-neutral and usable by app tests too.
- **Error texts live in the apps** (M2+). Core only defines codes and typed details; apps map them to titles, messages and fix steps.
- **`NETWORK_ISOLATION` is not detected automatically yet.** With nothing discovered on the same subnet, "Wi-Fi blocks devices" and "the other app is closed" look identical. M1 reports `NO_PEERS` / `NO_DESKTOP_ONLINE`, and the fix steps mention guest Wi-Fi. M7 adds a real check.
- **Persistence of history and per-peer "last seen"** is in memory for now; the desktop and mobile apps persist via `StoragePort` in M2/M4.

## 6. Definition of Done

- [x] `pnpm --filter @clipbridge/core test` green, coverage ≥ 90 % (enforced by Vitest thresholds).
- [x] No platform imports in core (lint enforced).
- [x] Desktop build and Android JS bundle include the new core (noble + zod) without errors.
- [x] Public API documented in `packages/core/README.md`.
- [ ] Runtime check of crypto on a real phone (Hermes) — first happens in M4.
