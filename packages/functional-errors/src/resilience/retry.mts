/**
 * Retry utilities - thin wrapper around cockatiel
 * Provides Result-aware retry functionality with exponential backoff
 */

import {
  retry as cockatielRetry,
  ExponentialBackoff,
  handleType,
  decorrelatedJitterGenerator,
  noJitterGenerator,
  type IPolicy
} from 'cockatiel';
import { Result } from '@satoshibits/functional';
import { ErrorType, RetryError, createRetryError, isRetryable } from '../types.mjs';
import { ResultError } from './utils.mjs';

/**
 * Retry configuration options
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  readonly maxAttempts?: number;
  /** Initial delay in milliseconds */
  readonly initialDelayMs?: number;
  /** Maximum delay in milliseconds */
  readonly maxDelayMs?: number;
  /** Backoff multiplier (default: 2 for exponential) */
  readonly backoffMultiplier?: number;
  /** Add jitter to prevent thundering herd */
  readonly jitter?: boolean;
  /** Custom predicate to determine if error should be retried */
  readonly shouldRetry?: (error: ErrorType) => boolean;
}

/**
 * Default retry configuration
 */
const defaultConfig: Required<Omit<RetryConfig, 'shouldRetry'>> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  jitter: true
};

/**
 * Create a retry policy from configuration
 */
function createRetryPolicy(config: RetryConfig = {}): IPolicy {
  const finalConfig = {
    ...defaultConfig,
    ...config,
    // validate maxAttempts to prevent invalid values
    maxAttempts: Math.max(1, config.maxAttempts ?? defaultConfig.maxAttempts)
  };
  const shouldRetry = config.shouldRetry ?? isRetryable;

  // create backoff with or without jitter
  const backoff = finalConfig.jitter
    ? new ExponentialBackoff({
        initialDelay: finalConfig.initialDelayMs,
        maxDelay: finalConfig.maxDelayMs,
        exponent: finalConfig.backoffMultiplier,
        generator: decorrelatedJitterGenerator
      })
    : new ExponentialBackoff({
        initialDelay: finalConfig.initialDelayMs,
        maxDelay: finalConfig.maxDelayMs,
        exponent: finalConfig.backoffMultiplier,
        generator: noJitterGenerator  // explicitly use noJitterGenerator when jitter is false (BUG #6)
      });

  // use handleType with predicate to inspect wrapped errors
  const policy = cockatielRetry(
    handleType(ResultError, e => {
      // safely validate that originalError is ErrorType before checking retryability
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const err = e.originalError;
      // runtime type guard: check if err has the shape of ErrorType
      if (
        err == null ||
        typeof err !== 'object' ||
        !('retryable' in err) ||
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        typeof err.retryable !== 'boolean'
      ) {
        return false;
      }
      // now safe to treat as ErrorType
      return shouldRetry(err as ErrorType);
    }),
    {
      maxAttempts: finalConfig.maxAttempts,
      backoff
    }
  );

  return policy;
}

/**
 * Retry a Result-returning function with exponential backoff
 *
 * @param fn - Function that returns a Result
 * @param config - Retry configuration
 * @returns Result with retry logic applied
 *
 * @example
 * ```typescript
 * const result = await retry(
 *   async () => fetchData(),
 *   { maxAttempts: 3, initialDelayMs: 100 }
 * );
 * ```
 */
