# Post-MVP Backlog

Ideas deliberately left out of the MVP, roughly ordered by value.

| Item                                             | Why it matters                            | Notes                                                                                               |
| ------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Android Quick Settings tile** "Send clipboard" | Phone → laptop without the share sheet    | Tile opens a transparent activity that reads the clipboard in foreground (allowed) and sends.       |
| **iOS Local Push Connectivity**                  | Real-time receive on iPhone without cloud | `NEAppPushProvider` runs on a configured Wi-Fi SSID; needs Apple entitlement approval.              |
| **Phone-only groups** (no desktop)               | Two phones sync without a laptop          | Android foreground service can accept connections; iOS still can't — Android becomes the hub.       |
| **Android keyboard (IME) mode**                  | Automatic phone → laptop sync             | Default keyboards may read the clipboard; heavy to build, privacy-sensitive.                        |
| Files (PDF, zip, …)                              | Broader use                               | Reuse image chunking; add a receive-folder setting.                                                 |
| Rich text / HTML                                 | Formatting preserved                      | Send multiple representations per clip.                                                             |
| Linux desktop                                    | More users                                | Electron already supports it; needs clipboard testing (X11/Wayland).                                |
| Hindi UI                                         | User preference                           | Strings already isolated per app.                                                                   |
| PAKE (SPAKE2/CPace) for code pairing             | Stronger code pairing                     | Replace HMAC-with-code step.                                                                        |
| Auto-update (local/LAN-friendly)                 | Easier upgrades                           | Must respect "no cloud" rule — e.g. manual check against a GitHub release only if the user opts in. |
| Smaller desktop app (Tauri)                      | Disk size                                 | Only if core can be shared (e.g. via a JS runtime sidecar).                                         |
