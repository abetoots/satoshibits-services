/**
 * @module types
 * @description Core error types using tagged unions for type-safe error handling
 * @since 2025-01-13
 * 
 * @remarks
 * This module provides immutable error types following functional programming principles.
 * Each error type has a discriminant 'tag' field for pattern matching and type narrowing.
 * 
 * @example
 * ```typescript
 * import { ErrorType, isOperationalError } from '@satoshibits/errors';
 * 
 * function handleError(error: ErrorType) {
 *   if (isOperationalError(error)) {
 *     if (error.retryable) {
 *       // Retry the operation
 *     }
 *   }
 * }
 * ```
 * 
 * @packageDocumentation
 */

/**
 * Context information that can be attached to any error
 * @since 2025-01-13
 */
export type ErrorContext = Record<string, unknown>;

/**
 * Base error type using tagged unions for different error categories
 * 
 * @category Core Types
 * @since 2025-01-13
 * 
 * @description
 * Each variant has a 'tag' discriminator for pattern matching.
 * All error types are immutable with readonly properties.
 * 
 * @example
 * ```typescript
 * function categorizeError(error: ErrorType): string {
 *   switch (error.tag) {
 *     case 'configuration':
 *       return 'Setup issue';
 *     case 'operational':
 *       return error.retryable ? 'Temporary issue' : 'Runtime error';
 *     case 'critical':
 *       return 'System failure';
 *     default:
 *       return 'Unknown error';
 *   }
 * }
 * ```
 */
export type ErrorType =
  | ConfigurationError
  | OperationalError
  | CriticalError
  | ValidationError
  | RetryError
  | CircuitBreakerError
  | TimeoutError;

/**
 * Configuration error - Non-recoverable setup/initialization error
 * 
 * @category Error Types
 * @since 2025-01-13
 * 
 * @description
 * Represents errors that occur during application setup or configuration.
 * These errors cannot be recovered from and require fixing the configuration.
 * 
 * @example
 * ```typescript
 * const error: ConfigurationError = {
 *   tag: 'configuration',
 *   message: 'Database connection string missing',
 *   recoverable: false,
 *   retryable: false,
 *   context: { configFile: '/app/config.json' }
 * };
 * ```
 */
export interface ConfigurationError {
  /** Discriminator for type narrowing */
  readonly tag: 'configuration';
  /** Human-readable error message */
  readonly message: string;
  /** Always false - configuration errors require manual intervention */
  readonly recoverable: false;
  /** Always false - retrying won't fix configuration issues */
  readonly retryable: false;
  /** Optional context information */
  readonly context?: ErrorContext;
}

/**
 * Operational error - Recoverable runtime error
 * 
 * @category Error Types
 * @since 2025-01-13
 * 
 * @description
 * Represents errors that occur during normal operation.
 * These can often be recovered from and may be retryable.
 * 
 * @example
 * ```typescript
 * const error: OperationalError = {
 *   tag: 'operational',
 *   message: 'Network timeout',
 *   recoverable: true,
 *   retryable: true,
 *   context: { url: 'https://api.example.com', timeout: 5000 }
 * };
 * ```
 */
export interface OperationalError {
  /** Discriminator for type narrowing */
  readonly tag: 'operational';
  /** Human-readable error message */
  readonly message: string;
  /** Always true - operational errors can be handled gracefully */
  readonly recoverable: true;
  /** Whether retrying might succeed */
  readonly retryable: boolean;
  /** Optional context information */
  readonly context?: ErrorContext;
}

/**
 * Critical error - System-level failure
 * 
 * @category Error Types
 * @since 2025-01-13
 * 
 * @description
 * Represents severe system failures that require immediate attention.
 * These errors indicate fundamental problems with the system.
 * 
 * @example
 * ```typescript
 * const error: CriticalError = {
 *   tag: 'critical',
 *   message: 'Out of memory',
 *   recoverable: false,
 *   retryable: false,
 *   cause: new Error('ENOMEM'),
 *   context: { availableMemory: 0 }
 * };
 * ```
 */
