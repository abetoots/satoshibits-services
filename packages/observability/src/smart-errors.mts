/**
 * Smart Error Integration
 *
 * Integrates errors with OpenTelemetry traces and logs.
 * Provides automatic correlation and context enrichment.
 */
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

import type { Attributes, Tracer } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";

import { getBusinessContext, getGlobalContext } from "./enrichment/context.mjs";
import { DataSanitizer, SanitizerPresets } from "./enrichment/sanitizer.mjs";
import { getUnifiedClientInstance } from "./client-instance.mjs";
import * as metrics from "./smart-metrics.mjs";
import { getResultAdapter } from "./utils/result-adapter.mjs";
import { isThenable } from "./utils/thenable.mjs";

/**
 * Dedicated sanitizer for error reporting with strict security settings.
 * Errors frequently contain sensitive data (passwords, API keys, PII),
 * so we use strict mode to ensure maximum protection.
 */
const ERROR_SANITIZER = new DataSanitizer({
  ...SanitizerPresets.gdpr(), // Use GDPR preset as baseline (masks phones, IPs)
  maskEmails: false, // Disable partial masking - we do full redaction via custom pattern
  strictMode: true, // Enable strict mode to catch API keys and other patterns
  redactionString: "[REDACTED]", // Use clear redaction marker
  customPatterns: [
    // Stripe API keys (sk_live_, sk_test_, pk_live_, pk_test_)
    {
      pattern: /\b[sp]k_(live|test)_[A-Za-z0-9]+\b/gi,
      replacement: "[REDACTED]",
    },
    // Generic API keys with common prefixes
    {
      pattern: /\b(api[_-]?key|apikey|secret[_-]?key)[:=\s]+\S+/gi,
      replacement: "$1: [REDACTED]",
    },
    // Passwords in connection strings (mongodb://, postgresql://, mysql://, etc.)
    {
      pattern: /((?:mongodb|postgresql|mysql|redis|amqp):\/\/[^:]+:)([^@]+)(@)/gi,
      replacement: "$1[REDACTED]$3",
    },
    // Passwords in URL parameters
    {
      pattern: /([?&](?:password|passwd|pwd)=)([^&\s]+)/gi,
      replacement: "$1[REDACTED]",
    },
    // Full email redaction for errors (not partial masking)
    {
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      replacement: "[REDACTED]",
    },
  ],
});

/**
 * Error categories for better observability
 */
export enum ErrorCategory {
  VALIDATION = "validation",
  AUTHENTICATION = "authentication",
  AUTHORIZATION = "authorization",
  NOT_FOUND = "not_found",
  RATE_LIMIT = "rate_limit",
  TIMEOUT = "timeout",
  NETWORK = "network",
  DATABASE = "database",
  EXTERNAL_SERVICE = "external_service",
  INTERNAL = "internal",
  UNKNOWN = "unknown",
}

/**
 * Configuration for error categorization
 *
 * Public API includes commonly-used option for disabling default categorization.
 * Advanced features (custom categorizers, custom rules) are available internally
 * but not exposed to prevent API bloat.
 */
export interface ErrorCategorizationConfig {
  /**
   * Disable default categorization logic.
   * When true, only custom categorizer and custom rules are used.
   * Unmatched errors will be categorized as UNKNOWN.
   *
   * @default false
   */
  disableDefaults?: boolean;
}

/**
 * Internal configuration with advanced error categorization features
 * @internal - Not part of public API, kept for future use
 */
interface InternalErrorCategorizationConfig extends ErrorCategorizationConfig {
  /**
   * Custom categorization function called first before default categorization.
   *
   * **Performance Note:** This function is on a hot path and will be invoked for every error.
   * Keep it fast and avoid expensive operations.
   *
   * Return `undefined` to fall through to custom rules or default categorization.
   *
   * @example
   * // Microservice with custom taxonomy
   * customCategorizer: (error) => {
   *   if (error instanceof ServiceDegradedError) {
   *     return ErrorCategory.EXTERNAL_SERVICE;
   *   }
   *   if (error instanceof CircuitOpenError) {
   *     return ErrorCategory.RATE_LIMIT;
   *   }
   *   return undefined; // fall through to default
   * }
   */
  customCategorizer?: (error: Error) => ErrorCategory | undefined;

