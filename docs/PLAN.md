# ClipBridge — Master Plan

> Working name: **ClipBridge**. Rename later if you want; only the app id, mDNS service name and display strings change.

Copy something on one device, paste it on another. Text, URLs and images. Laptops and phones. Windows, macOS, Android and iOS. **Local network only — no cloud, no account, no server.**

---

## 1. Goals and non-goals

### 1.1 Goals (MVP)

1. Sync **text, URLs and images** between all devices in a user's **group**.
2. Work in **every OS combination**: Windows/macOS desktops with Android/iOS phones, in any mix (e.g. 3 laptops + 2 phones).
3. Run **only on the local network (same Wi-Fi / LAN)**. Nothing leaves the LAN. No cloud relay, no push service, no account.
4. **Ownership:** only devices the user explicitly paired receive clips. Other people on the same Wi-Fi see nothing and can read nothing.
5. **Clear errors:** when something is wrong (no Wi-Fi, different network, firewall, device offline, unpaired…), the user sees what is wrong **and how to fix it**.
6. Industry-standard code: strict TypeScript, clean architecture, tested core, consistent tooling.

### 1.2 Non-goals (MVP)

- Sync over the internet or between different networks. (Explicitly out: user requirement is LAN only.)
- Files other than images (PDF, zip, …).
- Clipboard history search, pinning, rich text/HTML formatting.
- Linux desktop (architecture allows it later; not tested in MVP).
- App store publishing (we produce installable builds; store release is a later decision).

---

## 2. How it works — one-page overview

```
┌──────────── Device A ────────────┐                 ┌──────────── Device B ────────────┐
│ User copies                      │                 │                                  │
│   ↓                              │                 │                                  │
│ Clipboard adapter (OS-specific)  │                 │ Clipboard adapter (OS-specific)  │
│   ↓                              │                 │   ↑ write / notify               │
│ Sync engine (shared core)        │                 │ Sync engine (shared core)        │
│   ↓ encrypt with group key       │   Same LAN      │   ↑ decrypt, dedupe              │
│ Transport (WebSocket over LAN)  ─┼────────────────►┼─ Transport (WebSocket over LAN)  │
└──────────────────────────────────┘                 └──────────────────────────────────┘
          ▲  Discovery (mDNS / Bonjour) finds peers on the same network  ▲
```

1. **Discovery:** every running app announces itself on the LAN using mDNS (`_clipbridge._tcp`). Apps find each other automatically. No IP typing.
2. **Pairing:** a new device joins the group by scanning a QR code (phone) or typing a pairing code (laptop). It receives the **group key**.
3. **Connection:** paired devices open WebSocket connections and prove to each other that they hold the group key. Anyone else is rejected.
4. **Sync:** on copy, the clip is encrypted and sent to all connected peers. Each peer forwards it to its other peers (so phone → laptop → other phone works). Duplicates are dropped by clip id.
5. **Delivery:** desktops write the clip to the clipboard automatically. Phones show a notification (Android) or the clip on app open (iOS) with **Copy / Open** buttons.

---

## 3. Platform reality (important constraints)

These are OS rules, not design choices. The whole design works around them.

| Topic                                | Windows / macOS                                     | Android                                                | iOS                                                            |
| ------------------------------------ | --------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Read clipboard in background         | ✅ Yes (poll)                                       | ❌ Blocked since Android 10                            | ❌ Blocked                                                     |
| How user **sends** from device       | Automatic on copy                                   | Share sheet → ClipBridge (later: Quick Settings tile)  | Share sheet → ClipBridge                                       |
| Keep a LAN connection in background  | ✅ Yes (tray app)                                   | ✅ With a foreground service (persistent notification) | ❌ Suspended ~30 s after backgrounding                         |
| How user **receives** on device      | Written to clipboard automatically + optional toast | Local notification with **Copy / Open**                | Latest clips shown when app is opened, one tap **Copy / Open** |
| Accept incoming connections (server) | ✅ Yes                                              | ✅ Yes (foreground service) — not used in MVP          | ❌ Not reliably                                                |
| mDNS discovery                       | `bonjour-service` (Node)                            | `NsdManager` + multicast lock                          | `NetService`, needs Local Network permission                   |

