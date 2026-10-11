/**
 * Wire protocol version. Peers with a different version cannot talk to each
 * other and show VERSION_MISMATCH (docs/PLAN.md §7.3).
 */
export const PROTOCOL_VERSION = 1;

/** Upper bound for one raw WebSocket frame, in characters. */
export const MAX_FRAME_CHARS = 20 * 1024 * 1024;