  /**
   * Additional pattern-based rules to augment default categorization.
   * Rules are checked in order after customCategorizer but before default logic.
   *
   * **Performance Note:** Keep test functions lightweight.
   *
   * @example
   * // E-commerce custom error types
   * customRules: [
   *   {
   *     category: ErrorCategory.VALIDATION,
   *     test: (error) => error.name === 'OrderValidationError',
   *   },
   *   {
   *     category: ErrorCategory.EXTERNAL_SERVICE,
   *     test: (error) => error.name === 'PaymentGatewayError',
   *   },
   * ]
   */
  customRules?: {
    category: ErrorCategory;
    test: (error: Error) => boolean;
  }[];
}

// Global configuration for error categorization (uses internal type to support advanced features)
let errorCategorizationConfig: InternalErrorCategorizationConfig = {};

/**
 * Configure error categorization behavior.
 * Must be called during application initialization before errors are reported.
 *
 * @example
 * // Basic configuration
 * configureErrorCategorization({
 *   disableDefaults: false,
 * });
 *
 * @internal - Advanced usage with custom rules (not part of stable API)
 * @example
 * // Healthcare application (internal use only)
 * configureErrorCategorization({
 *   customRules: [
 *     {
 *       category: ErrorCategory.VALIDATION,
 *       test: (error) => error.name.includes('PatientValidation'),
 *     },
 *   ],
 * });
 */
export function configureErrorCategorization(
  config: ErrorCategorizationConfig | InternalErrorCategorizationConfig,
): void {
  errorCategorizationConfig = config as InternalErrorCategorizationConfig;
}

/**
 * Categorize an error based on its properties for observability
 *
 * Analyzes error name and message to automatically categorize errors into predefined
 * categories for better observability, alerting, and debugging. Supports custom
 * categorization logic via `configureErrorCategorization()`.
 *
 * @param error - The Error object to categorize
 * @returns The determined error category from the ErrorCategory enum
 *
 * @public
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const validationError = new Error("Invalid email format");
 * const category = categorizeErrorForObservability(validationError);
 * // Returns: ErrorCategory.VALIDATION
 *
 * const networkError = new Error("Network connection failed");
 * const networkCategory = categorizeErrorForObservability(networkError);
 * // Returns: ErrorCategory.NETWORK
 * ```
 *
 * @remarks
 * Categorization order:
 * 1. Custom categorizer function (if configured)
 * 2. Custom rules (if configured)
 * 3. Default pattern matching (unless disabled)
 * 4. Returns UNKNOWN if no match
 *
 * @see {@link ErrorCategory} Available error categories
 * @see {@link configureErrorCategorization} Configure custom categorization
 * @see {@link isRetryableError} Check if error should be retried based on category
 */
export function categorizeErrorForObservability(error: Error): ErrorCategory {
  // try custom categorizer first
  if (errorCategorizationConfig.customCategorizer) {
    try {
      const customCategory = errorCategorizationConfig.customCategorizer(error);
      if (customCategory !== undefined) {
        return customCategory;
      }
    } catch (categorizerError) {
      console.error(
        "[@satoshibits/observability] customCategorizer threw an error. " +
          "Falling back to custom rules or default categorization. Error:",
        categorizerError,
      );
    }
  }

  // try custom rules
  if (errorCategorizationConfig.customRules) {
    for (let i = 0; i < errorCategorizationConfig.customRules.length; i++) {
      const rule = errorCategorizationConfig.customRules[i];
      if (!rule) continue;

      try {
        if (rule.test(error)) {
          return rule.category;
        }
      } catch (ruleError) {
        console.error(
          `[@satoshibits/observability] customRules[${i}] threw an error. ` +
            "Skipping rule and continuing. Error:",
          ruleError,
        );
      }
    }
  }

  // use default categorization unless disabled
  if (!errorCategorizationConfig.disableDefaults) {
    return defaultCategorizationLogic(error);
  }

  return ErrorCategory.UNKNOWN;
}

