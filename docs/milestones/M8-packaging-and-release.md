# M8 — Packaging and Release (local)

**Goal:** installable builds for every platform and a passed device test matrix. Everything is built locally; no cloud build or update service.

**Depends on:** M7.

---

## 1. What we build

| Platform | Output                                                                                             | Notes                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows  | NSIS installer (`.exe`) via `electron-builder`                                                     | Adds an inbound firewall rule for the app (private networks only) during install; start-on-login option. Unsigned builds show SmartScreen — signing is optional (needs a certificate). |
| macOS    | `.dmg` (universal: Intel + Apple Silicon)                                                          | Unsigned builds need right-click → Open. Signing + notarization need an Apple Developer account. Start-on-login option.                                                                |
| Android  | Release APK (`./gradlew assembleRelease`) signed with a local keystore                             | Keystore and passwords stored outside the repo.                                                                                                                                        |
| iOS      | Xcode archive installed via cable (free Apple ID: 7 days) or Ad Hoc/TestFlight (developer account) |                                                                                                                                                                                        |

Also:

- App icons, names, version numbers synced across apps from one source (`version` in root `package.json`).
- `CHANGELOG.md` generated from Conventional Commits.
- `docs/USER_GUIDE.md`: install, pair, use, troubleshoot (with screenshots).
- Privacy note in the app's About screen: "ClipBridge works only on your local network. Nothing is sent to the internet."

## 2. Device test matrix

| Combination                                  | Pair             | Desktop → Phone       | Phone → Desktop | Image | Errors |
| -------------------------------------------- | ---------------- | --------------------- | --------------- | ----- | ------ |
| Windows + Android                            | ☐                | ☐                     | ☐               | ☐     | ☐      |
| Windows + iPhone                             | ☐                | ☐                     | ☐               | ☐     | ☐      |
| macOS + Android                              | ☐                | ☐                     | ☐               | ☐     | ☐      |
| macOS + iPhone                               | ☐                | ☐                     | ☐               | ☐     | ☐      |
| Windows + macOS                              | ☐                | ☐ (desktop ↔ desktop) | ☐               | ☐     | ☐      |
| 3 laptops + 2 phones (mixed OS)              | ☐                | ☐                     | ☐               | ☐     | ☐      |
| Same Wi-Fi with an unpaired colleague device | ☐ never receives |                       |                 |       |        |

## 3. Tasks

- [ ] `electron-builder` config for Windows + macOS, icons, auto-start option
- [ ] Windows firewall rule in installer (NSIS script)
- [ ] Android release signing + APK build script
- [ ] iOS archive steps documented
- [ ] Version sync script
- [ ] User guide + privacy note
- [ ] Run the full matrix and record results in `docs/TEST_RESULTS.md`

## 4. Definition of Done

- Every cell in the matrix ticked on real devices.
- Clean install on a fresh Windows machine works without manual firewall steps.
- `pnpm check` green; tag `v0.1.0`.
