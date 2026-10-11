# M2 — Desktop ↔ Desktop Text Sync over LAN

**Status:** 🟡 Code complete and verified with two app instances on one Windows machine (real mDNS + WebSockets). Waiting for the manual test on two physical computers (§4).

**Goal:** two (or more) laptops on the same Wi-Fi automatically sync text and URLs. The user always sees the connection status and a clear error if something is wrong.

**Depends on:** M1.

> M2 used a temporary **developer pairing** (text invite → reply). It was removed in M3 and replaced by code / QR pairing.

---

## 1. What we build

### 1.1 Desktop adapters (`apps/desktop/src/main/adapters`)

| Adapter                                    | Implementation                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ElectronClipboard`                        | Polls every 500 ms with Electron 44's async clipboard API. First read is only the baseline. Own writes are not reported. Sensitive formats (`org.nspasteboard.ConcealedType`, `ExcludeClipboardContentFromMonitorProcessing`, …) are checked via `electron application/osclipboard;format="…"`. |
| `WsTransport`                              | `ws` server on `0.0.0.0:47821`, falls back to a free port; client with handshake timeout; 20 MB max payload; socket errors → `PEER_UNREACHABLE` (refused / timeout / unreachable); busy ports → `PORT_IN_USE`.                                                                                  |
| `BonjourDiscovery`                         | `bonjour-service`: publishes `_clipbridge._tcp` with TXT `v`, `did`, `gt`, `pm` (no names); browses, IPv4 only; re-queries every 15 s; `restart()` after network change or resume.                                                                                                              |
| `NodeNetworkInfo`                          | `os.networkInterfaces()` every 5 s; skips virtual/VPN adapters (Hyper-V, WSL, VMware, Docker, Tailscale, …), prefers private Wi-Fi/Ethernet addresses.                                                                                                                                          |
| `JsonFileStorage` / `EncryptedFileStorage` | JSON per key with atomic writes; secrets encrypted by Electron `safeStorage` (DPAPI / Keychain) and refused if OS encryption is unavailable.                                                                                                                                                    |
| `DesktopNotifier`                          | "Link from Office Laptop" notification; clicking a link opens it (http/https only).                                                                                                                                                                                                             |
| `FileLogger`                               | `userData/logs/main.log`, rotates at 1 MB, keeps 3; context values are primitives only.                                                                                                                                                                                                         |
| `SystemClock`, `NodeRandom`                | `Date.now`/`setTimeout`, `crypto.randomBytes`.                                                                                                                                                                                                                                                  |

### 1.2 Main process

- `container.ts` — composition root; the only file that knows Electron modules and concrete adapters.
- `app-controller.ts` — no Electron imports: loads/creates identity, loads the group, starts/stops the engine, persists settings and member-list changes, builds the `AppSnapshot` the UI renders, developer pairing.
- `identity/credential-store.ts` — identity keys and group key in encrypted storage, the rest as JSON.
- `ipc/` — `state:get` + `state:changed` push (coalesced 50 ms), settings, history copy/clear, diagnostics, dev pairing. All renderer input is validated (`shared/ipc-schemas.ts`).
- `index.ts` — lifecycle, tray, profiles (`CLIPBRIDGE_PROFILE`) for several instances on one machine, discovery restart on network change and on resume from sleep, clean shutdown (closes peers, unpublishes mDNS).

### 1.3 Renderer UI

```
ClipBridge
┌────────────────────────────────────────────┐
│ Connected to 1 device                       │  status banner (green / blue / amber / red)
│   or: Can’t find your other devices         │  + message + [Troubleshoot]
├────────────────────────────────────────────┤
│ Developer pairing (dev only)                │
├────────────────────────────────────────────┤
│ Devices    ● Office Laptop  Windows · Connected
│            ● Home PC        Windows · Offline · last seen 2 h ago
├────────────────────────────────────────────┤
│ Recent     [Link] https://…  Office Laptop · just now   [Copy]
├────────────────────────────────────────────┤
│ Settings   send / receive / notifications   │
└────────────────────────────────────────────┘
```

- Troubleshoot panel: fix steps for the current error, this device's network/IP/port, "Copy diagnostics" (no keys, no clip contents).
- Error texts for every code live in `renderer/src/i18n/issue-text.ts`.
- Feature folders: dumb view + presenter hook + pure view-model functions (tested).
- Window close → hides to tray; syncing continues.

## 2. How it works end to end

```
Laptop A: Ctrl+C on a URL
  → ElectronClipboard poll detects the change (≤ 500 ms)
  → engine creates the clip, encrypts it, sends it over the WebSocket session