/**
 * Default error categorization logic using pattern matching.
 * This is the built-in categorization that can be augmented or replaced
 * via configuration.
 *
 * @param error - The Error object to categorize
 * @returns The determined error category from the ErrorCategory enum
 */
function defaultCategorizationLogic(error: Error): ErrorCategory {
  const errorName = error.name.toLowerCase();
  const errorMessage = error.message.toLowerCase();

  // validation errors
  if (
    errorName.includes("validation") ||
    errorName.includes("invalid") ||
    errorMessage.includes("validation") ||
    errorMessage.includes("invalid")
  ) {
    return ErrorCategory.VALIDATION;
  }

  // authentication errors
  if (
    errorName.includes("auth") ||
    errorName.includes("unauthorized") ||
    errorMessage.includes("unauthorized") ||
    errorMessage.includes("unauthenticated")
  ) {
    return ErrorCategory.AUTHENTICATION;
  }

  // authorization errors
  if (
    errorName.includes("forbidden") ||
    errorName.includes("permission") ||
    errorMessage.includes("forbidden") ||
    errorMessage.includes("permission")
  ) {
    return ErrorCategory.AUTHORIZATION;
  }

  // not found errors
  if (
    errorName.includes("notfound") ||
    errorMessage.includes("not found") ||
    errorMessage.includes("404")
  ) {
    return ErrorCategory.NOT_FOUND;
  }

  // rate limit errors
  if (
    errorName.includes("ratelimit") ||
    errorMessage.includes("rate limit") ||
    errorMessage.includes("429") ||
    errorMessage.includes("too many")
  ) {
    return ErrorCategory.RATE_LIMIT;
  }

  // timeout errors
  if (
    errorName.includes("timeout") ||
    errorMessage.includes("timeout") ||
    errorMessage.includes("timed out")
  ) {
    return ErrorCategory.TIMEOUT;
  }

  // network errors
  if (
    errorName.includes("network") ||
    errorName.includes("fetch") ||
    errorMessage.includes("network") ||
    errorMessage.includes("connection")
  ) {
    return ErrorCategory.NETWORK;
  }

  // database errors
  if (
    errorName.includes("database") ||
    errorName.includes("sql") ||
    errorMessage.includes("database") ||
    errorMessage.includes("query")
  ) {
    return ErrorCategory.DATABASE;
  }

  // external service errors
  if (
    errorName.includes("external") ||
    errorName.includes("api") ||
    errorMessage.includes("external") ||
    errorMessage.includes("third-party")
  ) {
    return ErrorCategory.EXTERNAL_SERVICE;
  }

  // internal errors
  if (
    errorName.includes("internal") ||
    errorMessage.includes("internal") ||
    errorMessage.includes("500")
  ) {
    return ErrorCategory.INTERNAL;
  }

  return ErrorCategory.UNKNOWN;
}

/**
 * Configuration for retry classification
 *
 * Public API includes commonly-used option for customizing retryable categories.
 * Advanced features (custom retry functions) are available internally but not
 * exposed to prevent API bloat.
 */
export interface RetryClassificationConfig {
  /**
   * List of error categories to consider retryable.
   * When provided, replaces the default retryable categories.
   *
   * @example
   * // Background Jobs - aggressive retry policy
   * retryableCategories: [
   *   ErrorCategory.TIMEOUT,
   *   ErrorCategory.NETWORK,
   *   ErrorCategory.RATE_LIMIT,
   *   ErrorCategory.DATABASE,
   *   ErrorCategory.EXTERNAL_SERVICE,
   *   ErrorCategory.INTERNAL,
   * ]
   *
   * @example
   * // Real-time System - conservative retry policy
   * retryableCategories: [
   *   ErrorCategory.TIMEOUT,
   *   ErrorCategory.NETWORK,
   * ]
   *
   * @example
   * // Disable all automatic retries
   * retryableCategories: []
   */
  retryableCategories?: ErrorCategory[];
}

