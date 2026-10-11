# M0 — Foundation

**Goal:** an empty but production-grade monorepo. Every later milestone only adds code, never re-does tooling.

**Depends on:** nothing.

---

## 1. What we build

- pnpm monorepo with `apps/desktop`, `apps/mobile`, `packages/core`, `packages/test-utils`, `packages/tsconfig`, `packages/eslint-config`.
- Shared TypeScript, ESLint, Prettier configuration.
- Desktop app that opens an empty window and a tray icon.
- Mobile app (Expo dev build) that opens an empty screen on Android emulator and iOS simulator.
- Local quality gate: one command runs lint, typecheck and tests for everything.
- Git repository with commit hooks.

## 2. How it is built

### 2.1 Workspace

1. `git init`, `.gitignore` (node_modules, dist, out, build, .expo, ios/, android/ generated folders, `*.log`, `.env*`).
2. Root `package.json` with `"packageManager": "pnpm@<latest>"`, `"engines": { "node": ">=24" }`.
3. `pnpm-workspace.yaml`: `apps/*`, `packages/*`.
4. `.editorconfig`, `.prettierrc` (2 spaces, single quotes, trailing commas, 100 cols), `.nvmrc` (`24`).

### 2.2 Shared configs

- `packages/tsconfig`: `base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `isolatedModules`), `node.json`, `react.json`, `react-native.json`.
- `packages/eslint-config`: flat config with `typescript-eslint` (type-aware), `eslint-plugin-react`, `react-hooks`, `import` ordering, and **boundary rules**:
  - `packages/core/src/domain/**` may import nothing outside `domain`.
  - `packages/core/src/application/**` may import `domain` and `ports` only.
  - `packages/core/**` may not import `react`, `react-native`, `electron`, `node:*`, `expo-*`.

### 2.3 Packages

- `packages/core`: `src/index.ts` exporting a version constant; Vitest set up. Consumed **as TypeScript source** (no build step) — electron-vite and Metro compile it (ADR 0001).
- `packages/test-utils`: empty, Vitest ready.

### 2.4 Desktop

- Scaffold with `electron-vite` (React + TS template), then restructure into `main/`, `preload/`, `renderer/`, `shared/` as in PLAN §5.5.
- Security defaults: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP meta tag, `setWindowOpenHandler` denying new windows, single-instance lock.
- Tray icon with "Open" and "Quit".
- Imports `@clipbridge/core` and renders its version (proves the workspace link works).

### 2.5 Mobile

- `create-expo-app` with TypeScript + `expo-router`; enable dev builds (`expo-dev-client`).
- Monorepo support: Expo's Metro config detects the workspace automatically (no custom `metro.config.js`); `nodeLinker: hoisted` in `pnpm-workspace.yaml` for React Native compatibility.
- Imports `@clipbridge/core` and renders its version.

### 2.6 Scripts (root)

| Script             | Does                                             |
| ------------------ | ------------------------------------------------ |
| `pnpm dev:desktop` | run desktop in dev mode                          |
| `pnpm dev:mobile`  | start Expo dev server                            |
| `pnpm lint`        | ESLint all packages                              |
| `pnpm typecheck`   | `tsc --noEmit` all packages                      |
| `pnpm test`        | all unit tests                                   |
| `pnpm check`       | lint + typecheck + test (the local quality gate) |
| `pnpm format`      | Prettier write                                   |

### 2.7 Git hooks and docs

- Husky + lint-staged: Prettier + ESLint on staged files; commitlint for Conventional Commits.
- `README.md`: what it is, prerequisites (Node 24, pnpm, Android Studio, Xcode on Mac), how to run each app.
- `docs/adr/0001-monorepo-and-stack.md`, `0002-lan-only.md`, `0003-electron-over-tauri.md`.

## 3. Tasks

- [x] Workspace, root configs, `.gitignore`
- [x] `packages/tsconfig`, `packages/eslint-config` with boundary rules
- [x] `packages/core` skeleton + Vitest
- [x] `packages/test-utils` skeleton
- [x] Desktop scaffold, security defaults, tray, typed IPC (`app:get-info`)
- [x] Mobile scaffold (template demo removed), Android JS bundle builds
- [ ] Mobile dev build runs on an emulator/device (needs an Android emulator or phone)
- [x] Root scripts, Husky, lint-staged, commitlint
- [x] README + first 3 ADRs

## 4. Definition of Done

- [x] `pnpm install && pnpm check` passes.
- [x] `pnpm dev:desktop` opens a window showing app/core/protocol versions (verified via DevTools protocol, dev and production build).
- [ ] Tray icon visible with Open/Quit (check manually).
- [ ] Mobile dev build runs on an Android emulator or phone (and iOS simulator if a Mac is available) showing the core version.
- [x] A deliberate boundary violation (e.g. importing `electron` or `node:fs` in core, or `application/` from `domain/`) fails `pnpm lint`.

## 5. Versions pinned at M0

Node 24, pnpm 12, TypeScript 6.0 (typescript-eslint does not support TS 7 yet), ESLint 10, Electron 44, electron-vite 5 + Vite 7, React 19.2 (aligned with Expo), Expo SDK 57 / React Native 0.86, Vitest 5, Jest 29 (required by jest-expo).
