/**
 * @module @satoshibits/cache-metrics/connect
 * @description Helper function to connect cache events to metrics collector
 * @since 2025-07-29
 */

import type { CacheCollector } from "./cache-collector.mjs";
import type { CacheEvent, CacheOperation } from "./types.mjs";

// Type for cache instance - we don't want to depend on @satoshibits/cache
interface CacheWithEvents {
  on(listener: (event: CacheEvent) => void): () => void;
}

/**
 * Connect a cache instance to a metrics collector
 *
 * This helper function automatically wires up all cache events to the
 * appropriate metrics collector methods, eliminating boilerplate code.
 *
 * @param {CacheWithEvents} cache - Cache instance with event emitter
 * @param {CacheCollector} collector - Metrics collector instance
 * @returns {() => void} Unsubscribe function
 *
 * @example
 * ```typescript
 * import { Cache } from '@satoshibits/cache';
 * import { CacheCollector, connectCacheToMetrics } from '@satoshibits/cache-metrics';
 *
 * const cache = new Cache({ adapter });
 * const collector = new CacheCollector();
 *
 * // Connect them
 * const unsubscribe = connectCacheToMetrics(cache, collector);
 *
 * // Later, to disconnect:
 * unsubscribe();
 * ```
 *
 * @since 2025-07-29
 */
export function connectCacheToMetrics(
  cache: CacheWithEvents,
  collector: CacheCollector,
): () => void {
  const listener = (event: CacheEvent) => {
    switch (event.type) {
      case "hit":
        collector.recordHit(event.key, event.duration);
        break;

      case "miss":
        collector.recordMiss(event.key, event.duration);
        break;

      case "set":
        collector.recordSet(event.key, event.duration);
        break;

      case "delete":
        collector.recordDelete(event.key, event.duration);
        break;

      case "error":
        collector.recordError(
          (event.metadata?.operation ?? "get") as CacheOperation,
          event.error,
        );
        break;

      case "stampede_prevented":
        collector.recordStampedePrevented();
        break;
    }
  };

  // Subscribe to cache events
  return cache.on(listener);
}
