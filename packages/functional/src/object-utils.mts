/**
 * @module object-utils
 * @description Functional utilities for working with objects in a type-safe, immutable manner.
 * These functions are designed to be composed and follow functional programming principles.
 * All operations return new objects, preserving immutability of the original data.
 * 
 * ### For Dummies
 * - These helpers let you copy objects with surgical precision—no accidental mutations.
 * - Think "clone and tweak" rather than "reach in and change"; every function returns a fresh object.
 * - Great for building DTOs, filtering config, or remapping values without side effects.
 *
 * ### Decision Tree
 * - Only need certain keys? Use `pick(['id', 'name'])(obj)`.
 * - Need to hide sensitive fields? Reach for `omit(['password'])(obj)`.
 * - Want to remap values while keeping keys? Use `mapValues(transform)`.
 * - Merging configs safely? Call `merge(defaults, overrides)` for a deep, non-mutating merge.
 *
 * @example
 * ```typescript
 * import { pick, omit, mapValues, merge } from './object-utils.mts';
 * 
 * // pick specific properties
 * const user = { id: 1, name: 'Alice', email: 'alice@example.com', password: 'secret' };
 * const publicData = pick(['id', 'name', 'email'])(user);
 * // => { id: 1, name: 'Alice', email: 'alice@example.com' }
 * 
 * // omit sensitive fields
 * const safeUser = omit(['password'])(user);
 * // => { id: 1, name: 'Alice', email: 'alice@example.com' }
 * 
 * // transform values
 * const scores = { math: 85, science: 92, history: 78 };
 * const percentages = mapValues((score: number) => `${score}%`)(scores);
 * // => { math: '85%', science: '92%', history: '78%' }
 * 
 * // deep merge objects
 * const defaults = { server: { port: 3000, host: 'localhost' } };
 * const userConfig = { server: { port: 8080 } };
 * const config = merge(defaults, userConfig);
 * // => { server: { port: 8080, host: 'localhost' } }
 * ```
 * 
 * @category Utilities
 * @since 2025-07-03
 */

/**
 * Map over object values while preserving keys.
 * @description Transforms each value in an object while maintaining the same key structure.
 * Creates a new object with the same keys but transformed values.
 * The transformation function receives only the value, not the key.
 * 
 * @template T - The type of values in the input object
 * @template U - The type of values in the output object
 * @param {function(T): U} fn - Transformation function to apply to each value
 * @returns {function(Record<string, T>): Record<string, U>} A function that transforms object values
 * 
 * @category Transformation
 * @example
 * const doubled = mapValues((n: number) => n * 2)({ a: 1, b: 2, c: 3 });
 * // => { a: 2, b: 4, c: 6 }
 * 
 * @example
 * // Convert all strings to uppercase
 * const config = { host: 'localhost', env: 'dev', mode: 'debug' };
 * const upperConfig = mapValues((s: string) => s.toUpperCase())(config);
 * // => { host: 'LOCALHOST', env: 'DEV', mode: 'DEBUG' }
 * 
 * @example
 * // Calculate percentages
 * const scores = { math: 85, science: 92, history: 78 };
 * const percentages = mapValues((score: number) => `${score}%`)(scores);
 * // => { math: '85%', science: '92%', history: '78%' }
 * 
 * @example
 * // Process nested data
 * const users = {
 *   user1: { name: 'Alice', age: 30 },
 *   user2: { name: 'Bob', age: 25 }
 * };
 * const userSummaries = mapValues((user: { name: string; age: number }) => 
 *   `${user.name} (${user.age} years old)`
 * )(users);
 * // => { user1: 'Alice (30 years old)', user2: 'Bob (25 years old)' }
 * 
 * @see pick - Select specific keys
 * @see omit - Remove specific keys
 * @since 2025-07-03
 */
export const mapValues =
  <T, U>(fn: (value: T) => U) =>
  (obj: Record<string, T>): Record<string, U> => {
    const result: Record<string, U> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = fn(value);
    }
    return result;
  };

