# M4 — Android App

**Status:** 🟡 Working on a real phone (Nothing A142, Android 16) with a Windows computer. A few manual checks remain (§5).

**Goal:** an Android phone joins the group by scanning a QR code (or typing the code), receives clips as notifications with **Copy / Open**, and sends text and links via the share sheet.

**Depends on:** M3.

---

## 1. What we built

### Shared app layer — `packages/app` (`@clipbridge/app`)

Moved out of the desktop so both apps use the same code:

- `AppController` (engine lifecycle, pairing, devices, settings, snapshot) — now also `joinWithLink()` (QR), `sendClip()`, `clipContent()`; `init()` is idempotent.
- `CredentialStore`, view types (`AppSnapshot`, …), and `presentation/` (error texts, banner/device/pairing view models, diagnostics report).
- Phones never write received clips to the clipboard automatically (`applyToClipboard` only on computers).

### Mobile adapters — `apps/mobile/src/adapters`

| Adapter                | Implementation                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `RnWebSocketTransport` | Built-in `WebSocket`, dial only, own timeout, error text → `PEER_UNREACHABLE` cause                                                          |
| `ZeroconfDiscovery`    | `react-native-zeroconf` 0.17 (Android NsdManager), browse only, restart on network change, Local Network permission check (Android 17 / iOS) |
| `ExpoNetworkInfo`      | Native interface list first (Wi-Fi, **the phone's own hotspot**, USB/Ethernet tethering, real prefix), `expo-network` fallback, 10 s poll    |
| `ExpoClipboard`        | `expo-clipboard`, write only; read only after a user action ("Send clipboard")                                                               |
| `ExpoNotifier`         | `expo-notifications`, channel "Received clips", actions **Copy** (no app launch) and **Open** (links)                                        |
| Storage                | `AsyncStorage` (JSON), `expo-secure-store` (identity and group keys)                                                                         |
| `RingBufferLogger`     | Last 200 lines, shown under Settings → Diagnostics                                                                                           |

### Native module — `apps/mobile/modules/sync-service` (Kotlin, Expo Modules API)

- Foreground service (`connectedDevice` type) with a silent "ClipBridge — Connected to 1 device" notification, so the JS engine keeps running in the background.
- Battery-optimization status and settings shortcut.
- `lanInterfaces()`: IPv4 interfaces with prefix length (needed for hotspots, which the Wi-Fi API reports as "cellular").

### Screens (Expo Router)

- **First run:** Scan QR code / type the code (finds computers in pairing mode via mDNS).
- **Scan:** `expo-camera` QR scanner → join → "Waiting — click Allow on the other computer".
- **Home:** status banner (+ "Set up again" when removed), "Send clipboard", Recent (Copy / Open), Computers.
- **Settings:** receive, notifications, stay connected in the background (+ battery hint), this phone's name, reset, diagnostics log.
- **Share sheet:** `expo-share-intent` (`text/*`) → sent immediately, or kept in history and delivered when a computer connects.

## 2. Verified on a real phone

Phone: Nothing A142, Android 16 (SDK 36). Computer: Windows 11, desktop app (test profile). Network: the computer was connected to **the phone's hotspot**.

- [x] Debug build installs and runs (Hermes); identity created with the noble crypto on Hermes.
- [x] Paired by scanning the QR code + Allow on the computer.
- [x] "Connected to 1 device" after app restart.
- [x] Computer copy → notification "Text from …" with **Copy**; links get **Copy** and **Open**.
- [x] App in the background (Home pressed) → notification still arrives; foreground-service notification shows the status.
- [x] Share a link to ClipBridge (share intent) → on the computer's clipboard within seconds.
- [x] Catch-up: a link copied before the phone connected appears in Recent.

## 3. Bugs found on the device and fixed

- **Two engines after Android recreated the activity** (JS runtime kept running) → connect/replace loop. `AppController.init()` is now idempotent; test added.
- **Phone as hotspot looked like "no Wi-Fi"** → native interface list (`ap0`, `swlan0`, …) with the real subnet.
- **Phones auto-wrote received clips to the clipboard** → only computers do; phones use the notification's Copy.
- Session close reasons were not logged → `peer disconnected {code, reason}`.

## 4. Build notes

- Build with **JDK 17** (`JAVA_HOME=%USERPROFILE%\.jdks\ms-17.0.20.1`). With Android Studio's JDK 25, CMake's `prefab` step fails with "A restricted method in java.lang.System has been called".
- Expo needs NDK 27.1 (downloaded automatically on first build, ~15 min).
- `cd apps/mobile && npx expo prebuild --platform android && cd android && gradlew app:assembleDebug`, then `adb install`, `adb reverse tcp:8081 tcp:8081`, `pnpm start`.

## 5. Still to check by hand

- [ ] Tap **Copy** on a notification while the app is in the background, then paste in another app.
- [ ] Phone on a normal Wi-Fi network (not hotspot) with the computer on the same Wi-Fi.
- [ ] Turn Wi-Fi/hotspot off → "Not connected to Wi-Fi"; computer app closed → "No computer is online".
- [ ] Leave the phone idle for 30+ minutes (battery optimization on/off) and check that clips still arrive.
- [ ] Type the code instead of scanning.
- [ ] Release APK signing (M8).
