# ADR 0002 — Local network only, no cloud

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

The user requirement is that ClipBridge works on the same Wi-Fi/LAN without any cloud service, and explains clearly when devices are not on the same network.

## Decision

- Devices discover each other with **mDNS/DNS-SD** and talk over **WebSocket** directly on the LAN.
- No relay server, no push notification service (FCM/APNs), no accounts, no analytics, no cloud builds.
- Desktops act as hubs; phones connect to desktops.
- Connection problems are diagnosed locally and shown with fix steps (see PLAN §9).

## Consequences

- Sync does not work across different networks — by design.
- iOS cannot receive in the background (no APNs); it catches up when the app opens. Apple Local Push Connectivity is a later option.
- Networks with client isolation (guest/office Wi-Fi) block sync; the app detects and explains this.
- Phone-to-phone sync needs a desktop online in the MVP.