### Consequences for the design

- **Desktops are hubs.** Desktops listen for connections. Phones connect _to_ desktops.
- **Phone ↔ phone needs at least one desktop online** in MVP (the desktop forwards). Documented in the UI ("No desktop online" state).
- **iOS without a cloud cannot get real-time push in the background.** With LAN-only, iOS receives when the app is opened (it catches up from desktop history). A later milestone evaluates Apple's **Local Push Connectivity** (works without internet on a specific Wi-Fi, needs an Apple entitlement).
- **Sending from a phone always costs one tap** (share sheet). This is true for every app on the market, not only ours.

---

## 4. Tech stack

| Layer       | Choice                                                                                                     | Why                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Language    | **TypeScript (strict)** everywhere                                                                         | One language; the shared core runs on desktop and mobile unchanged.                                                       |
| Monorepo    | **pnpm workspaces**                                                                                        | Fast, strict dependency isolation, standard for TS monorepos.                                                             |
| Shared core | Pure TS package `@clipbridge/core`                                                                         | Protocol, crypto, sync, pairing, errors. Zero platform imports.                                                           |
| Desktop     | **Electron** + React + Vite (`electron-vite`)                                                              | Main process is Node: can run a WebSocket server, mDNS and clipboard polling, and reuses the TS core directly.            |
| Mobile      | **React Native with Expo** (dev builds / prebuild) + React                                                 | One codebase for Android and iOS; share-sheet, camera, notifications, secure storage are available as maintained modules. |
| Transport   | WebSocket (`ws` on Node, built-in `WebSocket` on RN)                                                       | Simple, framed, bidirectional, works on every platform.                                                                   |
| Discovery   | mDNS / DNS-SD: `bonjour-service` (Node), `react-native-zeroconf` (RN)                                      | Standard zero-config LAN discovery.                                                                                       |
| Crypto      | `@noble/ciphers`, `@noble/curves`, `@noble/hashes`                                                         | Audited, pure JS, identical on Node and RN, no native build.                                                              |
| Validation  | `zod`                                                                                                      | Runtime validation of every network message.                                                                              |
| Tests       | Vitest (core, desktop main), Jest (`jest-expo`) for mobile                                                 | Standard runners per environment.                                                                                         |
| Quality     | ESLint (typescript-eslint), Prettier, dependency boundary rules, Husky + lint-staged, Conventional Commits | Consistent code and history.                                                                                              |
| Packaging   | `electron-builder` (NSIS for Windows, DMG for macOS), EAS local build / Gradle / Xcode for mobile          | Local builds; no cloud build service required.                                                                            |

> **Why not Tauri?** It was the first idea (smaller binary). But networking and mDNS would have to live in Rust, so the TS core could not be shared with mobile. Electron keeps one core in one language. Size can be revisited after MVP.

> **Runtime is 100 % local.** No analytics, no crash reporting service, no update server in MVP. Versions of all libraries are pinned to the latest stable at the time of Milestone 0.

---

## 5. Architecture

### 5.1 Clean architecture (ports and adapters)

```
            ┌────────────────────────────────────────────┐
            │  Presentation (React views + presenters)    │   apps/desktop/renderer, apps/mobile/src/features
            └───────────────────────┬────────────────────┘
                                    │ calls use cases, observes state
            ┌───────────────────────▼────────────────────┐
            │  Application (use cases, engine)            │   packages/core/src/application
            └───────────────────────┬────────────────────┘
                                    │ depends on interfaces only
            ┌───────────────────────▼────────────────────┐
            │  Domain (entities, value objects, rules)    │   packages/core/src/domain
            └─────────────────────────────────────────────┘
                                    ▲
                                    │ implements ports
            ┌───────────────────────┴────────────────────┐
            │  Infrastructure (adapters per platform)     │   apps/*/adapters
            │  clipboard, transport, discovery, storage,  │
            │  notifications, network info, logger, clock │
            └─────────────────────────────────────────────┘
```