/**
 * Internal configuration with advanced retry classification features
 * @internal - Not part of public API, kept for future use
 */
interface InternalRetryClassificationConfig extends RetryClassificationConfig {
  /**
   * Custom function to determine if an error should be retried.
   * Called first before checking retryableCategories or default logic.
   *
   * **Performance Note:** This function is on a hot path and will be invoked for every error.
   * Keep it fast and avoid expensive operations.
   *
   * Return `undefined` to fall through to retryableCategories or default logic.
   *
   * @example
   * // API Gateway - only retry clear transient errors
   * isRetryable: (error, category) => {
   *   return (
   *     category === ErrorCategory.TIMEOUT ||
   *     category === ErrorCategory.NETWORK
   *   );
   * }
   *
   * @example
   * // Data Pipeline - status code based retry
   * isRetryable: (error) => {
   *   if (error instanceof HTTPError) {
   *     return error.statusCode >= 500 && error.statusCode < 600;
   *   }
   *   return undefined; // fall through to default
   * }
   */
  isRetryable?: (error: Error, category: ErrorCategory) => boolean | undefined;
}

// Global configuration for retry classification (uses internal type to support advanced features)
let retryClassificationConfig: InternalRetryClassificationConfig = {};

/**
 * Configure retry classification behavior.
 * Must be called during application initialization before errors are checked for retryability.
 *
 * @example
 * // API Gateway service
 * configureRetryClassification({
 *   retryableCategories: [
 *     ErrorCategory.TIMEOUT,
 *     ErrorCategory.NETWORK,
 *   ],
 * });
 *
 * @internal - Advanced usage with custom retry functions (not part of stable API)
 * @example
 * // Custom retry logic based on error properties (internal use only)
 * configureRetryClassification({
 *   isRetryable: (error, category) => {
 *     if (error instanceof HTTPError) {
 *       return error.statusCode >= 500;
 *     }
 *     return category === ErrorCategory.TIMEOUT;
 *   },
 * });
 */
export function configureRetryClassification(
  config: RetryClassificationConfig | InternalRetryClassificationConfig,
): void {
  retryClassificationConfig = config as InternalRetryClassificationConfig;
}

/**
 * Determine if an error is retryable for observability
 *
 * Analyzes error category to determine if the error condition is typically
 * transient and worth retrying. Useful for implementing retry logic, circuit
 * breakers, and resilience patterns. Supports custom retry logic via
 * `configureRetryClassification()`.
 *
 * @param error - The Error object to analyze
 * @returns True if the error is typically retryable, false otherwise
 *
 * @public
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const networkError = new Error("Connection timeout");
 * const shouldRetry = isRetryableError(networkError);
 * // Returns: true (network errors are typically retryable)
 *
 * const validationError = new Error("Invalid email format");
 * const shouldRetryValidation = isRetryableError(validationError);
 * // Returns: false (validation errors are not retryable)
 * ```
 *
 * @remarks
 * Retry decision order:
 * 1. Custom isRetryable function (if configured)
 * 2. Custom retryableCategories list (if configured)
 * 3. Default retryable categories (unless custom categories provided)
 *
 * Default categories considered retryable:
 * - TIMEOUT: Service timeouts
 * - NETWORK: Connectivity issues
 * - RATE_LIMIT: Temporary throttling
 * - DATABASE: Connection/transient issues
 * - EXTERNAL_SERVICE: Third-party failures
 *
 * @see {@link categorizeErrorForObservability} Error categorization function
 * @see {@link ErrorCategory} Available error categories
 * @see {@link configureRetryClassification} Configure custom retry logic
 */
