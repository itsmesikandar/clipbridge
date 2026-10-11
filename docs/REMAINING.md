# Remaining Work (handoff)

Snapshot of what is left, written on 2026-10-11 so work can continue on a MacBook.
Each milestone doc in `docs/milestones/` has the full detail; this file is the to-do list.

---

## 0. State of the repo

| Milestone                    | Status                                            | Branch / commit                         |
| ---------------------------- | ------------------------------------------------- | --------------------------------------- |
| M0 Foundation                | ✅ done                                           | `67b0728`                               |
| M1 Core                      | ✅ done                                           | `60806c8`                               |
| M2 Desktop LAN sync          | ✅ done                                           | `5680d5f`                               |
| M3 Pairing and groups        | ✅ done                                           | `cd98675`                               |
| M4 Android                   | 🟡 works on a real phone; manual checks left (§3) | `ef24eb3`                               |
| M5 iOS                       | 🟡 code done, **never built** (needs Mac, §2)     | `e9c8707`                               |
| M6 Images                    | 🟡 code done, phone check left (§3)               | `eecdca1`                               |
| M7 Diagnostics and hardening | 🔨 in progress, core part done (§1)               | `b5c87f6` on branch `feat/m7-hardening` |
| M8 Packaging and release     | ⏳ not started (§4)                               | —                                       |

**The repo has no git remote.** Before switching machines:

Push to a private GitHub repository, or copy the folder without `node_modules`, `dist`, `out` and `android/build`.

---

## 1. Finish M7 — Diagnostics and hardening

Spec: `docs/milestones/M7-diagnostics-and-hardening.md`.

### Done (in `packages/core`, commit `b5c87f6`)

- Hybrid logical clock for `createdAt` (`sync-engine.ts`), so a laptop clock that runs minutes behind no longer breaks newest-wins. Test: "newest wins even when a laptop clock is 5 minutes behind".
- Handshake rate limit: 5 failures/min per IP. The device then gets an `ERROR AUTH_FAILED` frame. Also a cap of 32 inbound connections (`peer-manager.ts`).
- Known addresses: `EngineOptions.knownAddresses` / `onAddressLearned`, plus `Engine.connectTo(address)` for networks where mDNS is blocked.
- Fuzz tests: `protocol/fuzz.test.ts`.
- Simulated soak test with 5 devices, 30 simulated minutes, network drops and a restart: `application/soak.test.ts`.
- Status: 219 core tests pass; lint is clean.

### To do

1. **App layer** (`packages/app/src/app-controller.ts`)
   - Persist known addresses under storage key `known-addresses`, validated with zod as `Record<deviceId, {host, port}>`.
   - Load them in `startEngine()` and pass `knownAddresses` + `onAddressLearned` (which saves them) to `createEngine`.
   - Clear them in `resetThisDevice()`.
   - Add `connectTo(text: string): Promise<ActionResult<{ name: string }>>`. Reuse the IP parsing from `joinAddresses()` by extracting a `parseAddress()` helper.
   - Add tests in `app-controller.test.ts`: connect by address, address remembered after restart, invalid input.
2. **Network hints** for `DiagnosticsView`
   - Add an optional dep `networkHints?: () => Promise<{ vpnActive: boolean | null; networkProfile: 'public' | 'private' | 'domain' | null }>`.
   - Desktop implementation:
     - VPN = an `os.networkInterfaces()` name matching `tun|tap|wg|utun|ppp|tailscale|zerotier|ipsec`.
     - Windows profile = `powershell Get-NetConnectionProfile`, read `NetworkCategory`.
     - macOS: profile is `null`; check that `utun*` is not always present on macOS (iCloud Private Relay and similar create it), so match carefully there.
   - Mobile: `null` for both, unless the Android native module can report a VPN transport.
3. **Troubleshoot checklist** (new `packages/app/src/presentation/troubleshoot-checks.ts`, exported from `presentation/index.ts`)
   - Input: `DiagnosticsView` + `BannerModel`/status.
   - Output: a list of `{ state: 'ok' | 'fail' | 'unknown', label, fix? }` rows, as in the M7 spec §1.2:
     - on a local network;
     - listening (computers only);
     - other devices discovered;
     - at least one connected;
     - same subnet as each peer's `lastSeenSubnet`;
     - VPN;
     - Windows Public profile.
   - Unit tests next to `view-models.test.ts`.
   - Add hints and known addresses to `toReport()` (diagnostics-report.ts).
4. **Desktop UI**
   - IPC channel `devices:connect-to` in `shared/ipc-contract.ts`, with a schema in `shared/ipc-schemas.ts`.
   - Handler in `main/ipc/register-pairing-handlers.ts` (or state handlers), plus the preload method.
   - `features/status/troubleshoot-panel.tsx`: render the ✓/✗/? checklist and a "Connect by IP address" input with a button that shows success or the issue text. Add per-peer rows (state, last error, last seen network).
   - Proactive warning at startup when the Windows profile is Public.
5. **Mobile UI**: the same checklist + "Connect by IP address" in the troubleshoot/settings view (`apps/mobile/src/features/...`), wired through `state/app-context.tsx`.
6. **Docs**: update the M7 doc with a status line.
   - `NETWORK_ISOLATION` (guest Wi-Fi client isolation) stays a hint. It cannot be detected for sure.
   - "Close after > 20 invalid frames" was not needed: a bad frame already closes the session.