**Dependency rule:** arrows point inward only. `domain` imports nothing. `application` imports `domain` and **ports** (interfaces). Adapters live in the apps and implement ports. This is enforced by ESLint boundary rules so a violation fails the build.

### 5.2 Presentation pattern

Views are dumb React components. Each screen has a **presenter hook** (`useDevicesPresenter`, `useConnectionStatusPresenter`, …) that maps engine state to view state and exposes user actions. This is the Model-View-Presenter idea applied to React: views never talk to the engine directly, and presenters are unit-testable without rendering.

### 5.3 Ports (interfaces in core)

| Port                       | Responsibility                    | Desktop adapter                | Mobile adapter                              |
| -------------------------- | --------------------------------- | ------------------------------ | ------------------------------------------- |
| `ClipboardPort`            | read, write, watch for changes    | Electron `clipboard` + polling | `expo-clipboard` (read only on user action) |
| `TransportPort`            | listen, dial, send/receive frames | `ws` server + client           | RN `WebSocket` client                       |
| `DiscoveryPort`            | advertise, browse peers           | `bonjour-service`              | `react-native-zeroconf`                     |
| `SecureStoragePort`        | store keys                        | Electron `safeStorage` + file  | `expo-secure-store`                         |
| `StoragePort`              | store devices, history, settings  | JSON files in `userData`       | `AsyncStorage`/file system                  |
| `NotifierPort`             | show user notification            | Electron `Notification`        | `expo-notifications` (local only)           |
| `NetworkInfoPort`          | current IP, subnet, Wi-Fi on/off  | Node `os.networkInterfaces()`  | `expo-network`                              |
| `LoggerPort`               | structured logs, no secrets       | file + console                 | console + ring buffer                       |
| `ClockPort` / `RandomPort` | time, random bytes                | Node                           | `expo-crypto`                               |

### 5.4 Core modules

```
packages/core/src/
  lib/                 platform-neutral helpers: base64, UTF-8, bytes, canonical JSON
  domain/              entities and rules, no dependencies on other layers
    clip.ts            Clip: id (UUIDv7), origin, createdAt, content (text|url|image), hash; size limits
    device.ts          DeviceRecord (public keys), platform → role (hub | client)
    membership.ts      signed member list + precedence rule
    network.ts         NetworkSnapshot, subnet helpers
    errors.ts          AppError taxonomy with typed details (see §9)
    status.ts          PeerView, ConnectionStatus
    ids.ts, result.ts
  crypto/              wrappers over @noble: AEAD, HKDF/HMAC, identity keys, sealed box, group tag
  protocol/
    frames.ts          zod schemas for every frame and encrypted body
    codec.ts           encode/decode + version check
    handshake.ts       mutual authentication (§8.3)
    secure-channel.ts  encrypted SEC frames with replay protection (§7.1)
    wire.ts            domain ↔ wire conversion
  application/
    peer-session.ts    handshake runner + heartbeat for one connection
    peer-manager.ts    discovery, dial rules, retries/backoff, per-peer state
    sync-engine.ts     send, receive, forward, dedupe, loop prevention, newest-wins, catch-up
    diagnose.ts        pure rules: peers + network → status + AppError (§9)
    membership-service.ts  sign / verify / merge member lists
    engine.ts          composition root of core; the API apps use
    pairing/           host and join state machines (Milestone 3)
  ports/               interfaces listed in §5.3
  testing/             test doubles (in-memory LAN, fake clock, fixtures) → `@clipbridge/core/testing`
  index.ts             public API only
```