Laptop B:
  → engine decrypts, deduplicates, writes the clipboard (not reported back as a copy)
  → notification "Link from Laptop A" → Ctrl+V
```

### Developer pairing (until M3)

```
A: Create group → Show invite → copy text  ─►  B: paste → Join with invite → copy reply
A: paste reply → Accept reply                ◄─
Both now list each other in the signed member list and connect automatically.
```

### Several instances on one computer

```bash
cd apps/desktop
pnpm build
CLIPBRIDGE_PROFILE=a npx electron .     # PowerShell: $env:CLIPBRIDGE_PROFILE='a'; npx electron .
CLIPBRIDGE_PROFILE=b npx electron .
```

Each profile has its own data folder (`%APPDATA%\ClipBridge-<profile>`), identity and port. Both share the same OS clipboard, so a copy is picked up by both — fine for testing connectivity, but use two computers to test real clipboard behaviour.

## 3. Tasks

- [x] Adapters with unit tests (fake Electron clipboard, temp directories, real sockets)
- [x] `container.ts` + app lifecycle (start on ready, clean shutdown, resume/network-change handling)
- [x] Typed IPC contract + preload + handlers with zod validation
- [x] Status banner, troubleshoot panel, device list, recent clips, settings
- [x] Developer pairing (dev mode only)
- [x] Integration test: two engines with real `ws` on `127.0.0.1`
- [x] Controller test: two computers pair and sync on the in-memory network
- [ ] Manual test: two physical computers, same Wi-Fi

## 4. Manual test checklist

Verified with two instances on one Windows 11 machine (Wi-Fi, real mDNS + WebSockets), driven through DevTools:

- [x] Developer pairing; both show "Connected to 1 device" within ~1 s.
- [x] A copy is received by the other instance and marked "delivered to 1".
- [x] Other app closed → "Can’t find your other devices … (10.219.156.x)" with Troubleshoot.
- [x] Other app restarted → reconnects in ~1.5 s with the same identity (keys loaded from encrypted storage).

Still to do on two physical computers:

- [ ] Copy text on A → paste on B within 1 s. And B → A.
- [ ] Copy the same text twice → no duplicate in history, no ping-pong.
- [ ] Turn Wi-Fi off on B → B shows "Not connected to Wi-Fi"; A shows B offline.
- [ ] Connect B to a different Wi-Fi → B shows "different networks" with both subnets.
- [ ] Block the app in the Windows firewall on A → B shows "can’t be reached" with firewall steps.
- [ ] Copy a password from a password manager → not synced.
- [ ] Close window → still syncs from tray.
- [ ] Idle CPU < 1 %.

## 5. Decisions made during M2

- **Electron 44 clipboard is async (W3C-style).** Raw OS formats are checked with `electron application/osclipboard;format="…"`.
- **Developer pairing is a two-step exchange**, because a device only trusts member lists signed by a device it already trusts. M3 replaces it with QR / code pairing and an approval prompt.
- **History is in memory** and starts empty after a restart; persistence comes with history polish (M7).
- **Windows may show a firewall prompt** the first time the app listens. Allowing it on private networks is required for other computers to connect; the installer will add the rule (M8).
- **Same-machine traffic** uses the Wi-Fi address found by mDNS; it works without firewall changes.

## 6. Definition of Done

- [ ] Checklist above passes on Windows ↔ Windows (and Windows ↔ macOS if a Mac is available).
- [x] `pnpm check` green.
- [ ] Idle CPU of the desktop app < 1 % on a typical laptop.
