# M3 — Pairing and Groups

**Status:** 🟡 Code complete. Verified with tests and with two app instances on one Windows machine (real mDNS + WebSockets). Waiting for the two-computer check (§5).

**Goal:** the user decides exactly which devices belong to them. Pair with a QR code or a code, approve on the host, see and manage the device list, remove a device safely.

**Depends on:** M2.

---

## 1. What we built

### Core (`packages/core`)

| Part                            | What it does                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protocol/pairing.ts`           | 12-character Crockford code (generate, format, normalize O→0, I/L→1), QR link build/parse, transcript, pairing key, MACs                                          |
| `application/pairing-host.ts`   | Host session: code + QR, 2-minute expiry, 3 wrong codes, one joiner at a time, Allow / Deny / Cancel, state store                                                 |
| `application/pairing-joiner.ts` | `joinGroup()`: dial, prove the code/token, wait for approval, verify host proof + signed member list, return the group                                            |
| `application/peer-manager.ts`   | Reads the first frame of incoming connections and routes `PAIR_*` to pairing, `HELLO` to sessions; advertises `pm=1` while pairing                                |
| `application/group-keys.ts`     | Current key + 3 previous keys by epoch                                                                                                                            |
| `protocol/handshake.ts`         | Uses the lower of both epochs, so a device that missed a rotation can still connect                                                                               |
| `application/engine.ts`         | `startPairing()`, `removeMember()` (new signed list + key rotation + re-handshake), `renameMember()`, lagging-peer catch-up, `membership` store, `onGroupChanged` |
| `crypto/group-key.ts`           | `generateGroupId()`; group tag now derived from the group id, so it does not change on rotation                                                                   |

### Desktop (`apps/desktop`)

- **First run** ("Join my devices"): searches for computers showing a code (mDNS `pm=1`), code input, optional manual address, live status ("Checking the code…", "Waiting — click Allow…"). Second option: **Start a new group**.
- **Add device** dialog: QR code (for phones, M4), large code, countdown, host address, wrong-code warnings; then **"Allow 'Pixel 8' to join? Only allow devices you own."** with Deny / Allow. The window comes to the front and a notification appears when a device asks to join.
- **Devices** list: Rename and Remove (with confirmation) per device.
- **This computer**: rename itself, **Reset this computer** (forget the group).
- **Removed** banner with **Set up again**.
- Credentials: group key + previous keys (encrypted), member list (JSON). The M2 developer pairing was removed.

## 2. How it works

See PLAN §8.2 (pairing protocol) and §8.4 (removal and key rotation). In short:

```
Computer A: Add device → code K7QM-2XPA-9FRT (+ QR)        Computer B: enters code
   ◄── PAIR_HELLO ── / ── PAIR_CHALLENGE ──► / ◄── PAIR_PROOF ──
   "Allow 'B' to join?"  [Allow]
   ── PAIR_ACCEPT (group id, key, epoch, signed list) ──►   B saves it, starts syncing
   A broadcasts the new member list → every device now trusts B
```

```
Remove "Old Phone" on A
  → new signed list without it → everyone (Old Phone stops: "This device was removed")
  → new key (epoch 2) sealed to each remaining device → forwarded
  → all sessions reconnect with the new key
  → a device that was off reconnects with epoch 1, gets the new key, reconnects with epoch 2
```

## 3. Tests

| Where                                         | What                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/protocol/pairing.test.ts`               | code format/normalization/entropy, QR link round-trip and rejection, MAC binding                                                                                                                                                                                                                           |
| `core/application/pairing-and-groups.test.ts` | phone joins by code then syncs; laptop joins and others learn it; 3 wrong codes; deny; expiry; not pairing; joiner gives up; QR join; impostor host; phones cannot host; rename; remove + rotation; offline member catches up; removed device cannot reconnect; removed device stays removed after restart |
| `core/protocol/protocol.test.ts`              | epoch negotiation                                                                                                                                                                                                                                                                                          |
| `desktop/main/app-controller.test.ts`         | pair by code and sync; manual address; wrong code / deny / bad input; rename + remove + stored previous keys; self rename survives restart; reset                                                                                                                                                          |
| `desktop/renderer/.../pairing-model.test.ts`  | countdown, approval text, outcomes, join states                                                                                                                                                                                                                                                            |

Manual, two app instances on one machine (real mDNS + WebSockets), via DevTools:

- [x] A: Start a new group → Add device: dialog shows QR, code, "Expires in 2:00", address.
- [x] B finds A in pairing mode in ~0.4 s; enters the code; B shows "Waiting — click Allow…".
- [x] A shows "Allow 'Md-Sikandar (e2eb)' to join? … Only allow devices you own."; Allow → B joined, both "Connected" in < 1 s.
- [x] Rename on A reaches B.
- [x] Remove B on A → B shows "This device was removed"; after restart still removed, "Set up again" returns to the first-run screen.

## 4. Decisions made during M3

- **Group tag from the group id**, not the key: after a rotation, a device with the old key must still recognise its group on the LAN to catch up.
- **Epoch negotiation + 3 previous keys** instead of rejecting old epochs, so offline devices recover without re-pairing.
- **All sessions re-handshake after a rotation**, because the removed device knew the old key.
- **Manual address entry** when joining, for networks where mDNS is blocked.
- **Code pairing uses HMAC, not a PAKE** (documented limitation, PLAN §8.2); QR pairing is not affected.
- A device cannot remove itself; **Reset this computer** forgets the group locally (another device should remove it so the key rotates).

## 5. Definition of Done

- [x] Laptop B joins Laptop A by code; both sync. (two instances, one machine)
- [x] A device that was never paired cannot connect or read anything (tests: colleague, intruder with the group key, impostor host).
- [x] Removed device stops receiving immediately and is told why.
- [x] Pairing errors (`PAIRING_EXPIRED`, `PAIRING_REJECTED`, `PAIRING_CODE_INVALID`) show clear messages.
- [ ] Repeat on two physical computers on the same Wi-Fi (with the M2 checklist).