export function isRetryableError(error: Error): boolean {
  const category = categorizeErrorForObservability(error);

  // try custom retry function first
  if (retryClassificationConfig.isRetryable) {
    try {
      const customDecision = retryClassificationConfig.isRetryable(
        error,
        category,
      );
      if (customDecision !== undefined) {
        return customDecision;
      }
    } catch (retryError) {
      console.error(
        "[@satoshibits/observability] isRetryable function threw an error. " +
          "Returning false (no retry) for safety. Error:",
        retryError,
      );
      // be conservative - don't retry if we can't determine retryability
      return false;
    }
  }

  // use custom retryable categories if provided, otherwise use default
  const retryableCategories =
    retryClassificationConfig?.retryableCategories ??
    defaultRetryableCategories();

  return retryableCategories.includes(category);
}

/**
 * Default retry categories used when no custom configuration is provided.
 * This is the built-in retry logic that can be replaced via configuration.
 *
 * @returns Array of error categories that are retryable by default
 */
function defaultRetryableCategories(): ErrorCategory[] {
  return [
    ErrorCategory.TIMEOUT,
    ErrorCategory.NETWORK,
    ErrorCategory.RATE_LIMIT,
    ErrorCategory.DATABASE, // connection issues
    ErrorCategory.EXTERNAL_SERVICE, // temporary failures
  ];
}

/**
 * Interface for extended error types with common properties
 */
interface ExtendedError extends Error {
  code?: string | number;
  statusCode?: number;
  details?: unknown;
}

/**
 * Type guard to check if an error has extended properties
 */
function isExtendedError(error: Error): error is ExtendedError {
  return (
    typeof error === "object" &&
    error !== null &&
    ("code" in error || "statusCode" in error || "details" in error)
  );
}

/**
 * Extract error context for enrichment
 *
 * SECURITY: All extracted data is sanitized to prevent leaking
 * sensitive information (passwords, API keys, PII) to telemetry backends.
 */
export function extractErrorContext(error: Error): Record<string, unknown> {
  // sanitize error message and stack to protect sensitive data
  // use dedicated ERROR_SANITIZER for strict security
  const sanitizedMessage = ERROR_SANITIZER.sanitize(error.message) as string;
  const sanitizedStack = error.stack
    ? (ERROR_SANITIZER.sanitize(error.stack) as string)
    : undefined;

  const context: Record<string, unknown> = {
    "error.type": error.constructor.name,
    "error.message": sanitizedMessage,
    "error.category": categorizeErrorForObservability(error),
    "error.retryable": isRetryableError(error),
  };

  // add sanitized stack trace if available
  if (sanitizedStack) {
    context["error.stack"] = sanitizedStack;
  }

  // add any custom properties on the error using type-safe approach
  if (isExtendedError(error)) {
    if (error.code !== undefined) context["error.code"] = error.code;
    if (error.statusCode !== undefined)
      context["error.status_code"] = error.statusCode;
    // sanitize details object to protect sensitive data
    if (error.details !== undefined) {
      context["error.details"] = sanitizeErrorValue(error.details);
    }
  }

  return context;
}

/**
 * Sanitize a value recursively to protect sensitive data in errors
 * Uses strict ERROR_SANITIZER for maximum security
 */
function sanitizeErrorValue(value: unknown): unknown {
  // use ERROR_SANITIZER.sanitize() which handles all types recursively
  return ERROR_SANITIZER.sanitize(value);
}

/**
 * Report an error with automatic trace and log correlation
 *
 * SECURITY: All error data and context is sanitized before export
 * to prevent leaking sensitive information to telemetry backends.
 *
 * @param error - The error to report
 * @param customContext - Additional context to attach to the error
 * @param instrumentation - Optional instrumentation instances to use instead of defaults
 */
