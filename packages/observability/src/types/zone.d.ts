/**
 * Global Zone.js type declaration for runtime detection.
 *
 * Zone.js is optionally used for async context propagation in browser environments.
 * This declaration allows TypeScript to recognize the Zone global without requiring
 * zone.js to be imported (it may be provided by Angular or bundled separately).
 *
 * We only declare what we need for runtime detection - the full Zone API types
 * are available from zone.js package if needed.
 */
declare const Zone: { current?: unknown } | undefined;