export async function retry<T, E extends ErrorType>(
  fn: () => Promise<Result<T, E>>,
  config: RetryConfig = {}
): Promise<Result<T, E | RetryError>> {
  let lastError: E | undefined;
  let attempts = 0;

  const policy = createRetryPolicy(config);

  try {
    const result = await policy.execute(async () => {
      attempts++;
      const result = await fn();

      if (result.success) {
        return result.data;
      }

      lastError = result.error;

      // wrap error in ResultError - cockatiel will use predicate to decide retry
      throw new ResultError(result.error);
    });

    return Result.ok(result);
  } catch (error) {
    // handle ResultError - non-retryable or exhausted retries
    if (error instanceof ResultError) {
      if (lastError) {
        const shouldRetry = config.shouldRetry ?? isRetryable;
        // check if error was actually retryable
        if (shouldRetry(lastError)) {
          // retryable error - retries were exhausted
          return Result.err(createRetryError(attempts, lastError));
        }
        // non-retryable error - return original error as-is
        return Result.err(lastError);
      }
      // defensive: should not happen, but handle gracefully
      return Result.err(error.originalError as E);
    }

    // unexpected error
    throw error;
  }
}

/**
 * Create a retry wrapper for a function with reusable policy
 * Returns a new function with retry logic applied
 *
 * @param fn - Function to wrap with retry logic
 * @param config - Retry configuration
 * @returns New function with retry logic
 *
 * @example
 * ```typescript
 * const fetchWithRetry = createRetry(
 *   async () => fetchData(),
 *   { maxAttempts: 3, initialDelayMs: 100 }
 * );
 *
 * // policy is created once, reused on every call
 * const result1 = await fetchWithRetry();
 * const result2 = await fetchWithRetry();
 * ```
 */
export function createRetry<T, E extends ErrorType>(
  fn: () => Promise<Result<T, E>>,
  config: RetryConfig = {}
): () => Promise<Result<T, E | RetryError>> {
  // create policy once at creation time
  const policy = createRetryPolicy(config);
  const shouldRetry = config.shouldRetry ?? isRetryable;

  return async () => {
    let lastError: E | undefined;
    let attempts = 0;

    try {
      const result = await policy.execute(async () => {
        attempts++;
        const result = await fn();

        if (result.success) {
          return result.data;
        }

        lastError = result.error;

        // wrap error in ResultError - cockatiel will use predicate to decide retry
        throw new ResultError(result.error);
      });

      return Result.ok(result);
    } catch (error) {
      // handle ResultError - non-retryable or exhausted retries
      if (error instanceof ResultError) {
        if (lastError) {
          // check if error was actually retryable
          if (shouldRetry(lastError)) {
            // retryable error - retries were exhausted
            return Result.err(createRetryError(attempts, lastError));
          }
          // non-retryable error - return original error as-is
          return Result.err(lastError);
        }
        // defensive: should not happen, but handle gracefully
        return Result.err(error.originalError as E);
      }

      // unexpected error
      throw error;
    }
  };
}

/**
 * Retry a synchronous Result-returning function
 * Note: This executes immediately without delays between attempts
 *
 * @param fn - Synchronous function that returns a Result
 * @param config - Retry configuration (delays are ignored for sync)
 * @returns Result with retry logic applied
 *
 * @example
 * ```typescript
 * const result = retrySync(
 *   () => parseData(),
 *   { maxAttempts: 3 }
 * );
 * ```
 */
export function retrySync<T, E extends ErrorType>(
  fn: () => Result<T, E>,
  config: RetryConfig = {}
): Result<T, E | RetryError> {
  const shouldRetry = config.shouldRetry ?? isRetryable;
  // validate maxAttempts to prevent loop skip and defensive error
  const maxAttempts = Math.max(1, config.maxAttempts ?? defaultConfig.maxAttempts);

  let lastError: E | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = fn();

    if (result.success) {
      return result;
    }

    lastError = result.error;

    // check if error is retryable
    if (!shouldRetry(lastError)) {
      // non-retryable errors are returned immediately without wrapping
      return result;
    }

    if (attempt === maxAttempts) {
      // exhausted retries on a retryable error
      return Result.err(createRetryError(attempt, lastError));
    }
    // continue to next iteration for retryable errors
  }

  // defensive: this should never be reached, but handle gracefully
  if (!lastError) {
    throw new Error('Internal error: retrySync completed without success or error');
  }
  return Result.err(createRetryError(maxAttempts, lastError));
}