### 5.5 Desktop app structure (Electron)

```
apps/desktop/src/
  main/                 Node side — composition root
    index.ts            app lifecycle, single instance lock, tray
    container.ts        builds engine with adapters (dependency injection by hand)
    adapters/           clipboard, transport, discovery, storage, notifier, network-info, logger
    ipc/                typed IPC handlers (one file per feature)
  preload/
    index.ts            exposes a typed, minimal API via contextBridge
  shared/
    ipc-contract.ts     IPC channel names + payload types (single source of truth)
  renderer/             React UI
    features/
      status/           status banner, troubleshooting panel
      devices/          device list, pair, unpair, rename
      history/          recent clips
      settings/
    components/         shared UI components
    app.tsx
```

Electron security baseline: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP, no remote content, validate every IPC payload with zod.

### 5.6 Mobile app structure (Expo)

```
apps/mobile/
  app/                  expo-router screens (thin, render feature views)
  src/
    container.ts        composition root
    adapters/           transport, discovery, clipboard, storage, notifier, network-info
    native/             Expo config plugins + small native modules (Android foreground service)
    features/
      status/ devices/ pairing/ history/ share/ settings/
    components/
```

---

## 6. Networking design

### 6.1 Discovery

- Service type: `_clipbridge._tcp.local`, default port **47821** (falls back to a random free port; the real port is advertised).
- TXT record (public on the LAN, so minimal):
  - `v` — protocol version
  - `did` — device id (random, not a name)
  - `gt` — group tag = first 8 bytes of `HMAC(groupKey, "group-tag")`. Lets a device ignore other groups without revealing anything.
  - `pm` — `1` when the device is in pairing mode.
- Device **names are never broadcast**; names are exchanged only after authentication.
- Fallback when mDNS is blocked: each device remembers the **last known IP:port** of every peer and tries it directly. Users can also add a peer by IP from the diagnostics screen.

### 6.2 Topology

- Desktops listen **and** dial. Between two desktops the one with the lexicographically smaller device id dials, so there is exactly one connection per pair.
- Phones only dial (to every desktop of the group they discover).
- **Forwarding (flooding with dedupe):** when a device receives a new clip, it forwards it to every connected peer except the one it came from. Every device remembers the last 500 clip ids and drops repeats. This makes any topology work: phone → desktop → other phone, laptop 1 → laptop 2 → phone, etc.

### 6.3 Connection lifecycle

```
DISCOVERED → CONNECTING → HANDSHAKING → CONNECTED
     ↑            │             │            │
     └── retry with backoff ◄───┴────────────┘ (on error / close)
```

- Backoff: 1 s, 2 s, 4 s … capped at 30 s, with jitter. Reset on success.
- Heartbeat: `PING` every 15 s; peer considered dead after 2 missed pongs.
- Every failure is mapped to an `AppError` code (see §9) so the UI can explain it.

---

## 7. Protocol

All frames are JSON over WebSocket. Binary data (images) is base64 inside the encrypted payload. Max raw frame size: 20 MB (lowered when images are chunked in M6).

### 7.1 Frames

Handshake frames are plain JSON (they contain nothing secret):

```jsonc
{ "v": 1, "t": "HELLO", "deviceId": "dev_…", "signPublicKey": "…", "nonce": "…", "epoch": 1, "role": "initiator" }
{ "v": 1, "t": "AUTH", "mac": "…", "sig": "…" }
{ "v": 1, "t": "ERROR", "code": "AUTH_FAILED", "message": "…" }
```

After the handshake every message is a `SEC` frame. The body type is inside the ciphertext, so an observer cannot tell a clip from a heartbeat:

```jsonc
{
  "v": 1,
  "t": "SEC",
  "s": 42, // sequence number per direction; must strictly increase (replay protection)
  "n": "base64…", // 24-byte random nonce
  "c": "base64…", // XChaCha20-Poly1305 ciphertext of the JSON body; "s" is associated data
}
```

