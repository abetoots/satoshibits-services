/**
 * @satoshibits/functional-errors v2.0.0
 *
 * Pure functional error handling library with Result<T,E> pattern.
 * Features type-safe error taxonomy and resilience patterns via cockatiel.
 */

// ============================================================================
// Core Types
// ============================================================================

export type {
  // error types
  ErrorType,
  ConfigurationError,
  OperationalError,
  CriticalError,
  ValidationError,
  RetryError,
  CircuitBreakerError,
  TimeoutError,
  ErrorContext
} from './types.mjs';

// ============================================================================
// Type Guards & Error Constructors
// ============================================================================

export {
  // type-specific guards
  isConfigurationError,
  isOperationalError,
  isCriticalError,
  isValidationError,
  isRetryError,
  isCircuitBreakerError,
  isTimeoutError,
  isRecoverable,
  isRetryable,
  // structural type guards
  hasCause,
  hasContext,
  hasTag,
  hasMessage,
  hasRecoverable,
  hasRetryable,
  hasStack,
  hasCode,
  hasTimestamp,
  isErrorLikeObject,
  isError,
  isObject,
  // error constructors
  createConfigurationError,
  createOperationalError,
  createCriticalError,
  createValidationError,
  createRetryError,
  createCircuitBreakerError,
  createTimeoutError
} from './types.mjs';

// ============================================================================
// Result Utilities
// ============================================================================

export {
  tryCatch,
  tryCatchSync,
  type ResultType
} from './result-utilities.mjs';

// re-export Result from functional package
export { Result } from '@satoshibits/functional';

// ============================================================================
// Error Handlers
// ============================================================================

export {
  mapError,
  withContext,
  toLoggableFormat,
  recoverWithDefault,
  recoverWith,
  handleErrorType,
  type ErrorHandler,
  type ErrorTransformer
} from './handlers.mjs';

// ============================================================================
// Resilience Patterns (Retry & Circuit Breaker)
// ============================================================================

export {
  // retry
  retry,
  retrySync,
  createRetry,
  type RetryConfig,
  // circuit breaker
  createCircuitBreaker,
  CircuitBreakerManual,
  type CircuitBreakerConfig,
  type CircuitState,
  // utilities
  ResultError
} from './resilience/index.mjs';
