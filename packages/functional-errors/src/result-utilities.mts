/**
 * @module result-utilities
 * @description Built-in utilities for working with Result types and Promises
 * @since 2025-01-13
 */

import { Result } from "@satoshibits/functional";

import type { ErrorType } from "./types.mjs";

import { createOperationalError } from "./types.mjs";

/**
 * Safely transforms an error using the provided transformer with fallback
 * If the transformer itself throws, returns a fallback operational error
 *
 * @internal
 */
function safeErrorTransform(
  error: unknown,
  errorTransform: (error: unknown) => ErrorType
): ErrorType {
  try {
    return errorTransform(error);
  } catch (transformError) {
    // fallback if the transformer itself throws
    return createOperationalError(
      `Error transform failed: ${transformError instanceof Error ? transformError.message : String(transformError)}`,
      false
    );
  }
}

/**
 * Converts a Promise-based function to a Result-based function
 *
 * @category Utilities
 * @since 2025-01-13
 *
 * @description
 * Wraps a Promise-returning function and catches any errors, converting them to Result types.
 * This is the primary bridge between Promise-based APIs and Result-based error handling.
 *
 * **IMPORTANT:** The errorTransform parameter is required to ensure explicit error classification.
 * The library cannot make assumptions about error semantics (operational vs critical, retryable vs not).
 *
 * @example
 * ```typescript
 * // Explicit error transformation (required)
 * const result = await tryCatch(
 *   () => fetch('/api/data').then(r => r.json()),
 *   (error) => createOperationalError(error instanceof Error ? error.message : String(error), true)
 * );
 * ```
 *
 * @example
 * ```typescript
 * // With detailed error handling
 * const result = await tryCatch(
 *   () => database.query('SELECT * FROM users'),
 *   (error) => {
 *     if (error instanceof DatabaseConnectionError) {
 *       return createOperationalError('DB connection failed', true);
 *     }
 *     return createCriticalError('Unexpected database error');
 *   }
 * );
 * ```
 *
 * @param fn - Async function that returns a Promise
 * @param errorTransform - Function to transform caught errors into ErrorType (required for explicit classification)
 * @returns Promise resolving to Result with either the success value or error
 */
export async function tryCatch<T>(
  fn: () => Promise<T>,
  errorTransform: (error: unknown) => ErrorType  // Required - no default
): Promise<Result<T, ErrorType>> {
  try {
    const data = await fn();
    return Result.ok(data);
  } catch (error) {
    const errorType = safeErrorTransform(error, errorTransform);
    return Result.err(errorType);
  }
}

/**
 * Synchronous version of tryCatch for non-async functions
 *
 * @category Utilities
 * @since 2025-01-13
 *
 * @description
 * Wraps a synchronous function that might throw and converts it to a Result.
 * Useful for working with APIs that throw exceptions like JSON.parse.
 *
 * **IMPORTANT:** The errorTransform parameter is required to ensure explicit error classification.
 *
 * @example
 * ```typescript
 * // Parse JSON with explicit error transformation
 * const result = tryCatchSync(
 *   () => JSON.parse(jsonString),
 *   (error) => createValidationError(error instanceof Error ? error.message : 'Invalid JSON')
 * );
 * ```
 *
 * @example
 * ```typescript
 * // With detailed error handling
 * const result = tryCatchSync(
 *   () => riskyOperation(),
 *   (error) => {
 *     if (error instanceof ValidationError) {
 *       return createValidationError('Validation failed', { details: error });
 *     }
 *     return createCriticalError('Unexpected error');
 *   }
 * );
 * ```
 *
 * @param fn - Synchronous function that might throw
 * @param errorTransform - Function to transform caught errors into ErrorType (required for explicit classification)
 * @returns Result with either the success value or error
 */
export function tryCatchSync<T>(
  fn: () => T,
  errorTransform: (error: unknown) => ErrorType  // Required - no default
): Result<T, ErrorType> {
  try {
    const data = fn();
    return Result.ok(data);
  } catch (error) {
    const errorType = safeErrorTransform(error, errorTransform);
    return Result.err(errorType);
  }
}

// Re-export the original Result type for use in function signatures
export type { Result as ResultType } from "@satoshibits/functional";
