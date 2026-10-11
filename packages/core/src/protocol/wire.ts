/** Conversion between domain objects and their wire (JSON) form. */

import { computeContentHash } from '../crypto/content-hash';
import { type Clip, type ClipContent, isEmptyContent, validateContentSize } from '../domain/clip';
import type { DeviceRecord } from '../domain/device';
import { type AppError, appError } from '../domain/errors';
import type { ClipId, DeviceId } from '../domain/ids';
import type { Membership } from '../domain/membership';
import { err, ok, type Result } from '../domain/result';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import type { WireClip, WireDevice, WireMembership } from './frames';

export function clipToWire(clip: Clip): WireClip {
  const base = { id: clip.id, origin: clip.origin, createdAt: clip.createdAt };
  const content = clip.content;
  switch (content.kind) {
    case 'text':
      return { ...base, kind: 'text', text: content.text };
    case 'url':
      return { ...base, kind: 'url', url: content.url };
    case 'image':
      return { ...base, kind: 'image', mime: content.mime, data: bytesToBase64(content.data) };
  }
}

/** Rebuilds a clip from validated wire data; recomputes the hash locally. */
export function clipFromWire(wire: WireClip): Result<Clip, AppError> {
  let content: ClipContent;
  switch (wire.kind) {
    case 'text':
      content = { kind: 'text', text: wire.text };
      break;
    case 'url':
      content = { kind: 'url', url: wire.url };
      break;
    case 'image': {
      const data = base64ToBytes(wire.data);
      if (!data)
        return err(appError('PROTOCOL_ERROR', 'invalid image data', { reason: 'image base64' }));
      content = { kind: 'image', mime: wire.mime, data };
      break;
    }
  }
  if (isEmptyContent(content)) {
    return err(appError('PROTOCOL_ERROR', 'empty clip', { reason: 'empty clip' }));
  }
  const sized = validateContentSize(content);
  if (!sized.ok) return sized;
  return ok({
    id: wire.id as ClipId,
    origin: wire.origin as DeviceId,
    createdAt: wire.createdAt,
    content,
    hash: computeContentHash(content),
  });
}

export function deviceToWire(device: DeviceRecord): WireDevice {
  return { ...device };
}

export function deviceFromWire(wire: WireDevice): DeviceRecord {
  return { ...wire, id: wire.id as DeviceId };
}

export function membershipToWire(membership: Membership): WireMembership {
  return { ...membership, members: membership.members.map(deviceToWire) };
}

export function membershipFromWire(wire: WireMembership): Membership {
  return {
    ...wire,
    updatedBy: wire.updatedBy as DeviceId,
    members: wire.members.map(deviceFromWire),
  };
}