export interface CriticalError {
  /** Discriminator for type narrowing */
  readonly tag: 'critical';
  /** Human-readable error message */
  readonly message: string;
  /** Always false - critical errors require intervention */
  readonly recoverable: false;
  /** Always false - system failures won't be fixed by retry */
  readonly retryable: false;
  /** Original error that caused this critical failure */
  readonly cause?: Error;
  /** Optional context information */
  readonly context?: ErrorContext;
}

/**
 * Validation error - Data validation failure
 * 
 * @category Error Types
 * @since 2025-01-13
 * 
 * @description
 * Represents errors in user input or data validation.
 * Contains field-specific error messages for form validation.
 * 
 * @example
 * ```typescript
 * const error: ValidationError = {
 *   tag: 'validation',
 *   message: 'Form validation failed',
 *   recoverable: true,
 *   retryable: false,
 *   fields: {
 *     email: ['Invalid format', 'Already exists'],
 *     password: ['Too short']
 *   }
 * };
 * ```
 */
export interface ValidationError {
  /** Discriminator for type narrowing */
  readonly tag: 'validation';
  /** Human-readable error message */
  readonly message: string;
  /** Always true - validation errors can be fixed by user */
  readonly recoverable: true;
  /** Always false - same input will fail again */
  readonly retryable: false;
  /** Field-specific error messages */
  readonly fields?: Record<string, string[]>;
  /** Optional context information */
  readonly context?: ErrorContext;
}

/**
 * Retry error - Retry attempts exhausted
 * 
 * @category Error Types
 * @since 2025-01-13
 * 
 * @description
 * Represents failure after all retry attempts have been exhausted.
 * Contains the last error that occurred and total attempts made.
 * 
 * @example
 * ```typescript
 * const error: RetryError = {
 *   tag: 'retry',
 *   message: 'Failed after 3 attempts',
 *   recoverable: false,
 *   retryable: false,
 *   attempts: 3,
 *   lastError: operationalError,
 *   context: { operation: 'fetchData' }
 * };
 * ```
 */
export interface RetryError {
  /** Discriminator for type narrowing */
  readonly tag: 'retry';
  /** Human-readable error message */
  readonly message: string;
  /** Always false - already exhausted retries */
  readonly recoverable: false;
  /** Always false - no more retries allowed */
  readonly retryable: false;
  /** Number of attempts made */
  readonly attempts: number;
  /** The last error encountered */
  readonly lastError: ErrorType;
  /** Optional context information */
  readonly context?: ErrorContext;
}

/**
 * Circuit breaker error - Circuit is open or half-open
 * 
 * @category Error Types
 * @since 2025-01-13
 * 
 * @description
 * Represents rejection by circuit breaker to prevent cascading failures.
 * Includes current state and when next attempt is allowed.
 * 
 * @example
 * ```typescript
 * const error: CircuitBreakerError = {
 *   tag: 'circuit-breaker',
 *   message: 'Circuit breaker is open',
 *   recoverable: true,
 *   retryable: false,
 *   state: 'open',
 *   nextAttempt: new Date(Date.now() + 60000),
 *   context: { service: 'payment-api' }
 * };
 * ```
 */
export interface CircuitBreakerError {
  /** Discriminator for type narrowing */
  readonly tag: 'circuit-breaker';
  /** Human-readable error message */
  readonly message: string;
  /** Always true - circuit will eventually close */
  readonly recoverable: true;
  /** Always false - must wait for circuit to close */
  readonly retryable: false;
  /** Current circuit state */
  readonly state: 'open' | 'half-open';
  /** When the circuit will attempt to close */
  readonly nextAttempt?: Date;
  /** Optional context information */
  readonly context?: ErrorContext;
}

