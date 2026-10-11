This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

This app lives in a pnpm monorepo (see the root `README.md` and `docs/PLAN.md`). Run from `apps/mobile`:

```bash
npx expo install <package>  # ALWAYS use instead of pnpm add — resolves SDK-compatible versions
pnpm start                  # start the dev server (development build)
pnpm android | pnpm ios     # build and run a development build locally
pnpm lint                   # lint (shared config from @clipbridge/eslint-config)
pnpm typecheck              # typecheck
pnpm test                   # unit tests (jest-expo)
pnpm doctor                 # diagnose dependency and config issues
```

Run lint, typecheck and tests before declaring any task done.

## Architecture

- Screens in `src/app/` stay thin: they render feature views and nothing else.
- Each feature in `src/features/<name>/` has a dumb view, a presenter hook (`use-<name>-presenter.ts`) and tests.
- Sync logic lives in `@clipbridge/core`; platform code goes in `src/adapters/` implementing core ports.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building

ClipBridge is local-only: builds run on the developer machine (`expo run:android|ios`, Gradle, Xcode). Do not add EAS cloud builds, EAS Update or any other cloud service without an explicit decision recorded in `docs/adr/`.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `pnpm android` / `pnpm ios`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md