Encrypted bodies: `CLIP { clip }`, `ACK { clipId }`, `HISTORY_REQ { since }`, `HISTORY_RES { clips }`, `MEMBERSHIP { membership }`, `PING { ts }`, `PONG { ts }`. A clip carries `id` (UUIDv7), `origin`, `createdAt` and its content; the receiver recomputes the hash.

### 7.2 Frame types

| Type                          | Direction       | Purpose                                                   |
| ----------------------------- | --------------- | --------------------------------------------------------- |
| `HELLO`                       | both            | version, device id, nonce, key epoch, identity public key |
| `AUTH`                        | both            | proof of group key + identity signature                   |
| `CLIP`                        | any             | a clip (text / url / image)                               |
| `ACK`                         | any             | receipt of a clip (for "delivered" indicators)            |
| `HISTORY_REQ` / `HISTORY_RES` | phone → desktop | catch up on clips since a timestamp                       |
| `MEMBERSHIP`                  | any             | signed member list with version number                    |
| `KEY_ROTATE`                  | any             | new group key, sealed to each member's public key         |
| `PAIR_*`                      | joiner ↔ host   | pairing flow (§8.2)                                       |
| `PING` / `PONG`               | any             | heartbeat                                                 |
| `ERROR`                       | any             | typed error code + message, then close                    |

### 7.3 Versioning

`v` is checked first. Unknown major version → `ERROR { code: "VERSION_MISMATCH" }` and both sides show "Update ClipBridge on <device>".

---

## 8. Security

### 8.1 Keys

| Key                                           | Where it lives               | Purpose                                            |
| --------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| Identity key pair (Ed25519 sign + X25519 box) | each device, secure storage  | proves "I am device X"; receives sealed secrets    |
| Group key (32 bytes) + epoch                  | every member, secure storage | encrypts all clips; proves group membership        |
| Session keys (one per direction)              | memory only                  | `HKDF(groupKey, salt = transcript)` per connection |

### 8.2 Pairing

**Phone joins (QR):**

1. User clicks **Add device** on a desktop. Desktop enters pairing mode for 2 minutes and shows a QR containing: host address(es) + port, host identity public key, a one-time 32-byte pairing token.
2. Phone scans, connects, performs an ephemeral X25519 key exchange, proves it knows the token (`HMAC(token, transcript)`).
3. Desktop shows **"Allow 'Pixel 8' to join?"** → user clicks **Allow**.
4. Desktop sends the group key + member list, encrypted with the pairing session key. Phone's identity key is added to the member list; the updated list is broadcast to the group.

**Laptop joins (code):** same flow, but the host shows a 12-character code (`K7QM-2XPA-9FRT`, ~60 bits) instead of a QR; the joiner finds the host via mDNS (`pm=1`) and types the code. 3 wrong attempts cancel the session.

**Any member can add devices.** Pairing tokens are single-use and expire after 2 minutes.

### 8.3 Connection authentication

1. The dialer (initiator) sends `HELLO`; the responder answers with its own `HELLO`. Each contains a fresh 32-byte nonce, the device id, signing public key and key epoch.
2. Both compute `transcript = SHA-256(label ‖ both HELLOs' fields, length-prefixed, initiator first)`.
3. Each side sends `AUTH = { mac: HMAC(groupKey, label ‖ role ‖ transcript), sig: Ed25519(label ‖ role ‖ transcript) }`.
4. Each side checks: same epoch; device id = hash of the signing key; device is in the current signed member list with that key; MAC valid (holds the group key); signature valid. Otherwise `ERROR AUTH_FAILED` and close.
5. Both derive two keys (initiator→responder, responder→initiator) with HKDF over the group key and transcript, so frames cannot be reflected back.
6. Heartbeat: `PING` every 15 s; the connection is dropped after 35 s of silence.

