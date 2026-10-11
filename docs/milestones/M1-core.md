# M1 — Shared Core

**Goal:** all the "brain" of ClipBridge in `packages/core`: domain model, protocol, crypto, sync engine, peer management, error diagnosis. Pure TypeScript, no UI, no real network — proven by tests.

**Depends on:** M0.

---

## 1. What we build

| Module                | Content                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/`             | `Clip`, `Device`, `Group`, value objects (`DeviceId`, `ClipId`, `KeyEpoch`), `AppError` + all error codes from PLAN §9.3, `Result<T, E>` helper                   |
| `ports/`              | `ClipboardPort`, `TransportPort`, `DiscoveryPort`, `SecureStoragePort`, `StoragePort`, `NotifierPort`, `NetworkInfoPort`, `LoggerPort`, `ClockPort`, `RandomPort` |
| `protocol/`           | zod schemas for all frames (PLAN §7), `encodeFrame` / `decodeFrame`, version check                                                                                |
| `crypto/`             | AEAD (XChaCha20-Poly1305), HKDF, HMAC, Ed25519, X25519, seal/open to a public key, handshake                                                                      |
| `application/`        | `SyncEngine`, `PeerManager`, `ConnectionStatusService`, `ClipHistory`, `Membership` (data part only; pairing UI flows come in M3)                                 |
| `packages/test-utils` | `InMemoryNetwork` (connects N engines), `FakeClock`, `FakeClipboard`, fixtures                                                                                    |

## 2. How it works

### 2.1 Clip lifecycle inside the engine

```
ClipboardPort.onChange(content)
  → classify (text | url | image), hash (SHA-256)
  → skip if hash == lastAppliedHash (loop prevention) or sensitive or over limit
  → Clip { id: UUIDv7, origin: self, createdAt: now }
  → history.add(clip); seen.add(clip.id)
  → for each connected peer: send CLIP (encrypted with session key)

Transport.onFrame(peer, CLIP)
  → decrypt + validate schema
  → if seen.has(id): drop
  → seen.add(id); history.add(clip)
  → forward to all connected peers except `peer`
  → if receive enabled and clip newer than last local copy:
        desktop: ClipboardPort.write(clip); lastAppliedHash = clip.hash
        phone:   NotifierPort.show(clip)
  → send ACK
```

### 2.2 Handshake (crypto/handshake.ts)

Pure functions over byte arrays, so they are tested without any network:

1. `createHello(identity, epoch)` → `{ nonce, hello }`
2. `createAuth(groupKey, identity, transcript, role)` → `{ mac, sig }`
3. `verifyAuth(groupKey, members, transcript, auth)` → `Result<PeerIdentity, AUTH_FAILED>`
4. `deriveSessionKey(groupKey, nonceA, nonceB)` → 32 bytes

### 2.3 PeerManager

One state machine per peer: `DISCOVERED → CONNECTING → HANDSHAKING → CONNECTED → (CLOSED → backoff → CONNECTING)`. Handles:

- dial rules (desktop-desktop: smaller id dials; phone always dials),
- exponential backoff with jitter (1 s → 30 s cap),
- heartbeats (15 s ping, 2 misses = dead),
- maps every failure to an `AppError` (`PEER_UNREACHABLE`, `AUTH_FAILED`, `VERSION_MISMATCH`, …) and stores it as the peer's `lastError`.

### 2.4 ConnectionStatusService (the diagnosis brain)

Input: network info (IP, subnet, Wi-Fi on), paired members with `lastSeenNetwork`, discovered peers, per-peer state and last error.
Output: one overall status + one primary `AppError` with fix steps. Rules are a pure function `diagnose(snapshot) → Diagnosis`, so every error case in PLAN §9.3 is a unit test. Example rules, in priority order:

1. no LAN interface → `NO_NETWORK`
2. no members → `NOT_PAIRED`
3. 0 connected, 0 discovered, current subnet differs from all members' last subnet → `DIFFERENT_NETWORK`
4. 0 connected, members discovered, all failing with timeout → `PEER_UNREACHABLE`
5. 0 connected, 0 discovered, same subnet, last-known IPs fail → `NO_PEERS` (after 10 s) / `NETWORK_ISOLATION` (after 30 s and repeated)
6. phone, 0 desktops connected → `NO_DESKTOP_ONLINE`
7. some connected → `PARTIAL` / `CONNECTED`

### 2.5 Public API (index.ts)

```ts
const engine = createEngine({ platform, ports, settings });
engine.start();
engine.stop();
engine.status$; // observable overall status + diagnosis
engine.peers$; // observable per-peer state
engine.history$; // observable recent clips
engine.sendClip(content); // used by phones (share sheet)
engine.setReceiveEnabled(boolean);
```

Observables are a tiny internal `Store<T>` (subscribe/get) — no RxJS dependency.

## 3. Tasks

- [ ] `Result`, `AppError`, error code enum + metadata (title key, message key, fix-step keys)
- [ ] Domain entities + validation
- [ ] Ports (interfaces only, documented)
- [ ] Protocol schemas + codec + version check
- [ ] Crypto primitives with official test vectors
- [ ] Handshake functions
- [ ] Seal/open for key rotation
- [ ] `ClipHistory` (bounded, TTL) and seen-id cache (LRU 500)
- [ ] `SyncEngine` (send, receive, forward, dedupe, loop prevention, newest-wins, limits)
- [ ] `PeerManager` (state machine, backoff, heartbeat)
- [ ] `ConnectionStatusService` + `diagnose()` rules
- [ ] `createEngine` composition + `Store<T>`
- [ ] Test utils: `InMemoryNetwork`, `FakeClock`, `FakeClipboard`

## 4. Tests (must exist)

- Crypto: encrypt/decrypt round trip, tamper detection (header, nonce, ciphertext), vectors.
- Codec: valid frames pass, every malformed frame is rejected, unknown version → `VERSION_MISMATCH`.
- Handshake: success; wrong group key; non-member identity; replayed nonce.
- Sync with 5 engines (3 desktop, 2 phone) on `InMemoryNetwork`: clip from any device reaches all others exactly once; no loops; phone → phone through desktop; newest wins under concurrent copies.
- PeerManager: backoff timings with `FakeClock`; heartbeat timeout.
- `diagnose()`: one test per row of PLAN §9.3.

## 5. Definition of Done

- `pnpm --filter @clipbridge/core test` green, coverage ≥ 90 %.
- No platform imports in core (lint enforced).
- Public API documented in `packages/core/README.md`.
