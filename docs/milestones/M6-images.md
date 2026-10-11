# M6 — Image Support

**Goal:** copy an image or screenshot on any device and get it on the others.

**Depends on:** M4, M5.

---

## 1. What we build

- **Core:** `Clip.kind = "image"` with `mime: "image/png" | "image/jpeg"`, `width`, `height`, `bytes`. Size limit 10 MB enforced before sending (`PAYLOAD_TOO_LARGE`).
- **Protocol:** images travel inside the encrypted `CLIP` payload (base64). Frames > 1 MB are split into `CLIP_CHUNK` frames (512 KB each, with index/total and a final hash check) so heartbeats are not blocked and memory stays bounded.
- **Desktop:** clipboard adapter detects images (`clipboard.readImage()`), hashes PNG bytes only when `availableFormats` changed; writes images with `nativeImage.createFromBuffer`.
- **Android/iOS:** share sheet accepts `image/*`; received images shown as thumbnails; **Copy** writes the image to the clipboard (`expo-clipboard` `setImageAsync`); **Save** stores to the gallery (`expo-media-library`, permission asked on first use).
- **History:** thumbnails (max 256 px) stored; full images kept only for the latest 5 image clips, the rest are dropped from disk.

## 2. How it works

```
Laptop: Win+Shift+S screenshot → clipboard has image
  → adapter reads PNG (≤ 10 MB) → engine chunks + encrypts → hub
Android: notification with thumbnail [Copy] [Save]
iPhone: shown on next app open
```

## 3. Tasks

- [ ] Image clip type + chunking in protocol (tests for reassembly, missing chunk, wrong hash, timeout)
- [ ] Desktop image read/write + change detection without high CPU
- [ ] Mobile share `image/*`, receive, Copy, Save
- [ ] Thumbnail generation and history pruning
- [ ] Size limit errors on both sides

## 4. Definition of Done

- Screenshot on Windows/macOS → Copy on phone → paste into a chat app works.
- Photo shared from phone gallery → Ctrl+V into a document on laptop works.
- 12 MB image → clear `PAYLOAD_TOO_LARGE` message, nothing sent.
- Desktop idle CPU still < 1 %.
