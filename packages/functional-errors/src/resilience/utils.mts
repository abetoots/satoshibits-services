/**
 * Utility types and classes for resilience patterns
 */

import { Result } from '@satoshibits/functional';
import type { ErrorType } from '../types.mjs';

/**
 * Custom error class to preserve Result errors through cockatiel's exception-based flow
 *
 * This solves the impedance mismatch between cockatiel (exception-based) and
 * our Result pattern without requiring function re-execution.
 */
export class ResultError<E> extends Error {
  constructor(public readonly originalError: E) {
    super('Result contained an error');
    this.name = 'ResultError';

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, ResultError.prototype);
  }
}

/**
 * Executes a Result-returning function and converts it to cockatiel's exception-based flow
 * Throws ResultError if the Result contains an error, returns the data if successful
 *
 * This utility centralizes the Result-to-exception conversion pattern used in circuit breaker.
 * Note: Not used in retry because retry needs direct access to result.error for lastError tracking.
 *
 * @param fn - Function returning a Result
 * @returns The unwrapped data value
 * @throws {ResultError} If the Result contains an error
 *
 * @internal
 */
export async function executeResultForCockatiel<T, E extends ErrorType>(
  fn: () => Promise<Result<T, E>>
): Promise<T> {
  const result = await fn();

  if (result.success) {
    return result.data;
  }

  // wrap error in ResultError for cockatiel to handle
  throw new ResultError(result.error);
}
