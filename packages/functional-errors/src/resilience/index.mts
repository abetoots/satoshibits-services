/**
 * Resilience utilities - retry and circuit breaker patterns
 * Thin wrappers around cockatiel for Result-aware resilience
 */

// Re-export retry utilities
export {
  retry,
  retrySync,
  createRetry,
  type RetryConfig
} from './retry.mjs';

// Re-export circuit breaker utilities
export {
  createCircuitBreaker,
  CircuitBreakerManual,
  type CircuitBreakerConfig,
  type CircuitState
} from './circuit-breaker.mjs';

// Re-export utility types
export { ResultError } from './utils.mjs';
