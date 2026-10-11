# M5 — iOS App

**Status:** 🟡 Code and configuration done and checked on Windows (tests, typecheck, `expo config --type introspect`). **Not built or run yet** — iOS builds need a Mac with Xcode (§5).

**Goal:** the same mobile app runs on iPhone. Pair by QR, send via share sheet, receive the latest clips when the app is opened.

**Depends on:** M4 (same codebase).

---

## 1. iOS limits (accepted)

- iOS suspends apps shortly after they leave the screen, and LAN-only means no Apple push service. **Clips arrive while ClipBridge is open**; opening it reconnects and catches up within a moment.
- No foreground service on iOS: the background toggle is replaced by an explanation.
- Real background receive is a later option (Apple Local Push Connectivity, see LATER.md).

## 2. What we built

| Area                                       | Change                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core `engine.resume()`                     | Drops possibly dead connections and reconnects to everyone now; the history exchange on connect delivers missed clips (newest one notified). Test: suspended phone catches up after resume. |
| App layer                                  | `AppController.resume()`, `setApplyToClipboard()` (auto-copy on phones)                                                                                                                     |
| Mobile lifecycle                           | On foreground: `resume()` on iOS (and on Android without the background service); auto-copy is on only while the app is visible                                                             |
| Setting                                    | **Copy automatically while open** (iOS and Android)                                                                                                                                         |
| Local Network permission                   | Checked through react-native-zeroconf; banner shows **Open Settings** for `LOCAL_NETWORK_PERMISSION`                                                                                        |
| iOS texts                                  | Home and Settings explain that iPhone receives while the app is open                                                                                                                        |
| `Info.plist` (via app.json)                | `NSLocalNetworkUsageDescription`, `NSBonjourServices: _clipbridge._tcp`, camera text, `ITSAppUsesNonExemptEncryption: false`                                                                |
| Share extension                            | expo-share-intent (text, URL, web page); app group `group.com.clipbridge.app`; `+native-intent.ts` routes share links to the home screen                                                    |
| `plugins/with-local-notifications-only.js` | Removes the `aps-environment` (push) entitlement that expo-notifications adds: ClipBridge never uses push, and the entitlement breaks signing with a free Apple ID                          |
| expo-camera                                | No microphone permission                                                                                                                                                                    |
| Desktop                                    | Calls `resume()` after the computer wakes from sleep                                                                                                                                        |
| Android                                    | Blocks the unused `READ/WRITE_EXTERNAL_STORAGE` permissions                                                                                                                                 |

Final iOS configuration (from `expo config --type introspect`):

```
NSLocalNetworkUsageDescription  "ClipBridge finds your computers on this Wi-Fi to sync your clipboard. Nothing is sent to the internet."
NSBonjourServices               ["_clipbridge._tcp", "_expo._tcp" (dev client only)]
NSCameraUsageDescription        "ClipBridge uses the camera only to scan the pairing QR code shown on your computer."
NSMicrophoneUsageDescription    (none)
entitlements                    { com.apple.security.application-groups: ["group.com.clipbridge.app"] }
```

## 3. How it works

**Laptop → iPhone**

```
Laptop copy → stored in the laptop's history
iPhone: open ClipBridge → resume() → reconnect → history exchange → newest clip shown
  → notification with Copy / Open, or copied automatically if "Copy automatically while open" is on
```

**iPhone → Laptop**

```
Safari → Share → ClipBridge → app opens → clip sent → laptop clipboard
(offline? it stays in the phone's history and is delivered when a computer connects)
```

## 4. Tests

- Core: `resume()` reconnects and catches up (engine.test.ts).
- App: auto-copy on/off and `resume()` (app-controller.test.ts).
- `pnpm check` green: core 195, app 56, desktop 31, mobile 15.

## 5. To do on a Mac

Requirements: macOS with Xcode, an iPhone, an Apple ID (free: 7-day installs; App Groups for the share extension may need a paid developer account).

```bash
cd apps/mobile
npx expo prebuild --platform ios
npx expo run:ios --device        # choose the iPhone, sign with your team in Xcode if asked
```

Checklist:

- [ ] Build and install; Local Network prompt appears on first launch.
- [ ] Deny Local Network → banner with **Open Settings**; allow → connects.
- [ ] Scan the QR from the Windows / Mac app, **Allow** → connected.
- [ ] Copy on the laptop while the iPhone app is closed → open ClipBridge → clip appears within ~2 s.
- [ ] "Copy automatically while open" → paste in another app without tapping Copy.
- [ ] Safari → Share → ClipBridge → link on the laptop clipboard.
- [ ] Re-check Android (manifest change: blocked storage permissions).
