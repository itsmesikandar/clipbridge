# ADR 0001 — TypeScript monorepo with a shared core

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

ClipBridge runs on Windows, macOS, Android and iOS. The protocol, encryption, sync and pairing logic must behave identically everywhere, or devices will not understand each other.

## Decision

- One **pnpm workspace** with `apps/desktop`, `apps/mobile` and `packages/*`.
- All logic that is not platform-specific lives in **`@clipbridge/core`**, written in strict TypeScript with no platform imports. Apps provide adapters for core ports (clean architecture / ports and adapters).
- Internal packages are consumed **as TypeScript source** (no build step). Bundlers (electron-vite, Metro) compile them.
- `nodeLinker: hoisted`, because React Native tooling expects a flat `node_modules`.
- React versions are aligned with the Expo SDK so a single hoisted copy serves both apps.

## Consequences

- A protocol change is made once and is picked up by every app.
- Core is testable in plain Node with Vitest, without devices.
- Hoisting makes accidental use of undeclared dependencies possible; ESLint and code review must catch it.
- Version upgrades of React must follow the Expo SDK.