/**
 * Pick specific keys from an object.
 * @description Creates a new object containing only the specified properties from the source object.
 * Type-safe selection that ensures only existing keys can be picked.
 * Missing keys are silently ignored.
 * 
 * @template T - The type of the source object
 * @template K - The keys to pick from the object
 * @param {K[]} keys - Array of keys to select from the object
 * @returns {function(T): Pick<T, K>} A function that picks the specified keys from an object
 * 
 * @category Selection
 * @example
 * const user = { id: 1, name: 'Alice', email: 'alice@example.com', password: 'secret' };
 * const publicData = pick(['id', 'name', 'email'])(user);
 * // => { id: 1, name: 'Alice', email: 'alice@example.com' }
 * 
 * @example
 * // Extract configuration subset
 * const config = {
 *   apiUrl: 'https://api.example.com',
 *   apiKey: 'secret-key',
 *   timeout: 5000,
 *   debug: true,
 *   version: '1.0.0'
 * };
 * const clientConfig = pick(['apiUrl', 'timeout'])(config);
 * // => { apiUrl: 'https://api.example.com', timeout: 5000 }
 * 
 * @example
 * // Create DTO from entity
 * const entity = {
 *   id: '123',
 *   name: 'Product',
 *   internalCode: 'PRD-123',
 *   _createdAt: new Date(),
 *   _updatedAt: new Date()
 * };
 * const dto = pick(['id', 'name'])(entity);
 * // => { id: '123', name: 'Product' }
 * 
 * @example
 * // Type-safe key selection
 * interface User {
 *   id: number;
 *   name: string;
 *   email: string;
 *   privateData: unknown;
 * }
 * const pickPublicFields = pick<User, 'id' | 'name' | 'email'>(['id', 'name', 'email']);
 * // Result type is Pick<User, 'id' | 'name' | 'email'>
 * 
 * @see omit - Remove specific keys instead
 * @see mapValues - Transform values
 * @since 2025-07-03
 */
export const pick =
  <T extends object, K extends keyof T>(keys: K[]) =>
  (obj: T): Pick<T, K> => {
    const result = {} as Pick<T, K>;
    for (const key of keys) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }
    return result;
  };

/**
 * Omit specific keys from an object.
 * @description Creates a new object containing all properties except the specified ones.
 * Type-safe exclusion that ensures only existing keys can be omitted.
 * Creates a shallow copy of the object without the excluded properties.
 * 
 * @template T - The type of the source object
 * @template K - The keys to omit from the object
 * @param {K[]} keys - Array of keys to exclude from the object
 * @returns {function(T): Omit<T, K>} A function that omits the specified keys from an object
 * 
 * @category Selection
 * @example
 * const user = { id: 1, name: 'Alice', email: 'alice@example.com', password: 'secret' };
 * const safeUser = omit(['password'])(user);
 * // => { id: 1, name: 'Alice', email: 'alice@example.com' }
 * 
 * @example
 * // Remove internal fields
 * const data = {
 *   value: 42,
 *   label: 'Answer',
 *   _internal: true,
 *   _timestamp: Date.now()
 * };
 * const publicData = omit(['_internal', '_timestamp'])(data);
 * // => { value: 42, label: 'Answer' }
 * 
 * @example
 * // Create update payload without readonly fields
 * const entity = {
 *   id: '123',
 *   name: 'Updated Name',
 *   createdAt: '2024-01-01',
 *   updatedAt: '2024-01-15'
 * };
 * const updatePayload = omit(['id', 'createdAt'])(entity);
 * // => { name: 'Updated Name', updatedAt: '2024-01-15' }
 * 
 * @example
 * // Type-safe key exclusion
 * interface Config {
 *   apiUrl: string;
 *   apiKey: string;
 *   timeout: number;
 *   debug: boolean;
 * }
 * const omitSecrets = omit<Config, 'apiKey'>(['apiKey']);
 * // Result type is Omit<Config, 'apiKey'>
 * 
 * @see pick - Select specific keys instead
 * @see mapValues - Transform values
 * @since 2025-07-03
 */
