/**
 * Thenable detection utility
 * 
 * Provides type-safe detection of thenable/promise-like objects without
 * using unsafe `any` types.
 */

/**
 * Type guard to check if a value is thenable (has a .then method)
 * 
 * @param value - Value to check for thenable behavior
 * @returns True if the value has a callable .then method
 * 
 * @example
 * ```typescript
 * const result = someFunction();
 * if (isThenable(result)) {
 *   return result.then(handleSuccess).catch(handleError);
 * }
 * return result;
 * ```
 */
export function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}