/**
 * Public API of @clipbridge/core.
 *
 * Apps must import only from this entry point, never from deep paths.
 */

/** Version of the core library, shown in About / Diagnostics screens. */
export const CORE_VERSION = '0.0.0';

/**
 * Wire protocol version. Peers with a different major version cannot talk
 * to each other (see docs/PLAN.md §7.3).
 */
export const PROTOCOL_VERSION = 1;