### 8.4 Unpair and key rotation

1. User removes a device from any member.
2. That member creates a new group key (`epoch + 1`), seals it separately to each remaining member's X25519 key, broadcasts a signed `MEMBERSHIP` (without the removed device) and `KEY_ROTATE`.
3. The removed device cannot decrypt the new key and is rejected at handshake (not a member).
4. Members that were offline: on reconnect at an old epoch, a current member re-sends their sealed key before normal sync.

### 8.5 Data handling

- Clips are encrypted on the wire. Plain WebSocket (`ws://`) is acceptable because payloads are end-to-end encrypted and authenticated.
- History stored on disk is limited (default 20 clips, 7 days) and can be cleared from settings.
- Logs never contain clip contents or keys.
- Clipboard content marked by the OS as sensitive (e.g. password managers on macOS use `org.nspasteboard.ConcealedType`, Windows `ExcludeClipboardContentFromMonitorProcessing`) is **not** synced.

---

## 9. Error handling and user-facing diagnostics

### 9.1 Principles

- Every expected failure has a **code**, a **title**, a **plain-language message**, and **fix steps**.
- Expected failures are returned as typed results (`Result<T, AppError>`); exceptions are reserved for bugs.
- The UI always shows one **overall status** (top banner) plus **per-device status** (device list).
- A **Troubleshoot** button on every error opens a checklist and a **Diagnostics** screen: this device's IP and subnet, port, Wi-Fi state, discovered devices, last error per peer, "Copy diagnostics" button.

### 9.2 Overall status

| Status       | Banner text (example)                       |
| ------------ | ------------------------------------------- |
| `CONNECTED`  | "Connected to 3 devices"                    |
| `PARTIAL`    | "Connected to 2 of 4 devices"               |
| `SEARCHING`  | "Looking for your devices on this network…" |
| `NO_NETWORK` | error (below)                               |
| `NO_PEERS`   | error (below)                               |
| `NOT_PAIRED` | "No devices paired yet — Add a device"      |

### 9.3 Error catalogue

| Code                                                            | When detected                                                                  | User message                                                                                                               | Fix steps shown                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `NO_NETWORK`                                                    | No active LAN/Wi-Fi interface (phone on mobile data only)                      | "This device is not connected to Wi-Fi."                                                                                   | Turn on Wi-Fi; connect to the same network as your other devices.                         |
| `DIFFERENT_NETWORK`                                             | Current subnet ≠ subnet where paired devices were last seen, and none found    | "Your devices seem to be on a different network. This phone is on 10.0.0.x, 'Office Laptop' was last seen on 192.168.1.x." | Connect both to the same Wi-Fi. Avoid guest networks.                                     |
| `NO_PEERS`                                                      | Same network, discovery found no group members after 10 s, last-known IPs fail | "Can't find your other devices on this network."                                                                           | Is ClipBridge open on the other device? Same Wi-Fi? Try 'Add by IP'.                      |
| `PEER_UNREACHABLE`                                              | Device discovered but TCP connect fails / times out                            | "'Office Laptop' was found but can't be reached."                                                                          | Allow ClipBridge in the firewall. On Windows set the network to **Private**. Disable VPN. |
| `NETWORK_ISOLATION`                                             | mDNS sees nothing and direct IP fails for all peers on the same subnet         | "This Wi-Fi may block devices from talking to each other (client isolation)."                                              | Use a home/private network or hotspot. Ask the admin to disable AP/client isolation.      |
| `LOCAL_NETWORK_PERMISSION`                                      | iOS Local Network permission denied                                            | "ClipBridge needs Local Network access to find your devices."                                                              | Settings → Privacy → Local Network → ClipBridge ON.                                       |
| `NO_DESKTOP_ONLINE`                                             | Phone has peers paired but no desktop is reachable                             | "No computer is online. Phones sync through a computer in this version."                                                   | Open ClipBridge on a computer on this Wi-Fi.                                              |
| `AUTH_FAILED`                                                   | Handshake rejected                                                             | "'Office Laptop' did not accept this device."                                                                              | This device may have been removed. Pair again.                                            |
| `REMOVED_FROM_GROUP`                                            | Received membership without self                                               | "This device was removed from your group."                                                                                 | Pair again to rejoin.                                                                     |
| `VERSION_MISMATCH`                                              | Protocol major version differs                                                 | "'Office Laptop' runs an incompatible version."                                                                            | Update ClipBridge on both devices.                                                        |
| `PAYLOAD_TOO_LARGE`                                             | Image > 10 MB                                                                  | "This image is too large to send (14 MB, limit 10 MB)."                                                                    | Send a smaller image or a screenshot.                                                     |
| `PAIRING_EXPIRED` / `PAIRING_REJECTED` / `PAIRING_CODE_INVALID` | Pairing flow                                                                   | Specific message per case                                                                                                  | Start pairing again.                                                                      |
| `PORT_IN_USE`                                                   | Desktop cannot bind any port                                                   | "ClipBridge could not start its network service."                                                                          | Quit other ClipBridge windows; restart the app.                                           |