7. Run `pnpm check` (lint + typecheck + tests in all packages), then commit as `feat: diagnostics and hardening (M7)`.
8. **Manual fault checklist**: M7 doc §2. Run it on Windows + Android, then again on Mac + iPhone.

---

## 2. M5 — iOS (needs the Mac)

Spec: `docs/milestones/M5-ios.md` §5.

### Mac setup

```bash
# tools
xcode-select --install          # plus full Xcode from the App Store, open it once to accept the license
brew install node@24 cocoapods  # Node >= 24 is required (package.json engines)
corepack enable                 # gives pnpm 12.3.4 from packageManager

# project
cd clipboard
pnpm install
pnpm check                      # must be green before anything else

# iOS app
cd apps/mobile
npx expo prebuild --platform ios
npx expo run:ios --device       # pick the iPhone; in Xcode choose your Apple ID team if signing fails
```

Notes:

- Free Apple ID: installs expire after 7 days. The share extension's App Group may need a paid developer account. If signing fails only because of the extension, build without it first.
- The `with-local-notifications-only` config plugin must stay **first** in `app.json` plugins. It removes the push entitlement, which a free Apple ID cannot sign.
- iPhone: Settings → Privacy → Local Network → ClipBridge must be on.

### Checklist

- [ ] Build and install; the Local Network prompt appears on first launch.
- [ ] Deny Local Network → banner with **Open Settings**; allow → connects.
- [ ] Scan the QR from the Windows or Mac app, **Allow** → connected.
- [ ] Copy on the laptop while the iPhone app is closed → open ClipBridge → the clip appears within ~2 s.
- [ ] "Copy automatically while open" → paste in another app without tapping Copy.
- [ ] Safari → Share → ClipBridge → the link is on the laptop clipboard.
- [ ] Share a photo from Photos → it arrives on the laptop (M6 on iOS).
- [ ] Re-check Android (manifest change: blocked storage permissions).

### Desktop app on macOS (first run on a Mac)

- [ ] `pnpm --filter @clipbridge/desktop dev`: tray icon, window, pairing with the Windows laptop.
- [ ] macOS firewall prompt "accept incoming connections" → Allow.
- [ ] Text, URL, screenshot (Cmd+Shift+Ctrl+4) sync both ways with Windows and the phones.
- [ ] Sleep/wake the Mac → reconnects in < 5 s.

---

## 3. Manual checks left on Android (M4, M6)

M4 (`docs/milestones/M4-android.md` §5):

- [ ] Tap **Copy** on a notification while the app is in the background, then paste in another app.
- [ ] Phone on a normal Wi-Fi network (not a hotspot), with the computer on the same Wi-Fi.
- [ ] Wi-Fi off → "Not connected to Wi-Fi"; computer app closed → "No computer is online".
- [ ] Phone idle 30+ minutes (battery optimization on and off) → clips still arrive.
- [ ] Type the code instead of scanning.

M6 (`docs/milestones/M6-images.md` §5) — install the newest APK first:

- [ ] Screenshot on the computer → notification "Image from …" with a thumbnail → Copy → paste into a chat app.
- [ ] Share a photo from the gallery → it lands on the computer clipboard → paste into a document.
- [ ] "Send clipboard" with an image copied on the phone.
- [ ] A 12 MB photo → converted and sent, or a clear error.

Android build environment (Windows): JDK 17 (`JAVA_HOME=C:/Users/iamsi/.jdks/ms-17.0.20.1`); JDK 25 breaks the CMake prefab step. `ANDROID_HOME=C:/Users/iamsi/AppData/Local/Android/Sdk`. On a Mac, use JDK 17 as well (`brew install --cask zulu@17`) and Android Studio's SDK.

---

## 4. M8 — Packaging and release

Spec: `docs/milestones/M8-packaging-and-release.md`.

- [ ] `electron-builder` config: Windows NSIS `.exe` + macOS universal `.dmg` (the `.dmg` must be built on the Mac), icons, start-on-login option.
- [ ] NSIS script: inbound firewall rule for the app, private networks only.
- [ ] Android release keystore (kept outside the repo) + `assembleRelease` script.
- [ ] iOS archive steps (Xcode → Product → Archive) documented.
- [ ] Version sync script: root `package.json` `version` → desktop, mobile `app.json`, Android `versionCode`, iOS build number.
- [ ] `CHANGELOG.md` from Conventional Commits.
- [ ] `docs/USER_GUIDE.md` with screenshots + a privacy note in About ("works only on your local network").
- [ ] Device test matrix (M8 §2) on real devices; results in `docs/TEST_RESULTS.md`.
- [ ] `pnpm check` green, tag `v0.1.0`.

---

## 5. Ground rules to keep

- Local only: no cloud services, accounts, push or relays. Same LAN only, with clear errors when not connected or on a different network.
- Only paired devices receive clips. Colleagues on the same Wi-Fi get nothing.
- `@clipbridge/core` stays platform-neutral (ESLint boundary rules enforce this). UI text lives in `@clipbridge/app/presentation`.
- TypeScript stays on 6.x: typescript-eslint does not support TS 7 yet.
- One milestone at a time; commit per milestone with Conventional Commits (commitlint: the subject must not be sentence-case).
- Post-MVP ideas: `docs/milestones/LATER.md`.
