# M2 — Desktop ↔ Desktop Text Sync over LAN

**Goal:** two (or more) laptops on the same Wi-Fi automatically sync text and URLs. The user always sees the connection status and a clear error if something is wrong.

**Depends on:** M1.

> Pairing is not built yet. For this milestone a **development group** is used: a group key generated on first run and copied to the second machine through a dev-only "Import dev group" setting (hidden behind `CLIPBRIDGE_DEV=1`). M3 replaces it with real pairing.

---

## 1. What we build

### 1.1 Desktop adapters (`apps/desktop/src/main/adapters`)

| Adapter                    | Implementation details                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ElectronClipboardAdapter` | Poll every 500 ms. Cheap check first (`availableFormats()` + text length), hash only if changed. Skip concealed/transient formats (macOS `org.nspasteboard.ConcealedType`, Windows `ExcludeClipboardContentFromMonitorProcessing`). |
| `WsTransportAdapter`       | `ws` server bound to `0.0.0.0:47821` (fallback random port); client for dialing; `maxPayload` 15 MB; maps socket errors (`ECONNREFUSED`, `ETIMEDOUT`, `EHOSTUNREACH`, `EADDRINUSE`) to `AppError`.                                  |
| `BonjourDiscoveryAdapter`  | `bonjour-service`: publish `_clipbridge._tcp` with TXT (`v`, `did`, `gt`, `pm`); browse; emit up/down events; re-publish on network change.                                                                                         |
| `NodeNetworkInfoAdapter`   | `os.networkInterfaces()` → active IPv4, netmask, subnet; poll every 5 s for changes (Wi-Fi switch).                                                                                                                                 |
| `FileStorageAdapter`       | JSON files under `app.getPath('userData')`, atomic write (temp file + rename).                                                                                                                                                      |
| `SafeStorageAdapter`       | Electron `safeStorage` (DPAPI on Windows, Keychain on macOS) to encrypt keys at rest.                                                                                                                                               |
| `ElectronNotifierAdapter`  | Native notification "Clip received from 'Office Laptop'" (toggle in settings). Clicking a URL notification opens it with `shell.openExternal` (http/https only).                                                                    |
| `FileLoggerAdapter`        | Rotating log file, levels, redacts clip content.                                                                                                                                                                                    |

### 1.2 Main process wiring

- `container.ts` builds all adapters, then `createEngine(...)`. Only place that knows concrete classes.
- `ipc/` exposes to the renderer: `status.get/subscribe`, `peers.get/subscribe`, `history.get/subscribe`, `settings.get/update`, `diagnostics.get`.
- `shared/ipc-contract.ts` defines channel names and zod schemas; preload exposes a typed `window.clipbridge` API.

### 1.3 Renderer UI (first version)

```
┌───────────────────────────────────────────┐
│ ● Connected to 1 device                    │  ← status banner (green / amber / red)
├───────────────────────────────────────────┤
│ Devices                                    │
│   🖥  Office Laptop     Connected           │
│   🖥  Home PC           Offline · 2 h ago   │
├───────────────────────────────────────────┤
│ Recent                                     │
│   🔗 https://example.com/…   from Office  ⧉ │
│   📝 "meeting at 5"          this device  ⧉ │
└───────────────────────────────────────────┘
```

- Red banner shows error title + message + **Troubleshoot** button (checklist from the error's fix steps).
- Window closes to tray; app keeps syncing in the background.
- Each feature folder: `view.tsx` (dumb), `use-<feature>-presenter.ts` (state + actions), `<feature>.test.ts`.

## 2. How it works end to end

```
Laptop A: Ctrl+C on a URL
  → ClipboardAdapter detects change (≤ 500 ms)
  → SyncEngine creates Clip, encrypts, sends over WebSocket
Laptop B: Transport receives frame
  → SyncEngine decrypts, dedupes, writes to clipboard, marks as lastApplied
  → Notification "Link from Laptop A"  → user presses Ctrl+V
```

Errors handled in this milestone: `NO_NETWORK`, `NO_PEERS`, `DIFFERENT_NETWORK`, `PEER_UNREACHABLE`, `VERSION_MISMATCH`, `PORT_IN_USE`, `AUTH_FAILED`. (Full catalogue polish in M7.)

## 3. Tasks

- [ ] Adapters listed in §1.1 with unit tests (mock Electron APIs)
- [ ] `container.ts` + app lifecycle (start engine on ready, stop on quit)
- [ ] Typed IPC contract + preload + handlers with zod validation
- [ ] Status banner, device list, recent clips, troubleshoot panel
- [ ] Dev group creation/import (dev flag only)
- [ ] Integration test: two engines with real `ws` on `127.0.0.1`
- [ ] Manual test: two physical laptops, same Wi-Fi

## 4. Manual test checklist

- [ ] Copy text on A → paste on B within 1 s. And B → A.
- [ ] Copy the same text twice → no duplicate in history, no ping-pong.
- [ ] Turn Wi-Fi off on B → B shows `NO_NETWORK`; A shows B "Offline".
- [ ] Connect B to a different Wi-Fi → B shows `DIFFERENT_NETWORK` with both subnets.
- [ ] Block the app in the Windows firewall on A → B shows `PEER_UNREACHABLE` with firewall fix.
- [ ] Copy a password from a password manager → not synced.
- [ ] Close window → still syncs from tray.

## 5. Definition of Done

- Checklist above passes on Windows ↔ Windows and Windows ↔ macOS (if a Mac is available).
- `pnpm check` green.
- Idle CPU of the desktop app < 1 % on a typical laptop.
