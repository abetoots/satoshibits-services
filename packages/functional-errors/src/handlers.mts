/**
 * Error handlers and transformers for composable error handling
 * Pure functions for transforming and handling errors
 */

import { Result } from '@satoshibits/functional';
import {
  ErrorType,
  ErrorContext,
  isConfigurationError,
  isOperationalError,
  isCriticalError,
  isValidationError,
  isRetryError,
  isCircuitBreakerError,
  isTimeoutError
} from './types.mjs';

/**
 * Error handler function type
 */
export type ErrorHandler<E, T> = (error: E) => Result<T, E>;

/**
 * Error transformer function type
 */
export type ErrorTransformer<E, F> = (error: E) => F;

/**
 * Transform error type
 */
export const mapError = <T, E, F,>(
  transformer: ErrorTransformer<E, F>
) => (
  result: Result<T, E>
): Result<T, F> => 
  result.success 
    ? result 
    : Result.err(transformer(result.error));

/**
 * Add context to an error
 *
 * @example
 * ```typescript
 * const error = createOperationalError('Failed');
 * const errorWithContext = withContext({ userId: '123', operation: 'fetch' })(error);
 * ```
 */
export const withContext = <E extends ErrorType,>(
  context: ErrorContext
) => (
  error: E
): E => ({
  ...error,
  context: {
    ...error.context,
    ...context
  }
});

/**
 * Transform error into a loggable format
 * Pure function - consumer decides how to use the result
 *
 * @example
 * ```typescript
 * const error = createOperationalError('Failed', true, { userId: '123' });
 * const logData = toLoggableFormat(error, { includeContext: true });
 * myLogger.error(logData);
 * ```
 */
export const toLoggableFormat = <E extends ErrorType>(
  error: E,
  options?: { includeContext?: boolean; includeTimestamp?: boolean }
): Record<string, unknown> => ({
  tag: error.tag,
  message: error.message,
  recoverable: error.recoverable,
  retryable: error.retryable,
  ...(options?.includeContext && 'context' in error && error.context ? { context: error.context } : {}),
  ...(options?.includeTimestamp ? { timestamp: new Date().toISOString() } : {})
});

/**
 * Recover with default value on specific error types
 *
 * @param defaultValue - The value to return on recovery
 * @param errorPredicate - Predicate to determine if error should be recovered (required for safety)
 *
 * @example
 * ```typescript
 * // Explicit recovery for operational errors
 * const recovered = recoverWithDefault('fallback', isOperationalError)(result);
 *
 * // Or use the error.recoverable flag from error taxonomy
 * const recovered = recoverWithDefault('fallback', (e) => e.recoverable)(result);
 * ```
 */
export const recoverWithDefault = <T, E extends ErrorType,>(
  defaultValue: T,
  errorPredicate: (error: E) => boolean  // No default - force explicit decision
) => (
  result: Result<T, E>
): Result<T, E> =>
  !result.success && errorPredicate(result.error)
    ? Result.ok(defaultValue)
    : result;

/**
 * Chain error recovery strategies
 */
export const recoverWith = <T, E,>(
  strategies: readonly ((error: E) => Result<T, E> | null)[]
) => (
  result: Result<T, E>
): Result<T, E> => {
  if (result.success) return result;

  for (const strategy of strategies) {
    const recovered = strategy(result.error);
    if (recovered?.success) {
      return recovered;
    }
  }

  return result;
};

/**
 * Create error handler for specific error types
 */
export const handleErrorType = <E extends ErrorType, T,>(
  handlers: {
    configuration?: (error: E) => Result<T, E>;
    operational?: (error: E) => Result<T, E>;
    critical?: (error: E) => Result<T, E>;
    validation?: (error: E) => Result<T, E>;
    retry?: (error: E) => Result<T, E>;
    'circuit-breaker'?: (error: E) => Result<T, E>;
    timeout?: (error: E) => Result<T, E>;
    default?: (error: E) => Result<T, E>;
  }
) => (error: E): Result<T, E> => {
  if (isConfigurationError(error) && handlers.configuration) {
    return handlers.configuration(error);
  }
  if (isOperationalError(error) && handlers.operational) {
    return handlers.operational(error);
  }
  if (isCriticalError(error) && handlers.critical) {
    return handlers.critical(error);
  }
  if (isValidationError(error) && handlers.validation) {
    return handlers.validation(error);
  }
  if (isRetryError(error) && handlers.retry) {
    return handlers.retry(error);
  }
  if (isCircuitBreakerError(error) && handlers['circuit-breaker']) {
    return handlers['circuit-breaker'](error);
  }
  if (isTimeoutError(error) && handlers.timeout) {
    return handlers.timeout(error);
  }

  return handlers.default
    ? handlers.default(error)
    : Result.err(error);
};