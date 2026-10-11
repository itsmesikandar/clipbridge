# M6 — Image Support

**Status:** 🟡 Code complete; verified with tests and with two desktop instances on Windows (real clipboard, real WebSockets). Android APK built; phone check pending (§5).

**Goal:** copy an image or screenshot on any device and get it on the others.

**Depends on:** M4, M5.

---

## 1. What we built

### Core

| Part        | Change                                                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol    | `CLIP_START` (header: id, origin, time, mime, size, content hash, chunk count), `CLIP_CHUNK` (256 KB raw per chunk, max 40), `CLIP_SKIP` ("already have it / getting it, stop"); `HISTORY_RES.newestImage` |
| Sending     | Text/links in one `CLIP`; images as `CLIP_START` then **paced** chunks (4 every 5 ms) so heartbeats and `CLIP_SKIP` get through and the UI never freezes                                                   |
| Receiving   | One transfer per image (from the first sender); other senders get `CLIP_SKIP`; out-of-order chunks; size + SHA-256 check after reassembly; 30 s timeout; max 2 images in flight per peer                   |
| Forwarding  | A computer forwards an image only after it has the complete, verified image                                                                                                                                |
| History     | Newest 3 images kept (up to 10 MB each); catch-up sends text in `HISTORY_RES` and only the newest image in chunks; the receiver skips older text when a newer image is announced                           |
| Limits      | 10 MB per image (`PAYLOAD_TOO_LARGE`)                                                                                                                                                                      |
| Performance | UTF-8 uses `TextEncoder`/`TextDecoder` when available and an ASCII fast path otherwise (6–10 ms → 0.3 ms per 350 KB frame)                                                                                 |

### Desktop

- Clipboard adapter reads PNG images via Electron 44's `clipboard.read()`; text wins when both are present; images are checked every 2.5 s, backing off to 10 s while the same image stays (reading keeps the Windows clipboard open, which can make other apps' copies fail).
- Writing: JPEG is converted to PNG (`nativeImage`). After writing, the adapter takes what the OS returns as the new baseline, because Windows may re-encode the image — otherwise it would look like a new copy and **ping-pong** between devices.
- Thumbnails (160 px, `nativeImage`) in Recent; notification "Image from …".

### App layer

- `HistoryItemView.thumbnail`; images show as "Image · 1.4 MB"; platform `makeThumbnail` with caching.

### Mobile

- Share sheet accepts `image/*`: PNG/JPEG sent as is; HEIC/WebP or images over 10 MB are converted to JPEG (max 2560 px) with `expo-image-manipulator`.
- "Send clipboard" sends text, or the clipboard image when there is no text.
- Notification **Copy** puts images on the phone clipboard (`expo-clipboard` `setImageAsync`).
- Thumbnails in Recent.

## 2. Tests

- Core (`images.test.ts`): 1.2 MB image to every device intact; photo from one phone to computers and the other phone; >10 MB refused; catch-up = text history + newest image, one notification; only 3 images kept; out-of-order reassembly + ACK; hash mismatch dropped; 30 s timeout; in-flight limit; `CLIP_SKIP` stops the sender; pacing.
- Desktop: image detection, text preferred, no echo after re-encoding, backoff.
- Mobile: MIME support, data-URL decoding.
- `pnpm check`: core 211, app 57, desktop 35, mobile 17.

## 3. Verified on Windows (two app instances)

- [x] 400×300 PNG copied in Windows → other instance received it with a thumbnail; no ping-pong after 15 s.
- [x] 1920×1080 noise PNG (6.0 MB) → arrived in ~6 s (including up to 2.5 s detection).

## 4. Known limitations

- Two instances on one computer share the clipboard, so both detect the same copy (test artifact).
- No "Save to gallery" on phones yet (Copy only).
- Images travel base64 inside JSON, encrypted, then base64 again (~1.8× size on the wire). Binary frames are a later optimization.

## 5. To check on the phone

- [ ] Screenshot on Windows → notification "Image from …" with a thumbnail in Recent → Copy → paste into a chat app.
- [ ] Share a photo from the gallery → appears on the computer clipboard → Ctrl+V into a document.
- [ ] "Send clipboard" with an image copied on the phone.
- [ ] A 12 MB photo → converted and sent (or a clear error).