/**
 * Timeout error - Operation exceeded time limit
 * 
 * @category Error Types
 * @since 2025-01-13
 * 
 * @description
 * Represents operations that took longer than the allowed time.
 * Usually retryable as the operation might succeed on next attempt.
 * 
 * @example
 * ```typescript
 * const error: TimeoutError = {
 *   tag: 'timeout',
 *   message: 'Request timed out after 5000ms',
 *   recoverable: true,
 *   retryable: true,
 *   operationName: 'fetchUserData',
 *   timeoutMs: 5000
 * };
 * ```
 */
export interface TimeoutError {
  /** Discriminator for type narrowing */
  readonly tag: 'timeout';
  /** Human-readable error message */
  readonly message: string;
  /** Always true - timeouts can be recovered from */
  readonly recoverable: true;
  /** Always true - might succeed on retry */
  readonly retryable: true;
  /** Name of the operation that timed out */
  readonly operationName: string;
  /** Timeout duration in milliseconds */
  readonly timeoutMs: number;
  /** Optional context information */
  readonly context?: ErrorContext;
}


// ============================================================================
// Type Guards
// ============================================================================

/**
 * Creates a type guard that checks if an error has a specific tag
 * Uses structural validation for null-safety and type narrowing
 *
 * @internal
 */
function createTagTypeGuard<T extends ErrorType>(tag: T['tag']) {
  return (error: unknown): error is T => {
    if (typeof error !== 'object' || error === null) {
      return false;
    }
    const obj = error as Record<string, unknown>;
    return 'tag' in obj && typeof obj.tag === 'string' && obj.tag === tag;
  };
}

/**
 * Type guard for ConfigurationError
 *
 * @category Type Guards
 * @since 2025-01-13
 *
 * @param error - Error to check
 * @returns True if error is ConfigurationError
 *
 * @example
 * ```typescript
 * if (isConfigurationError(error)) {
 *   console.error('Configuration issue:', error.message);
 *   process.exit(1);
 * }
 * ```
 */
export const isConfigurationError = createTagTypeGuard<ConfigurationError>('configuration');

/**
 * Type guard for OperationalError
 *
 * @category Type Guards
 * @since 2025-01-13
 *
 * @param error - Error to check
 * @returns True if error is OperationalError
 *
 * @example
 * ```typescript
 * if (isOperationalError(error) && error.retryable) {
 *   return retry(operation);
 * }
 * ```
 */
export const isOperationalError = createTagTypeGuard<OperationalError>('operational');

/**
 * Type guard for CriticalError
 *
 * @category Type Guards
 * @since 2025-01-13
 *
 * @param error - Error to check
 * @returns True if error is CriticalError
 *
 * @example
 * ```typescript
 * if (isCriticalError(error)) {
 *   alertOncall(error);
 *   shutdownGracefully();
 * }
 * ```
 */
export const isCriticalError = createTagTypeGuard<CriticalError>('critical');

/**
 * Type guard for ValidationError
 *
 * @category Type Guards
 * @since 2025-01-13
 *
 * @param error - Error to check
 * @returns True if error is ValidationError
 *
 * @example
 * ```typescript
 * if (isValidationError(error)) {
 *   return res.status(400).json({
 *     error: error.message,
 *     fields: error.fields
 *   });
 * }
 * ```
 */
export const isValidationError = createTagTypeGuard<ValidationError>('validation');

/**
 * Type guard for RetryError
 *
 * @category Type Guards
 * @since 2025-01-13
 *
 * @param error - Error to check
 * @returns True if error is RetryError
 *
 * @example
 * ```typescript
 * if (isRetryError(error)) {
 *   console.error(`Failed after ${error.attempts} attempts`);
 *   console.error('Last error:', error.lastError);
 * }
 * ```
 */
export const isRetryError = createTagTypeGuard<RetryError>('retry');

/**
 * Type guard for CircuitBreakerError
 *
 * @category Type Guards
 * @since 2025-01-13
 *
 * @param error - Error to check
 * @returns True if error is CircuitBreakerError
 *
 * @example
 * ```typescript
 * if (isCircuitBreakerError(error)) {
 *   console.log('Circuit is', error.state);
 *   if (error.nextAttempt) {
 *     console.log('Retry after', error.nextAttempt);
 *   }
 * }
 * ```
 */