export const omit =
  <T, K extends keyof T>(keys: K[]) =>
  (obj: T): Omit<T, K> => {
    const result = { ...obj };
    for (const key of keys) {
      delete result[key];
    }
    return result;
  };

/**
 * Deep merge two objects.
 * @description Recursively merges source into target, with source values taking precedence.
 * Objects are merged deeply, but arrays, dates, and other non-plain objects are replaced entirely.
 * Null values in source will overwrite target values. Undefined values are ignored.
 * Creates new objects during merge to ensure immutability.
 * 
 * @template T - The type of the target object (must extend Record<string, unknown>)
 * @param {T} target - The base object to merge into
 * @param {DeepPartial<T>} source - The object with updates to apply
 * @returns {T} A new object with merged properties
 * 
 * @category Transformation
 * @example
 * const base = { a: 1, b: { x: 2, y: 3 }, c: 4 };
 * const updates = { b: { y: 5, z: 6 }, d: 7 };
 * const merged = merge(base, updates);
 * // => { a: 1, b: { x: 2, y: 5, z: 6 }, c: 4, d: 7 }
 * 
 * @example
 * // Merge configuration with defaults
 * const defaults = {
 *   server: { port: 3000, host: 'localhost' },
 *   database: { pool: { min: 2, max: 10 } },
 *   logging: { level: 'info' }
 * };
 * const userConfig = {
 *   server: { port: 8080 },
 *   database: { pool: { max: 20 } }
 * };
 * const finalConfig = merge(defaults, userConfig);
 * // => {
 * //   server: { port: 8080, host: 'localhost' },
 * //   database: { pool: { min: 2, max: 20 } },
 * //   logging: { level: 'info' }
 * // }
 * 
 * @example
 * // Update nested state
 * const state = {
 *   user: { id: 1, preferences: { theme: 'light', lang: 'en' } },
 *   app: { version: '1.0.0' }
 * };
 * const updates = {
 *   user: { preferences: { theme: 'dark' } }
 * };
 * const newState = merge(state, updates);
 * // => {
 * //   user: { id: 1, preferences: { theme: 'dark', lang: 'en' } },
 * //   app: { version: '1.0.0' }
 * // }
 * 
 * @example
 * // Handling null and undefined
 * const data = { a: { b: 2 }, c: 3 };
 * const updates = { a: null, c: undefined, d: 4 };
 * const result = merge(data, updates);
 * // => { a: null, c: 3, d: 4 }
 * // null overwrites, undefined is ignored
 * 
 * @see pick - Select specific keys
 * @see omit - Remove specific keys
 * @since 2025-07-03
 */
/**
 * DeepPartial type - makes all properties and nested properties optional.
 * @description Utility type that recursively makes all properties of an object optional.
 * Properly handles null values as valid partial values.
 * 
 * @template T - The type to make deeply partial
 */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> | null : T[P] | null;
};

export const merge = <T extends Record<string, unknown>>(target: T, source: DeepPartial<T>): T => {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      if (
        typeof value === "object" &&
        !Array.isArray(value) &&
        value !== null &&
        !(value instanceof Date) &&
        !(value instanceof RegExp) &&
        Object.prototype.toString.call(value) === '[object Object]'
      ) {
        const targetValue = result[key as keyof T];
        if (targetValue && typeof targetValue === "object" && !Array.isArray(targetValue) && !(targetValue instanceof Date) && !(targetValue instanceof RegExp) && Object.prototype.toString.call(targetValue) === '[object Object]') {
          (result as Record<string, unknown>)[key] = merge(targetValue as Record<string, unknown>, value as DeepPartial<Record<string, unknown>>);
        } else {
          (result as Record<string, unknown>)[key] = value;
        }
      } else {
        (result as Record<string, unknown>)[key] = value;
      }
    }
  }
  return result;
};
