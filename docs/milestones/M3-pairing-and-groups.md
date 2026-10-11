# M3 — Pairing and Groups

**Goal:** the user decides exactly which devices belong to them. Pair with a QR code or a code, approve on the host, see and manage the device list, remove a device safely.

**Depends on:** M2.

---

## 1. What we build

- Identity key pair generated on first launch (Ed25519 + X25519), stored in secure storage.
- First-run flow: "Create my group" (generates group key, epoch 1) **or** "Join an existing group".
- **Host side** (any paired desktop): "Add device" → pairing mode (2 min) → shows QR + 12-character code → approve/deny prompt.
- **Joiner side (desktop):** "Join" → lists hosts in pairing mode found by mDNS → enter code.
- Device list: name, platform icon, status, last seen, rename, remove.
- Unpair with key rotation and membership broadcast.
- Removes the M2 dev-group shortcut.

## 2. How it works

### 2.1 Pairing sequence

```
Host (desktop, pairing mode)                       Joiner (phone or laptop)
  advertise pm=1, show QR {addr, port, hostPub, token}
                                                     scan QR / enter code
                         ◄── PAIR_HELLO {joinerPub, ephPub} ──
  ephemeral X25519 → pairing session key
                         ── PAIR_CHALLENGE {ephPub, nonce} ──►
                         ◄── PAIR_PROOF {HMAC(token, transcript), deviceName, platform} ──
  verify proof (3 attempts max)
  UI: "Allow 'Pixel 8' (Android) to join?"  [Deny] [Allow]
                         ── PAIR_ACCEPT {groupKey, epoch, members} (encrypted) ──►
  add joiner to members (version+1), broadcast signed MEMBERSHIP to group
                                                     store keys, connect normally
```

- Token/code single use; pairing mode exits on success, deny, timeout or 3 bad proofs.
- QR payload format: `clipbridge://pair?h=<ip1,ip2>&p=<port>&k=<hostPub>&t=<token>&v=1` (base64url).
- Codes use Crockford base32 (no ambiguous characters), entered case-insensitively with or without dashes.

### 2.2 Membership

- Member list = `{ version, members[], signedBy, signature }`. Highest version wins; ties broken by signer id.
- On connect, peers compare versions and send the newer list.
- A device receiving a list without itself → `REMOVED_FROM_GROUP`, wipes group key, shows "Pair again".

### 2.3 Unpair + rotation

```
User removes "Old Phone" on Laptop A
  → A: new groupKey (epoch+1)
  → A: MEMBERSHIP v+1 without Old Phone (signed)
  → A: KEY_ROTATE { epoch, sealed: { [memberId]: seal(groupKey, memberX25519) } }
  → connected members switch immediately; old sessions closed and re-handshaked
  → offline members: on reconnect at old epoch, receive their sealed key, then continue
  → Old Phone: rejected (not a member) → shows AUTH_FAILED / REMOVED_FROM_GROUP
```

### 2.4 Data stored per device

| Item                              | Storage        |
| --------------------------------- | -------------- |
| Identity private keys, group key  | Secure storage |
| Members, settings, last-seen info | Plain storage  |
| Pairing tokens                    | Memory only    |

## 3. UI

- Onboarding screens: Welcome → Create group / Join group.
- "Add device" dialog: QR (large), code below, countdown, cancel.
- Approve dialog shows device name + platform + **"Only allow devices you own."**
- Device list item menu: Rename, Remove (confirmation: "Old Phone will stop receiving clips immediately.").

## 4. Tasks

- [ ] Identity key generation + secure storage
- [ ] Pairing state machines in core (`host`, `joiner`) with unit tests for every branch (success, deny, timeout, bad code ×3, replay)
- [ ] Membership signing/verification + merge rules
- [ ] Key rotation flow + offline catch-up
- [ ] Desktop onboarding, add-device, approve, join, device list UI + presenters
- [ ] Remove dev-group code
- [ ] Integration test: 3 engines; add 4th; remove 2nd; 2nd cannot connect; others still sync

## 5. Definition of Done

- Laptop B joins Laptop A by code; both sync.
- A device on the same Wi-Fi that was never paired cannot connect or read anything (tested with a third laptop).
- Removed device stops receiving immediately and is told why.
- All pairing errors (`PAIRING_EXPIRED`, `PAIRING_REJECTED`, `PAIRING_CODE_INVALID`) show clear messages.
