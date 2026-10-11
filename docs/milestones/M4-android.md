# M4 — Android App

**Goal:** an Android phone joins the group by scanning a QR code, receives clips as notifications with **Copy / Open**, and sends text, URLs (images in M6) via the share sheet.

**Depends on:** M3.

---

## 1. What we build

### 1.1 Mobile adapters (`apps/mobile/src/adapters`)

| Adapter                    | Implementation                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `RnWsTransportAdapter`     | Built-in `WebSocket` (client only). Maps close codes/errors to `AppError`.                                                                  |
| `ZeroconfDiscoveryAdapter` | `react-native-zeroconf` browse `_clipbridge._tcp`; acquires Android **multicast lock** while browsing.                                      |
| `ExpoClipboardAdapter`     | `expo-clipboard`. **Write** on received clips (from "Copy" action). **Read only on explicit user action** ("Send clipboard" button in app). |
| `ExpoNotifierAdapter`      | `expo-notifications` local notifications with category actions **Copy** and **Open** (Open only for URLs).                                  |
| `ExpoNetworkInfoAdapter`   | `expo-network`: Wi-Fi vs cellular, IP address; subnet derived from IP + /24 heuristic, refined if netmask available.                        |
| `SecureStoreAdapter`       | `expo-secure-store` (Android Keystore).                                                                                                     |
| `AsyncStorageAdapter`      | Settings, members, history.                                                                                                                 |

### 1.2 Android foreground service (`src/native/android-sync-service`)

- Small Expo native module (Kotlin) starting a foreground service with a persistent notification "ClipBridge is connected to 2 devices".
- `foregroundServiceType="connectedDevice"` (validated on Android 14+ in a spike at the start of this milestone; fallback documented if Google rules require another type).
- Keeps the JS engine and WebSocket alive while the app is in the background.
- User can turn background sync off in settings (then sync only while the app is open).
- In-app guide for OEM battery optimization ("Allow ClipBridge to run in background" with a deep link to battery settings).

### 1.3 Share sheet (send)

- `expo-share-intent` (or equivalent maintained module) registers ClipBridge for `text/plain` (and `image/*` in M6).
- Share → ClipBridge → app opens briefly with "Sending to 2 devices… ✓" → returns to previous app.
- If no desktop is reachable → shows `NO_DESKTOP_ONLINE` / `NO_NETWORK` on that screen; the clip is kept in an outbox and sent when a desktop connects (configurable, default on, max 10 min).

### 1.4 Screens

- Onboarding: Welcome → **Scan QR** (`expo-camera`) → Waiting for approval → Done.
- Home: status banner, recent clips (tap = Copy, long press = Open/Share), "Send clipboard" button.
- Devices: list with status (read-only remove for MVP: remove from desktop).
- Settings: background sync, notifications, receive on/off, clear history.
- Diagnostics: IP, Wi-Fi state, discovered devices, last errors, copy diagnostics.

## 2. How it works

**Laptop → Android**

```
Laptop copy → engine sends CLIP → Android foreground service receives
  → local notification "🔗 Link from Office Laptop"  [Copy] [Open]
  → Copy: expo-clipboard write  → paste anywhere
  → Open: opens URL in default browser
```

**Android → Laptop**

```
Any app → Share → ClipBridge → engine.sendClip → desktop hub
  → desktop writes clipboard → Ctrl+V on laptop
```

**Android → other phone:** goes through the desktop hub (forwarding).

## 3. Permissions (Android manifest via config plugin)

`INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`, `POST_NOTIFICATIONS` (asked at onboarding with explanation), `CAMERA` (asked when scanning).

## 4. Tasks

- [ ] Spike: foreground service type + background WebSocket on Android 14/15
- [ ] Spike: mDNS on a real device with multicast lock
- [ ] Adapters + tests
- [ ] Foreground service native module + config plugin
- [ ] QR scan pairing flow (joiner state machine from core)
- [ ] Notifications with actions
- [ ] Share intent + outbox
- [ ] Screens + presenters
- [ ] Mobile-specific errors (`NO_NETWORK` on cellular, `NO_DESKTOP_ONLINE`)

## 5. Definition of Done

- Windows + Android and macOS + Android: copy on laptop → notification on phone within 2 s (app in background, screen on).
- Share a link from Chrome on Android → paste on laptop.
- Phone on mobile data → clear `NO_NETWORK` message.
- Phone killed by the user → on reopen, catches up with latest clips from the desktop history.
