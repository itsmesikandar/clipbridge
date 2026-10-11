# ClipBridge

Copy on one device, paste on another — text, URLs and images between your laptops and phones (Windows, macOS, Android, iOS). Works **only on your local network**: no cloud, no account, no server.

- Plan and architecture: [`docs/PLAN.md`](docs/PLAN.md)
- Milestones: [`docs/milestones/`](docs/milestones)
- Architecture decisions: [`docs/adr/`](docs/adr)

## Repository layout

| Path                     | What                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `apps/desktop`           | Electron app (Windows, macOS)                                                                                            |
| `apps/mobile`            | Expo / React Native app (Android, iOS)                                                                                   |
| `packages/app`           | Shared app layer: app controller, credential storage, view state, user-facing texts                                      |
| `packages/core`          | Shared, platform-neutral logic: protocol, crypto, sync, pairing, diagnostics; test doubles in `@clipbridge/core/testing` |
| `packages/tsconfig`      | Shared TypeScript configs                                                                                                |
| `packages/eslint-config` | Shared ESLint configs, incl. architecture boundary rules                                                                 |

## Prerequisites

- **Node.js 24** (`.nvmrc`) and **pnpm 12** (`corepack enable` picks the version from `package.json`).
- **Android:** Android Studio with an SDK and an emulator, or a phone with USB debugging. Set:
  - `ANDROID_HOME` → e.g. `%LOCALAPPDATA%\Android\Sdk`
  - `JAVA_HOME` → a **JDK 17** (e.g. `%USERPROFILE%\.jdks\ms-17.0.20.1`); Android Studio's bundled JDK 25 breaks the native (CMake) build
- **iOS:** a Mac with Xcode (iOS cannot be built on Windows).

## Getting started

```bash
pnpm install          # also downloads the Electron binary
pnpm dev:desktop      # run the desktop app
pnpm dev:mobile       # start the mobile dev server
```

### Pair your computers

1. On the first computer: **Start a new group**.
2. Click **Add device**. It shows a code (and a QR code for phones).
3. On the other computer: enter the code under **Join my devices**, then click **Allow** on the first computer.

To run two instances on one computer for testing, see [`docs/milestones/M2-desktop-lan-sync.md`](docs/milestones/M2-desktop-lan-sync.md#several-instances-on-one-computer).

App data and logs: `%APPDATA%\ClipBridge` (Windows), `~/Library/Application Support/ClipBridge` (macOS); log file `logs/main.log`.

### Mobile

First run of the mobile app needs a development build on the device/emulator:

```bash
cd apps/mobile
pnpm android          # or: pnpm ios (macOS only)
```

## Quality gate

```bash
pnpm check            # lint + typecheck + tests for every package
pnpm format           # format with Prettier
```

Git hooks (Husky) run ESLint + Prettier on staged files and enforce [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).

## Conventions

- TypeScript strict everywhere; no `any`.
- `packages/core` must not import platform code (Node, Electron, React Native, Expo). Apps implement core **ports** with **adapters**. ESLint fails the build on violations.
- Apps use feature folders: a dumb view, a presenter hook, and tests per feature.
- Workspace packages are consumed as TypeScript source; each app's bundler compiles them. In `apps/desktop` they are `devDependencies` so `electron-vite` bundles them.
