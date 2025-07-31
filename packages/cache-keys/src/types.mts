/**
 * Generic ID type that replaces MongoDB's ObjectId
 * Supports strings, numbers, or any object with a toString method
 */
export type ID = string | number | { toString(): string };

/**
 * Base interface for cache key factories
 */
export interface CacheKeyFactory<T extends string = string, TArgs extends readonly unknown[] = unknown[]> {
  /**
   * Generate a cache key
   */
  key(...args: TArgs): T;
  
  /**
   * Parse a cache key back into its components
   */
  parse(key: T): Record<string, string> | null;
  
  /**
   * Check if a key matches this factory's pattern
   */
  matches(key: string): key is T;
  
  /**
   * Get all keys matching this factory's pattern (for cache invalidation)
   */
  pattern(): string;
}

/**
 * Options for key sanitization
 */
export interface SanitizeOptions {
  /**
   * Whether to allow colons in the key component
   * @default false
   */
  allowColons?: boolean;
  
  /**
   * Custom encoding function
   * @default base64url encoding
   */
  encoder?: (value: string) => string;
}

/**
 * Cache key builder options
 */
export interface KeyBuilderOptions {
  /**
   * Separator between key components
   * @default ':'
   */
  separator?: string;
  
  /**
   * Whether to sanitize components
   * @default true
   */
  sanitize?: boolean;
}