export const isCircuitBreakerError = createTagTypeGuard<CircuitBreakerError>('circuit-breaker');

/**
 * Type guard for TimeoutError
 *
 * @category Type Guards
 * @since 2025-01-13
 *
 * @param error - Error to check
 * @returns True if error is TimeoutError
 *
 * @example
 * ```typescript
 * if (isTimeoutError(error)) {
 *   console.error(`${error.operationName} timed out after ${error.timeoutMs}ms`);
 * }
 * ```
 */
export const isTimeoutError = createTagTypeGuard<TimeoutError>('timeout');


/**
 * Checks if error can be recovered from
 *
 * @category Type Guards
 * @since 2025-01-13
 *
 * @param error - Error to check
 * @returns True if error is recoverable
 *
 * @example
 * ```typescript
 * if (isRecoverable(error)) {
 *   return handleRecoverableError(error);
 * } else {
 *   throw error;
 * }
 * ```
 */
export const isRecoverable = (error: unknown): boolean =>
  isObject(error) && hasRecoverable(error) && error.recoverable;

/**
 * Checks if error should be retried
 *
 * @category Type Guards
 * @since 2025-01-13
 *
 * @param error - Error to check
 * @returns True if error is retryable
 *
 * @example
 * ```typescript
 * if (isRetryable(error)) {
 *   return retryWithBackoff(operation);
 * }
 * ```
 */
export const isRetryable = (error: unknown): boolean =>
  isObject(error) && hasRetryable(error) && error.retryable;

// ============================================================================
// Structural Type Guards
// ============================================================================

/**
 * Creates a type guard that checks if an object has a property of a specific type
 * Handles object validation and type narrowing in a reusable way
 *
 * @internal
 */
function createPropertyTypeGuard<K extends string, V>(
  propertyName: K,
  typeChecker: (value: unknown) => value is V
): (error: unknown) => error is Record<K, V> {
  return (error: unknown): error is Record<K, V> => {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const obj = error as Record<string, unknown>;
    return propertyName in obj && typeChecker(obj[propertyName]);
  };
}

/**
 * Helper type checkers for factory pattern
 * @internal
 */
const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNumber = (value: unknown): value is number => typeof value === 'number';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Type guard for errors with a cause property
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param error - Value to check
 * @returns True if error has a cause property
 *
 * @example
 * ```typescript
 * if (hasCause(error)) {
 *   console.log('Caused by:', error.cause);
 * }
 * ```
 */
export function hasCause(error: unknown): error is { cause: unknown } {
  return typeof error === 'object' && error !== null && 'cause' in error;
}

/**
 * Type guard for errors with a context property
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param error - Value to check
 * @returns True if error has a context property that is a record
 *
 * @example
 * ```typescript
 * if (hasContext(error)) {
 *   console.log('Error context:', error.context);
 * }
 * ```
 */
export const hasContext = createPropertyTypeGuard('context', isRecord);

/**
 * Type guard for errors with a tag property
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param error - Value to check
 * @returns True if error has a tag property that is a string
 *
 * @example
 * ```typescript
 * if (hasTag(error)) {
 *   switch (error.tag) {
 *     case 'operational':
 *       handleOperational(error);
 *       break;
 *   }
 * }
 * ```
 */
export const hasTag = createPropertyTypeGuard('tag', isString);

/**
 * Type guard for errors with a message property
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param error - Value to check
 * @returns True if error has a message property that is a string
 *
 * @example
 * ```typescript
 * if (hasMessage(error)) {
 *   console.log('Error message:', error.message);
 * }
 * ```
 */
export const hasMessage = createPropertyTypeGuard('message', isString);

/**
 * Type guard for errors with recoverable property
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param error - Value to check
 * @returns True if error has a recoverable boolean property
 *
 * @example
 * ```typescript
 * if (hasRecoverable(error) && error.recoverable) {
 *   attemptRecovery();
 * }
 * ```
 */
