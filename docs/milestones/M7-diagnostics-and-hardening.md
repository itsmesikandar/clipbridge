# M7 — Diagnostics and Hardening

**Goal:** when sync does not work, the user understands **why** and **what to do**, on every platform. The app survives real-world network chaos.

**Depends on:** M6.

---

## 1. What we build

### 1.1 Complete error catalogue

All codes of PLAN §9.3 implemented, tested and shown with title, message and fix steps on desktop, Android and iOS. Strings in one file per app (`errors.en.ts`), ready for translation (Hindi later).

### 1.2 Troubleshoot panel

Opens from any red/amber banner:

```
Can't find your other devices on this network.

Check:
  ✓ This device is on Wi-Fi "192.168.1.x"
  ✗ Office Laptop last seen on "10.0.0.x"  → connect both to the same Wi-Fi
  ? Is ClipBridge open on Office Laptop?
  ? Windows: is the network set to Private?
  ? Is a VPN turned on?

[Try again]  [Add device by IP]  [Copy diagnostics]
```

Checks with ✓/✗ are computed; "?" items are suggestions the app cannot verify.

### 1.3 Diagnostics screen

This device: name, id, platform, app + protocol version, IP, subnet, port, Wi-Fi state, mDNS advertising state.
Per peer: state, last error, last seen, last seen network, round-trip time.
"Copy diagnostics" → text report without keys or clip contents.

### 1.4 Hardening

- **Network change handling:** on Wi-Fi switch / IP change, re-advertise, drop dead sockets, rediscover; no stale "Connected".
- **Sleep / resume (desktop):** `powerMonitor` resume → reconnect immediately.
- **Clock skew:** newest-wins uses `createdAt` but also a per-device sequence number; clocks off by minutes do not break ordering between two devices' own clips.
- **Malicious/garbage input:** fuzz tests on `decodeFrame`; rate-limit handshake attempts per IP (5/min); close connections that send > 20 invalid frames.
- **Resource limits:** max 32 connections, max 15 MB frame, chunk reassembly timeout 30 s.
- **Windows firewall:** detect the "Public network" profile (via `Get-NetConnectionProfile` at startup) and warn proactively.

## 2. Fault test checklist (manual, all platforms)

- [ ] Wi-Fi off → `NO_NETWORK`
- [ ] Phone on mobile data only → `NO_NETWORK`
- [ ] Devices on different Wi-Fi → `DIFFERENT_NETWORK` with both subnets
- [ ] Guest network with client isolation → `NETWORK_ISOLATION`
- [ ] Firewall blocks app → `PEER_UNREACHABLE` + firewall steps
- [ ] Windows network set to Public → proactive warning
- [ ] VPN on → appropriate hint
- [ ] iOS Local Network denied → `LOCAL_NETWORK_PERMISSION`
- [ ] Other device closed → device "Offline · last seen"
- [ ] Only phones online → `NO_DESKTOP_ONLINE`
- [ ] Removed device → `REMOVED_FROM_GROUP`
- [ ] Old app version on one device → `VERSION_MISMATCH`
- [ ] Laptop sleep/resume → reconnects < 5 s
- [ ] Router restart → all devices reconnect automatically

## 3. Definition of Done

- Every row above passes and shows the documented message.
- Fuzz tests run in `pnpm test` (bounded iterations).
- No unhandled promise rejections in logs during a 1-hour soak test with 3 devices.
