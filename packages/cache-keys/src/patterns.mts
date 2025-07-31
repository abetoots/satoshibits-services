import type { CacheKeyFactory } from './types.mjs';
import { sanitizeKeyComponent } from './sanitizer.mjs';

/**
 * Create an invalidation pattern from a key factory and partial arguments
 * 
 * @param factory The key factory to use
 * @param prefixArgs Partial arguments to create a prefix pattern
 * @returns A pattern string for matching keys
 * 
 * @example
 * // Invalidate all campaign keys for an account
 * const pattern = createInvalidationPattern(campaignKeys.list, accountId);
 * // Returns: "campaign:list:507f1f77bcf86cd799439011:*"
 */
export function createInvalidationPattern(
  factory: CacheKeyFactory,
  ...prefixArgs: unknown[]
): string {
  if (prefixArgs.length === 0) {
    return factory.pattern();
  }
  
  // Get the factory pattern and extract the prefix
  const fullPattern = factory.pattern();
  const prefix = fullPattern.substring(0, fullPattern.lastIndexOf(':') + 1);
  
  // Sanitize all arguments to prevent injection
  const prefixParts = prefixArgs.map(arg => sanitizeKeyComponent(String(arg)));
  
  return prefix + prefixParts.join(':') + ':*';
}

/**
 * Match keys against a pattern
 * 
 * @param keys Array of cache keys
 * @param pattern Pattern to match against (supports * wildcard)
 * @returns Array of matching keys
 */
export function matchKeys(keys: string[], pattern: string): string[] {
  // Convert pattern to regex
  const regexPattern = pattern
    .split('*')
    .map(part => escapeRegex(part))
    .join('.*');
  
  const regex = new RegExp(`^${regexPattern}$`);
  
  return keys.filter(key => regex.test(key));
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a pattern that matches any of the given prefixes
 * 
 * @param prefixes Array of key prefixes
 * @returns A regex pattern for matching
 */
export function createMultiPattern(prefixes: string[]): RegExp {
  const escapedPrefixes = prefixes.map(escapeRegex);
  return new RegExp(`^(${escapedPrefixes.join('|')})`);
}

/**
 * Extract the namespace from a cache key
 * 
 * @param key The cache key
 * @param separator The separator used in the key
 * @returns The namespace or null if invalid
 */
export function extractNamespace(key: string, separator = ':'): string | null {
  const firstSeparatorIndex = key.indexOf(separator);
  if (firstSeparatorIndex === -1) {
    return null;
  }
  return key.substring(0, firstSeparatorIndex);
}

/**
 * Extract namespace and type from a cache key
 * 
 * @param key The cache key
 * @param separator The separator used in the key
 * @returns Object with namespace and type or null if invalid
 */
export function extractKeyType(
  key: string,
  separator = ':'
): { namespace: string; type: string } | null {
  const parts = key.split(separator);
  if (parts.length < 2) {
    return null;
  }
  
  return {
    namespace: parts[0] ?? '',
    type: parts[1] ?? '',
  };
}

/**
 * Group keys by their namespace
 * 
 * @param keys Array of cache keys
 * @param separator The separator used in keys
 * @returns Map of namespace to keys
 */
export function groupKeysByNamespace(
  keys: string[],
  separator = ':'
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  
  for (const key of keys) {
    const namespace = extractNamespace(key, separator);
    if (namespace) {
      const group = groups.get(namespace) ?? [];
      group.push(key);
      groups.set(namespace, group);
    }
  }
  
  return groups;
}

/**
 * Create a hierarchical pattern for invalidation
 * Useful for invalidating parent and child keys together
 * 
 * @param parts Hierarchical parts of the key
 * @param separator The separator to use
 * @returns Array of patterns from most specific to least specific
 * 
 * @example
 * createHierarchicalPatterns(['user', '123', 'posts'])
 * // Returns: ['user:123:posts:*', 'user:123:*', 'user:*']
 */
export function createHierarchicalPatterns(
  parts: string[],
  separator = ':'
): string[] {
  const patterns: string[] = [];
  
  for (let i = parts.length; i > 0; i--) {
    const prefix = parts.slice(0, i).join(separator);
    patterns.push(`${prefix}${separator}*`);
  }
  
  return patterns;
}

/**
 * Check if a key matches any of the provided patterns
 * 
 * @param key The key to check
 * @param patterns Array of patterns to match against
 * @returns true if the key matches any pattern
 */
export function matchesAnyPattern(key: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  
  // Compile all patterns into a single regex for efficiency
  const megaPattern = patterns
    .map(pattern =>
      pattern
        .split('*')
        .map(part => escapeRegex(part))
        .join('.*')
    )
    .join('|');
  
  const regex = new RegExp(`^(${megaPattern})$`);
  return regex.test(key);
}