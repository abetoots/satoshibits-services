/**
 * Circuit breaker utilities - thin wrapper around cockatiel
 * Provides Result-aware circuit breaker to prevent cascading failures
 */

import {
  circuitBreaker,
  ConsecutiveBreaker,
  SamplingBreaker,
  handleType,
  BrokenCircuitError,
  type IPolicy
} from 'cockatiel';
import { Result } from '@satoshibits/functional';
import { ErrorType, CircuitBreakerError, createCircuitBreakerError } from '../types.mjs';
import { ResultError, executeResultForCockatiel } from './utils.mjs';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening (for consecutive breaker) */
  readonly failureThreshold?: number;
  /** Time window for failure rate calculation in ms (for sampling breaker) */
  readonly windowMs?: number;
  /** Minimum number of calls before circuit can trip (for sampling breaker) */
  readonly minimumCalls?: number;
  /** Failure rate threshold (0-1) to open circuit (for sampling breaker) */
  readonly failureRateThreshold?: number;
  /** How long to wait before attempting to close circuit (in ms) */
  readonly openDurationMs?: number;
  /** How long to wait in half-open state before closing (in ms) */
  readonly halfOpenAfterMs?: number;
  /** Breaker strategy: 'consecutive' or 'sampling' */
  readonly strategy?: 'consecutive' | 'sampling';
}

/**
 * Default circuit breaker configuration
 */
const defaultConfig: Required<CircuitBreakerConfig> = {
  failureThreshold: 5,
  windowMs: 10000,
  minimumCalls: 10,
  failureRateThreshold: 0.5,
  openDurationMs: 60000,
  halfOpenAfterMs: 30000,
  strategy: 'consecutive'
};

/**
 * Create a circuit breaker policy from configuration
 */
function createCircuitBreakerPolicy(config: CircuitBreakerConfig = {}): IPolicy {
  const finalConfig = { ...defaultConfig, ...config };

  let breaker: ConsecutiveBreaker | SamplingBreaker;

  if (finalConfig.strategy === 'sampling') {
    // ensure windowMs is at least 1000 to prevent division by zero (BUG #4)
    const safeWindowMs = Math.max(1000, finalConfig.windowMs);
    breaker = new SamplingBreaker({
      threshold: finalConfig.failureRateThreshold,
      duration: safeWindowMs,
      minimumRps: finalConfig.minimumCalls / (safeWindowMs / 1000)
    });
  } else {
    breaker = new ConsecutiveBreaker(finalConfig.failureThreshold);
  }

  return circuitBreaker(handleType(Error), {
    breaker,
    halfOpenAfter: finalConfig.openDurationMs  // use openDurationMs, not halfOpenAfterMs (BUG #5)
  });
}

/**
 * Create a circuit breaker wrapper for a function
 * Returns a new function with circuit breaker protection
 *
 * @param fn - Function to protect
 * @param config - Circuit breaker configuration
 * @returns New function with circuit breaker
 *
 * @example
 * ```typescript
 * const protectedFetch = createCircuitBreaker(
 *   fetchData,
 *   { failureThreshold: 5, openDurationMs: 60000 }
 * );
 *
 * const result = await protectedFetch();
 * ```
 */
export function createCircuitBreaker<T, E extends ErrorType>(
  fn: () => Promise<Result<T, E>>,
  config: CircuitBreakerConfig = {}
): () => Promise<Result<T, E | CircuitBreakerError>> {
  // create the policy once and reuse it
  const policy = createCircuitBreakerPolicy(config);

  return async () => {
    try {
      const result = await policy.execute(() => executeResultForCockatiel(fn));
      return Result.ok(result);
    } catch (error) {
      // handle ResultError - original error preserved without re-execution
      if (error instanceof ResultError) {
        return Result.err(error.originalError as E);
      }

      // handle circuit breaker error - use type-safe instanceof check
      if (error instanceof BrokenCircuitError) {
        const recoveryMs = config.openDurationMs ?? defaultConfig.openDurationMs;
        return Result.err(
          createCircuitBreakerError(
            'open',
            new Date(Date.now() + recoveryMs)  // use openDurationMs, not halfOpenAfterMs (BUG #5)
          )
        );
      }

      // unexpected error
      throw error;
    }
  };
}

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker with manual state management
 * Use this when you need fine-grained control over the circuit state
 */
export class CircuitBreakerManual<T, E extends ErrorType> {
  private policy: IPolicy;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = config;
    this.policy = createCircuitBreakerPolicy(config);
  }

  /**
   * Execute a function through the circuit breaker
   */
  async execute(
    fn: () => Promise<Result<T, E>>
  ): Promise<Result<T, E | CircuitBreakerError>> {
    try {
      const result = await this.policy.execute(() => executeResultForCockatiel(fn));
      return Result.ok(result);
    } catch (error) {
      // handle ResultError - original error preserved without re-execution
      if (error instanceof ResultError) {
        return Result.err(error.originalError as E);
      }

      // handle circuit breaker error - use type-safe instanceof check
      if (error instanceof BrokenCircuitError) {
        const recoveryMs = this.config.openDurationMs ?? defaultConfig.openDurationMs;
        return Result.err(
          createCircuitBreakerError(
            'open',
            new Date(Date.now() + recoveryMs)  // include nextAttempt (BUG #8)
          )
        );
      }

      // unexpected error
      throw error;
    }
  }
}