export function reportError(
  error: Error,
  customContext?: Record<string, unknown>,
  instrumentation?: {
    tracer?: Tracer;
    logger?: Logger;
  },
) {
  // Use provided instrumentation or fall back to SDK-level globals
  const tracer = instrumentation?.tracer ?? trace.getTracer("smart-client");
  const logger = instrumentation?.logger ?? logs.getLogger("smart-client");

  const span = trace.getActiveSpan();
  const errorContext = extractErrorContext(error); // already sanitized
  const businessContext = getBusinessContext();
  const globalContext = getGlobalContext().getContext();

  // sanitize custom context to protect sensitive data
  const sanitizedCustomContext = customContext
    ? (sanitizeErrorValue(customContext) as Record<string, unknown>)
    : undefined;

  // merge all context sources including breadcrumbs
  const fullContext = {
    ...errorContext,
    ...businessContext,
    // Convert breadcrumbs to a serializable format
    "breadcrumbs.count": globalContext.breadcrumbs.length,
    "breadcrumbs.latest":
      globalContext.breadcrumbs.length > 0
        ? (globalContext.breadcrumbs[globalContext.breadcrumbs.length - 1]
            ?.message ?? "")
        : "",
    ...sanitizedCustomContext,
  } as Attributes;

  // sanitize error message for status using strict ERROR_SANITIZER
  const sanitizedErrorMessage = ERROR_SANITIZER.sanitize(error.message) as string;

  // record in trace if there's an active span
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: sanitizedErrorMessage,
    });
    span.setAttributes(fullContext);
  } else {
    // create a new span for the error if no active span
    const errorSpan = tracer.startSpan("error.report");
    errorSpan.recordException(error);
    errorSpan.setAttributes(fullContext);
    errorSpan.end();
  }

  // also emit structured log with automatic trace correlation
  logger.emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: sanitizedErrorMessage,
    attributes: fullContext,
    // trace context automatically included by SDK 2.0
  });
}

/**
 * Report a Result error if it's an error (Universal Result support)
 */
export function reportResultError<T, E extends Error>(
  result: unknown,
  customContext?: Record<string, unknown>,
): void {
  const adapter = getResultAdapter<T, E>(result);
  if (adapter && !adapter.isSuccess()) {
    const error = adapter.getError();
    if (error) {
      reportError(error, customContext);
    }
  }
}

/**
 * Create an error reporter with pre-configured context
 */
export function createErrorReporter(defaultContext: Record<string, unknown>) {
  return {
    report(error: Error, additionalContext?: Record<string, unknown>) {
      reportError(error, {
        ...defaultContext,
        ...additionalContext,
      });
    },

    reportResult<_T, _E extends Error>(
      result: unknown,
      additionalContext?: Record<string, unknown>,
    ) {
      reportResultError(result, { ...defaultContext, ...additionalContext });
    },
  };
}

/**
 * Wrap a function to automatically report errors
 */
export function withErrorReporting<T>(
  fn: () => T | Promise<T>,
  customContext?: Record<string, unknown>,
): T | Promise<T> {
  try {
    const result = fn();

    if (isThenable(result)) {
      return result.catch((error) => {
        reportError(error as Error, customContext);
        throw error;
      });
    }

    return result;
  } catch (error) {
    reportError(error as Error, customContext);
    throw error;
  }
}

/**
 * Create error metrics for monitoring error rates
 */
export function createErrorMetrics(meter: import("@opentelemetry/api").Meter) {
  const errorCount = metrics.createSmartCounter(
    "errors.count",
    meter,
    "Total error count",
  );

  const errorRate = metrics.createSmartGauge(
    "errors.rate",
    meter,
    "Error rate per minute",
  );

  return {
    /**
     * Record an error occurrence
     */
    recordError(error: Error, customContext?: Record<string, unknown>) {
      const category = categorizeErrorForObservability(error);
      const retryable = isRetryableError(error);

      errorCount.increment(1, {
        category,
        retryable,
        error_type: error.constructor.name,
        ...customContext,
      });
    },

    /**
     * Update the error rate
     */
    updateErrorRate(rate: number, category?: ErrorCategory) {
      errorRate.set(rate, category ? { category } : undefined);
    },
  };
}
