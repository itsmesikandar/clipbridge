# M5 — iOS App

**Goal:** the same mobile app runs on iPhone. Pair by QR, send via share sheet, receive the latest clips when the app is opened.

**Depends on:** M4 (same codebase; this milestone adds iOS-specific parts).

**Requirements:** a Mac with Xcode; an Apple ID (free) for 7-day device installs, or an Apple Developer account for longer-lived builds.

---

## 1. iOS limits (accepted for MVP)

- No background connection: iOS suspends the app ~30 s after it leaves the foreground. **No live notification for incoming clips** without a cloud push service.
- Workaround (MVP): when the app opens or returns to the foreground, it connects and sends `HISTORY_REQ { since: lastSeenTs }` to a desktop; new clips appear at the top with **Copy / Open**. Optional setting "Auto-copy latest clip on open".
- Real background receive on LAN is evaluated later with Apple **Local Push Connectivity** (see LATER.md).

## 2. What we build

- iOS config (via Expo config plugins):
  - `NSLocalNetworkUsageDescription`: "ClipBridge finds your computers on this Wi-Fi."
  - `NSBonjourServices`: `_clipbridge._tcp`
  - `NSCameraUsageDescription` for QR scanning.
- Local Network permission handling: detect denial (browse returns no results + permission error) → `LOCAL_NETWORK_PERMISSION` error with a button to open Settings.
- Share extension via the share-intent module: Share → ClipBridge → host app opens, sends, shows "Sent ✓".
- Foreground catch-up flow (`AppState` change → reconnect → `HISTORY_REQ`).
- Short connection window: when the app goes to background right after sharing, a `beginBackgroundTask` (via the module or a tiny native bridge) gives up to ~30 s to finish sending.

## 3. How it works

**Laptop → iPhone**

```
Laptop copy → desktop history stores clip
iPhone: user opens ClipBridge → connect → HISTORY_REQ → new clips shown
  → tap Copy / Open   (or auto-copied if setting on)
```

**iPhone → Laptop**

```
Safari → Share → ClipBridge → app opens → sendClip → desktop clipboard
```

## 4. Tasks

- [ ] Config plugins for Info.plist keys
- [ ] Local Network permission detection + error
- [ ] Share extension integration and test on device
- [ ] Foreground catch-up + "auto-copy latest" setting
- [ ] Background task for finishing sends
- [ ] UI copy explaining iOS behaviour ("Open ClipBridge to receive")

## 5. Definition of Done

- Windows + iPhone and macOS + iPhone: share a link on iPhone → paste on laptop.
- Copy on laptop → open ClipBridge on iPhone → clip is there in < 2 s.
- Local Network permission denied → clear message with a working Settings button.