Each code maps to localized strings in one file per app (`errors.en.ts`), so wording can be changed (or translated to Hindi) without touching logic.

---

## 10. Clipboard behaviour

| Concern               | Rule                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Detect copy (desktop) | Poll every 500 ms: compare `availableFormats` + text / image hash.                                                                   |
| Classify              | URL if the trimmed text is a single `http(s)://` URL; else text; images as PNG.                                                      |
| Loop prevention       | When a received clip is written to the clipboard, its hash is stored as "last applied"; the watcher ignores a change with that hash. |
| Dedupe                | Clip id cache (500) + content hash within 2 s window.                                                                                |
| Newest wins           | A received clip is applied only if newer than the last local copy event (by `createdAt`, ties by device id).                         |
| Size limits           | Text 1 MB, image 10 MB (after PNG encode). Over limit → `PAYLOAD_TOO_LARGE`.                                                         |
| Sensitive content     | Skipped (see §8.5).                                                                                                                  |
| Per-device toggles    | "Send from this device" and "Receive on this device" switches.                                                                       |

---

## 11. Repository layout

```
clipboard/
  apps/
    desktop/                Electron app
    mobile/                 Expo app
  packages/
    core/                   shared domain + application logic (no platform code);
                            test doubles under @clipbridge/core/testing
    tsconfig/               shared tsconfig bases
    eslint-config/          shared lint rules incl. dependency boundaries
  docs/
    PLAN.md                 this file
    milestones/             one file per milestone
    adr/                    architecture decision records (short, numbered)
  .editorconfig  .gitignore  .prettierrc  package.json  pnpm-workspace.yaml
```

---

## 12. Testing strategy

| Level                         | What                                                                                                                                                                                        | Tool            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Unit                          | crypto (known test vectors), codec, every frame schema, sync engine (dedupe, loop, forwarding, newest-wins), pairing state machines, membership/rotation, error diagnosis rules, presenters | Vitest / Jest   |
| Integration                   | 3–5 engines in one process over the in-memory transport; 2 engines over real `ws` on localhost                                                                                              | Vitest          |
| Desktop E2E (manual + script) | two desktop instances on one machine with different data dirs                                                                                                                               | checklist       |
| Device matrix (manual)        | Win+Android, Win+iOS, Mac+Android, Mac+iOS, 3 laptops + 2 phones                                                                                                                            | checklist in M8 |
| Network fault tests (manual)  | Wi-Fi off, different SSID, guest Wi-Fi, firewall blocked, VPN on, desktop closed                                                                                                            | checklist in M7 |

Core coverage target: **≥ 90 % lines** on `packages/core`.

---

## 13. Coding standards

- TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `any`; `unknown` + zod at boundaries.
- One responsibility per file; files named in `kebab-case`; types/classes `PascalCase`; functions/variables `camelCase`; constants `UPPER_SNAKE_CASE`.
- Feature folders, not type folders, in apps.
- Dependency injection through constructors; one composition root per app (`container.ts`). No singletons imported from deep modules.
- Expected errors: `Result<T, AppError>`. Unexpected: throw, caught at the top level and logged.
- No secrets or clip contents in logs.
- Pure functions in domain; side effects only in adapters.
- Each public function in core has a short doc comment stating its contract.
- Commits: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
- Architecture decisions recorded as short ADRs in `docs/adr/`.

---

## 14. Milestones

Each milestone is shippable on its own and has a Definition of Done. Do them in order.

| #                                                | Milestone                   | Outcome                                                                |
| ------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------- |
| [M0](milestones/M0-foundation.md)                | Foundation                  | Monorepo, tooling, CI scripts run locally, empty apps start.           |
| [M1](milestones/M1-core.md)                      | Shared core                 | Protocol, crypto, sync engine, errors — fully unit-tested, no UI.      |
| [M2](milestones/M2-desktop-lan-sync.md)          | Desktop ↔ desktop text sync | Two laptops on the same Wi-Fi sync text/URLs; status + errors visible. |
| [M3](milestones/M3-pairing-and-groups.md)        | Pairing and groups          | QR/code pairing, approve, device list, unpair with key rotation.       |
| [M4](milestones/M4-android.md)                   | Android app                 | Pair by QR, receive with notification, send via share sheet.           |
| [M5](milestones/M5-ios.md)                       | iOS app                     | Pair by QR, receive on open, send via share sheet.                     |
| [M6](milestones/M6-images.md)                    | Images                      | Image clips on all platforms with size limits.                         |
| [M7](milestones/M7-diagnostics-and-hardening.md) | Diagnostics and hardening   | Full error catalogue, troubleshooting UI, fault testing.               |
| [M8](milestones/M8-packaging-and-release.md)     | Packaging and release       | Installers/APK/iOS build, device test matrix passed.                   |
| [Later](milestones/LATER.md)                     | Post-MVP backlog            | Quick Settings tile, iOS Local Push, phone-only groups, more.          |

---

## 15. Risks and mitigations

| Risk                                                                      | Impact                    | Mitigation                                                                                              |
| ------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| Office/guest Wi-Fi blocks device-to-device traffic (client isolation)     | No sync at all            | Detect and explain (`NETWORK_ISOLATION`); suggest hotspot. Cannot be fixed by software without a relay. |
| mDNS blocked but unicast works                                            | No auto discovery         | Last-known IP retry + "Add by IP".                                                                      |
| Windows firewall prompt denied / network set to Public                    | Desktop unreachable       | Detect `PEER_UNREACHABLE`, show exact fix; installer adds a firewall rule (M8).                         |
| iOS background suspension                                                 | No live receive on iPhone | Catch-up on open (MVP); Local Push Connectivity later.                                                  |
| Android OEM battery killers (Xiaomi, Oppo, …) stop the foreground service | Missed notifications      | Catch-up on open + in-app guide to disable battery optimization.                                        |
| Clipboard polling CPU cost                                                | Battery/CPU on laptops    | 500 ms poll, cheap format/length check before hashing.                                                  |
| Library abandonment (RN mDNS)                                             | Build breaks              | Isolated behind `DiscoveryPort`; replaceable by a small native module.                                  |

---

## 16. Glossary

- **Clip** — one copied item (text, URL or image).
- **Group** — all devices of one user that share the group key.
- **Peer** — another device in the group.
- **Hub** — a desktop that accepts connections and forwards clips.
- **Epoch** — version number of the group key; increases on every unpair.
- **Port / Adapter** — interface in core / its platform implementation.