export const hasRecoverable = createPropertyTypeGuard('recoverable', isBoolean);

/**
 * Type guard for errors with retryable property
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param error - Value to check
 * @returns True if error has a retryable boolean property
 *
 * @example
 * ```typescript
 * if (hasRetryable(error) && error.retryable) {
 *   scheduleRetry();
 * }
 * ```
 */
export const hasRetryable = createPropertyTypeGuard('retryable', isBoolean);

/**
 * Type guard for errors with a stack trace
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param error - Value to check
 * @returns True if error has a stack property that is a string
 *
 * @example
 * ```typescript
 * if (hasStack(error)) {
 *   console.log('Stack trace:', error.stack);
 * }
 * ```
 */
export const hasStack = createPropertyTypeGuard('stack', isString);

/**
 * Type guard for errors with a code property
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param error - Value to check
 * @returns True if error has a code property that is a string
 *
 * @example
 * ```typescript
 * if (hasCode(error)) {
 *   if (error.code === 'ENOENT') {
 *     console.log('File not found');
 *   }
 * }
 * ```
 */
export const hasCode = createPropertyTypeGuard('code', isString);

/**
 * Type guard for errors with a timestamp
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param error - Value to check
 * @returns True if error has a timestamp property that is a number
 *
 * @example
 * ```typescript
 * if (hasTimestamp(error)) {
 *   const age = Date.now() - error.timestamp;
 *   console.log(`Error occurred ${age}ms ago`);
 * }
 * ```
 */
export const hasTimestamp = createPropertyTypeGuard('timestamp', isNumber);

/**
 * Combined type guard for error-like objects
 * Checks for tag, message, recoverable, and retryable properties
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param error - Value to check
 * @returns True if error has all required properties
 *
 * @example
 * ```typescript
 * if (isErrorLikeObject(error)) {
 *   console.log(`${error.tag}: ${error.message}`);
 *   if (error.retryable) {
 *     scheduleRetry();
 *   }
 * }
 * ```
 */
export function isErrorLikeObject(
  error: unknown
): error is {
  tag: string;
  message: string;
  recoverable: boolean;
  retryable: boolean;
} {
  return (
    hasTag(error) &&
    hasMessage(error) &&
    hasRecoverable(error) &&
    hasRetryable(error)
  );
}

/**
 * Type guard for standard Error instances
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param error - Value to check
 * @returns True if error is an Error instance
 *
 * @example
 * ```typescript
 * if (isError(error)) {
 *   console.log(error.message);
 *   console.log(error.stack);
 * }
 * ```
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Type guard for objects (not null)
 *
 * @category Structural Type Guards
 * @since 2025-08-21
 *
 * @param value - Value to check
 * @returns True if value is an object and not null
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ============================================================================
// Error Constructors
// ============================================================================

/**
 * Creates a configuration error
 * 
 * @category Error Constructors
 * @since 2025-01-13
 * 
 * @param message - Error message
 * @param context - Optional context information
 * @returns Immutable ConfigurationError
 * 
 * @example
 * ```typescript
 * const error = createConfigurationError(
 *   'Missing API key',
 *   { envVar: 'API_KEY', configFile: '.env' }
 * );
 * ```
 */
export const createConfigurationError = (
  message: string,
  context?: ErrorContext
): ConfigurationError => ({
  tag: 'configuration',
  message,
  recoverable: false,
  retryable: false,
  context
});

/**
 * Creates an operational error
 * 
 * @category Error Constructors
 * @since 2025-01-13
 * 
 * @param message - Error message
 * @param retryable - Whether operation should be retried
 * @param context - Optional context information
 * @returns Immutable OperationalError
 * 
 * @example
 * ```typescript
 * const error = createOperationalError(
 *   'Connection timeout',
 *   true, // retryable
 *   { url: 'https://api.example.com', timeout: 5000 }
 * );
 * ```
 */
export const createOperationalError = (
  message: string,
  retryable = true,
  context?: ErrorContext
): OperationalError => ({
  tag: 'operational',
  message,
  recoverable: true,
  retryable,
  context
});

