# ADR 0003 — Electron for the desktop app

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

The desktop app must poll the clipboard, run a WebSocket server, advertise and browse mDNS, and reuse `@clipbridge/core` (TypeScript). Tauri was considered for its small binary size.

## Decision

Use **Electron** (with electron-vite, React and TypeScript).

## Consequences

- The Electron main process is Node.js, so core, `ws` and `bonjour-service` run unchanged — one implementation of the logic for desktop and mobile.
- Larger install size (~100 MB) than Tauri. Acceptable for the MVP; revisit later (see `docs/milestones/LATER.md`).
- Security must be configured explicitly: context isolation, sandboxed renderer, no Node in the renderer, strict CSP, typed preload API, validated IPC.
- Electron 44 downloads its binary on demand; `apps/desktop` runs `install-electron` in `postinstall`.
