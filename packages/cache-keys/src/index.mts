/**
 * @satoshibits/cache-keys - Type-safe cache key generation
 *
 * A zero-dependency library for generating consistent, type-safe cache keys
 * with built-in sanitization and pattern matching capabilities.
 */

// Core types
export type {
  ID,
  CacheKeyFactory,
  KeyBuilderOptions,
  SanitizeOptions,
} from "./types.mjs";

// Sanitizer utilities
export {
  sanitizeKeyComponent,
  decodeKeyComponent,
  isValidKeyComponent,
  joinKeyComponents,
  splitKeyComponents,
  base64urlDecode,
} from "./sanitizer.mjs";

// Factory functions
export {
  createKeyFactory,
  createSimpleKeyFactory,
  createDualKeyFactory,
  createPaginatedKeyFactory,
  createVersionedKeyFactory,
} from "./factory.mjs";

// Builder pattern
export { CacheKeyBuilder, fromTemplate, scopedBuilder } from "./builder.mjs";

// Pattern matching
export {
  createInvalidationPattern,
  matchKeys,
  createMultiPattern,
  extractNamespace,
  extractKeyType,
  groupKeysByNamespace,
  createHierarchicalPatterns,
  matchesAnyPattern,
} from "./patterns.mjs";

// Preset key factories
export { accountKeys } from "./presets/account.mjs";
export { userKeys } from "./presets/user.mjs";
export { campaignKeys } from "./presets/campaign.mjs";
export { analyticsKeys } from "./presets/analytics.mjs";

import type { CacheKeyFactory as CKF } from "./types.mjs";
import { sanitizeKeyComponent } from "./sanitizer.mjs";

/**
 * Utility function to create a new set of key factories for a domain
 * 
 * This function serves as a type-safe helper for organizing cache key factories
 * by domain. It ensures that all factories in a domain follow the correct type
 * structure and provides a consistent way to group related cache keys.
 * 
 * @param namespace The domain namespace (currently unused but reserved for future enhancements)
 * @param factories Object containing cache key factories for the domain
 * @returns The same factories object with type validation
 * 
 * @example
 * export const orderKeys = createDomainKeys('order', {
 *   details: createSimpleKeyFactory('order', 'details'),
 *   items: createPaginatedKeyFactory('order', 'items'),
 *   status: createKeyFactory('order', 'status', 
 *     (orderId: string, status: string) => `${orderId}:${status}`
 *   )
 * });
 */
export function createDomainKeys<
  T extends Record<string, CKF<string, any[]>>,
>(namespace: string, factories: T): T {
  // Currently a pass-through function that provides type safety
  // Future versions may add namespace validation or factory enhancement
  return factories;
}

// Re-export common patterns for convenience
export const commonPatterns = {
  /**
   * Invalidate all keys in a namespace
   * @example commonPatterns.namespace('user')
   * @returns 'user:*'
   */
  namespace: (namespace: string) => `${namespace}:*`,

  /**
   * Invalidate all keys of a specific type in a namespace
   * @example commonPatterns.type('user', 'profile')
   * @returns 'user:profile:*'
   */
  type: (namespace: string, type: string) => `${namespace}:${type}:*`,

  /**
   * Invalidate all keys for a specific ID across all types
   * @example commonPatterns.allForId('user', '123')
   * @returns 'user:*:123*'
   */
  allForId: (namespace: string, id: string | number) => 
    `${namespace}:*:${sanitizeKeyComponent(String(id))}*`,
} as const;