/**
 * Creates a critical error
 * 
 * @category Error Constructors
 * @since 2025-01-13
 * 
 * @param message - Error message
 * @param cause - Original error that caused this
 * @param context - Optional context information
 * @returns Immutable CriticalError
 * 
 * @example
 * ```typescript
 * try {
 *   riskyOperation();
 * } catch (e) {
 *   const error = createCriticalError(
 *     'System failure',
 *     e as Error,
 *     { component: 'database', severity: 'high' }
 *   );
 * }
 * ```
 */
export const createCriticalError = (
  message: string,
  cause?: Error,
  context?: ErrorContext
): CriticalError => ({
  tag: 'critical',
  message,
  recoverable: false,
  retryable: false,
  cause,
  context
});

/**
 * Creates a validation error
 * 
 * @category Error Constructors
 * @since 2025-01-13
 * 
 * @param message - Error message
 * @param fields - Field-specific error messages
 * @param context - Optional context information
 * @returns Immutable ValidationError
 * 
 * @example
 * ```typescript
 * const error = createValidationError(
 *   'Form validation failed',
 *   {
 *     email: ['Invalid format', 'Already exists'],
 *     password: ['Too short', 'Must contain uppercase']
 *   },
 *   { formName: 'userRegistration' }
 * );
 * ```
 */
export const createValidationError = (
  message: string,
  fields?: Record<string, string[]>,
  context?: ErrorContext
): ValidationError => ({
  tag: 'validation',
  message,
  recoverable: true,
  retryable: false,
  fields,
  context
});

/**
 * Creates a retry error
 * 
 * @category Error Constructors
 * @since 2025-01-13
 * 
 * @param attempts - Number of attempts made
 * @param lastError - The last error encountered
 * @param context - Optional context information
 * @returns Immutable RetryError
 * 
 * @example
 * ```typescript
 * const error = createRetryError(
 *   3,
 *   operationalError,
 *   { operation: 'fetchData', strategy: 'exponential' }
 * );
 * ```
 */
export const createRetryError = (
  attempts: number,
  lastError: ErrorType,
  context?: ErrorContext
): RetryError => ({
  tag: 'retry',
  message: `Maximum retry attempts (${attempts}) exceeded`,
  recoverable: false,
  retryable: false,
  attempts,
  lastError,
  context
});

/**
 * Creates a circuit breaker error
 * 
 * @category Error Constructors
 * @since 2025-01-13
 * 
 * @param state - Current circuit state
 * @param nextAttempt - When circuit might close
 * @param context - Optional context information
 * @returns Immutable CircuitBreakerError
 * 
 * @example
 * ```typescript
 * const error = createCircuitBreakerError(
 *   'open',
 *   new Date(Date.now() + 60000),
 *   { service: 'payment-api', failures: 5 }
 * );
 * ```
 */
export const createCircuitBreakerError = (
  state: 'open' | 'half-open',
  nextAttempt?: Date,
  context?: ErrorContext
): CircuitBreakerError => ({
  tag: 'circuit-breaker',
  message: `Circuit breaker is ${state}`,
  recoverable: true,
  retryable: false,
  state,
  nextAttempt,
  context
});

/**
 * Creates a timeout error
 * 
 * @category Error Constructors
 * @since 2025-01-13
 * 
 * @param timeoutMs - Timeout duration in milliseconds
 * @param context - Optional context information
 * @returns Immutable TimeoutError
 * 
 * @example
 * ```typescript
 * const error = createTimeoutError(
 *   5000,
 *   { userId: '123', endpoint: '/api/users/123' }
 * );
 * ```
 */
export const createTimeoutError = (
  operationName: string,
  timeoutMs: number,
  context?: ErrorContext
): TimeoutError => ({
  tag: 'timeout',
  message: `${operationName} timed out after ${timeoutMs}ms`,
  recoverable: true,
  retryable: true,
  operationName,
  timeoutMs,
  context
});

