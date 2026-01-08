/**
 * Smart Error Integration
 *
 * Integrates errors with OpenTelemetry traces and logs.
 * Provides automatic correlation and context enrichment.
 */
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

import type { SanitizerOptions } from "./enrichment/sanitizer.mjs";
import type { Attributes, Tracer } from "@opentelemetry/api";
import type { Logger } from "@opentelemetry/api-logs";

import { getBusinessContext, getGlobalContext } from "./enrichment/context.mjs";
import { DataSanitizer, SanitizerPresets } from "./enrichment/sanitizer.mjs";
import { getResultAdapter } from "./utils/result-adapter.mjs";
import { isThenable } from "./utils/thenable.mjs";

// ===== Error Sanitizer Configuration (API Boundary Fix) =====

/**
 * Error sanitizer preset type.
 * Controls the baseline sanitization rules for error data.
 */
export type ErrorSanitizerPreset = "strict" | "minimal" | "none";

/**
 * Strict preset - GDPR-compliant with comprehensive secret detection.
 * This is the default and provides maximum protection.
 */
const STRICT_ERROR_SANITIZER_OPTIONS: SanitizerOptions = {
  ...SanitizerPresets.gdpr(), // GDPR baseline (masks phones, IPs)
  maskEmails: false, // Disable partial masking - we do full redaction via custom pattern
  strictMode: true, // Enable strict mode to catch API keys and other patterns
  redactionString: "[REDACTED]",
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
      pattern:
        /((?:mongodb|postgresql|mysql|redis|amqp):\/\/[^:]+:)([^@]+)(@)/gi,
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
};

/**
 * Minimal preset - Only redacts obvious secrets.
 * Use when you need less aggressive sanitization but still want protection.
 */
const MINIMAL_ERROR_SANITIZER_OPTIONS: SanitizerOptions = {
  strictMode: true,
  redactionString: "[REDACTED]",
  customPatterns: [
    // API keys and secrets
    {
      pattern:
        /\b(api[_-]?key|apikey|secret[_-]?key|password|passwd|pwd)[:=\s]+\S+/gi,
      replacement: "$1: [REDACTED]",
    },
    // Passwords in connection strings
    {
      pattern:
        /((?:mongodb|postgresql|mysql|redis|amqp):\/\/[^:]+:)([^@]+)(@)/gi,
      replacement: "$1[REDACTED]$3",
    },
  ],
};

/**
 * Get error sanitizer options based on preset.
 */
function getPresetOptions(preset: ErrorSanitizerPreset): SanitizerOptions {
  switch (preset) {
    case "strict":
      return STRICT_ERROR_SANITIZER_OPTIONS;
    case "minimal":
      return MINIMAL_ERROR_SANITIZER_OPTIONS;
    case "none":
      return {}; // No sanitization
    default:
      return STRICT_ERROR_SANITIZER_OPTIONS;
  }
}

/**
 * Module-level error sanitizer instance.
 * Configurable via configureErrorSanitizer() during SDK initialization.
 */
let errorSanitizer: DataSanitizer = new DataSanitizer(
  STRICT_ERROR_SANITIZER_OPTIONS,
);

/**
 * Configure the error sanitizer with custom options.
 *
 * API Boundary Fix: This function allows consumers to customize the error
 * sanitizer behavior instead of being forced to use hardcoded GDPR/Stripe patterns.
 *
 * Called automatically during SDK initialization if config options are provided.
 * Can also be called manually for advanced use cases.
 *
 * @param preset - Base preset to use ('strict', 'minimal', 'none')
 * @param customOptions - Additional options to merge with preset
 *
 * @example
 * ```typescript
 * // Use minimal preset with custom patterns
 * configureErrorSanitizer('minimal', {
 *   customPatterns: [
 *     { pattern: /my-vendor-key-\w+/gi, replacement: '[VENDOR_KEY]' }
 *   ]
 * });
 * ```
 */
export function configureErrorSanitizer(
  preset: ErrorSanitizerPreset = "strict",
  customOptions?: SanitizerOptions,
): void {
  const presetOptions = getPresetOptions(preset);

  // Merge preset with custom options (custom takes precedence)
  const mergedOptions: SanitizerOptions = {
    ...presetOptions,
    ...customOptions,
    // Merge custom patterns arrays if both exist
    customPatterns: [
      ...(presetOptions.customPatterns ?? []),
      ...(customOptions?.customPatterns ?? []),
    ],
  };

  errorSanitizer = new DataSanitizer(mergedOptions);
}

/**
 * Get the current error sanitizer instance.
 * Used internally by error reporting functions.
 */
function getErrorSanitizer(): DataSanitizer {
  return errorSanitizer;
}

/**
 * Reset error sanitizer to default (strict preset).
 * Useful for testing.
 * @internal
 */
export function resetErrorSanitizer(): void {
  errorSanitizer = new DataSanitizer(STRICT_ERROR_SANITIZER_OPTIONS);
}

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
// M5 fix: This global config is deprecated for multi-tenant applications.
// Prefer passing config via client instance for tenant isolation.
let errorCategorizationConfig: InternalErrorCategorizationConfig = {};

/**
 * Configure error categorization behavior globally.
 * Must be called during application initialization before errors are reported.
 *
 * @deprecated For multi-tenant applications, use `createErrorReporter({ categorizationConfig: {...} })`
 * or pass config directly to error functions. Global configuration is shared across all clients
 * and does not support tenant isolation. This function will be removed in a future major version.
 *
 * @example
 * // Basic configuration (single-tenant only)
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
  console.warn(
    "[@satoshibits/observability] configureErrorCategorization() is deprecated. " +
      "For multi-tenant applications, use instance-level configuration via createErrorReporter(). " +
      "Global configuration does not support tenant isolation.",
  );
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
 * API Boundary Fix - Issue #9: Extract structured data from errors
 * Prioritizes HTTP status codes and error codes over string matching.
 * Works across locales and with third-party libraries that use different terminology.
 *
 * @param error - The Error object to extract data from
 * @returns Category if structured data matches, undefined otherwise
 */
function categorizeByStructuredData(error: Error): ErrorCategory | undefined {
  // check error.status or error.statusCode (HTTP errors from fetch, axios, etc.)
  // Multi-model review (Codex): Some libraries expose status as string - coerce with Number()
  const rawStatus =
    (error as Error & { status?: number | string }).status ??
    (error as Error & { statusCode?: number | string }).statusCode ??
    (error as Error & { response?: { status?: number | string } }).response
      ?.status;
  const statusCode =
    typeof rawStatus === "string" ? Number(rawStatus) : rawStatus;

  if (typeof statusCode === "number" && Number.isFinite(statusCode)) {
    // 400 Bad Request, 409 Conflict, 422 Unprocessable Entity (validation errors)
    // Multi-model review (Codex + Gemini): Added 409 for duplicate/conflict errors
    if (statusCode === 400 || statusCode === 409 || statusCode === 422)
      return ErrorCategory.VALIDATION;
    if (statusCode === 401) return ErrorCategory.AUTHENTICATION;
    if (statusCode === 403) return ErrorCategory.AUTHORIZATION;
    if (statusCode === 404) return ErrorCategory.NOT_FOUND;
    // 408 Request Timeout, 504 Gateway Timeout
    if (statusCode === 408 || statusCode === 504) return ErrorCategory.TIMEOUT;
    if (statusCode === 429) return ErrorCategory.RATE_LIMIT;
    // Note: 502/503 categorized as INTERNAL. For outbound HTTP errors where the
    // *dependency* failed, consumers can use customCategorizer to route to EXTERNAL_SERVICE.
    if (statusCode >= 500 && statusCode < 600) return ErrorCategory.INTERNAL;
  }

  // check error.code (Node.js system errors, database drivers, etc.)
  // Multi-model review (Codex + Gemini): Handle numeric codes (e.g., MongoDB 11000)
  const rawCode = (error as Error & { code?: string | number }).code;
  if (rawCode !== undefined && rawCode !== null) {
    // normalize to uppercase string for case-insensitive matching
    const upperCode = String(rawCode).toUpperCase();

    // network-related codes
    // Multi-model review (Codex): Added EHOSTUNREACH, ENETDOWN, ENETRESET, EAI_AGAIN
    if (
      upperCode === "ECONNREFUSED" ||
      upperCode === "ENOTFOUND" ||
      upperCode === "ECONNRESET" ||
      upperCode === "EPIPE" ||
      upperCode === "ENETUNREACH" ||
      upperCode === "EHOSTUNREACH" ||
      upperCode === "ENETDOWN" ||
      upperCode === "ENETRESET" ||
      upperCode === "EAI_AGAIN" // DNS lookup failure
    ) {
      return ErrorCategory.NETWORK;
    }
    // timeout-related codes
    if (
      upperCode === "ETIMEDOUT" ||
      upperCode === "ESOCKETTIMEDOUT" ||
      upperCode === "ECONNABORTED"
    ) {
      return ErrorCategory.TIMEOUT;
    }
    // database-related codes (common across drivers)
    if (
      upperCode.startsWith("ER_") || // MySQL
      upperCode.startsWith("23") || // PostgreSQL constraint violations
      upperCode === "SQLITE_CONSTRAINT" ||
      upperCode === "11000" // MongoDB duplicate key
    ) {
      return ErrorCategory.DATABASE;
    }
  }

  return undefined;
}

/**
 * Default error categorization logic using pattern matching.
 * This is the built-in categorization that can be augmented or replaced
 * via configuration.
 *
 * API Boundary Fix - Issue #9: Now prioritizes structured data (HTTP status,
 * error codes) before falling back to string matching. This improves
 * reliability across locales and third-party libraries.
 *
 * @param error - The Error object to categorize
 * @returns The determined error category from the ErrorCategory enum
 */
function defaultCategorizationLogic(error: Error): ErrorCategory {
  // API Boundary Fix - Issue #9: Try structured data first (locale-independent)
  const structuredCategory = categorizeByStructuredData(error);
  if (structuredCategory !== undefined) {
    return structuredCategory;
  }

  // fall back to string matching for errors without structured data
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
// M5 fix: This global config is deprecated for multi-tenant applications.
// Prefer passing config via client instance for tenant isolation.
let retryClassificationConfig: InternalRetryClassificationConfig = {};

/**
 * Configure retry classification behavior globally.
 * Must be called during application initialization before errors are checked for retryability.
 *
 * @deprecated For multi-tenant applications, use `createErrorReporter({ retryConfig: {...} })`
 * or pass config directly to error functions. Global configuration is shared across all clients
 * and does not support tenant isolation. This function will be removed in a future major version.
 *
 * @example
 * // API Gateway service (single-tenant only)
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
  console.warn(
    "[@satoshibits/observability] configureRetryClassification() is deprecated. " +
      "For multi-tenant applications, use instance-level configuration via createErrorReporter(). " +
      "Global configuration does not support tenant isolation.",
  );
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
  // use configurable error sanitizer for strict security
  const sanitizer = getErrorSanitizer();
  const sanitizedMessage = sanitizer.sanitize(error.message) as string;
  const sanitizedStack = error.stack
    ? (sanitizer.sanitize(error.stack) as string)
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
 * Uses configurable error sanitizer for maximum security
 */
function sanitizeErrorValue(value: unknown): unknown {
  // use error sanitizer which handles all types recursively
  return getErrorSanitizer().sanitize(value);
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

  // sanitize error message for status using configurable error sanitizer
  const sanitizedErrorMessage = getErrorSanitizer().sanitize(
    error.message,
  ) as string;

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
 * Options for creating an error reporter with instance-level configuration
 * M5 fix: Enables multi-tenant isolation without using global mutable state
 */
export interface ErrorReporterOptions {
  /**
   * Default context to attach to all errors reported by this instance
   */
  defaultContext?: Record<string, unknown>;

  /**
   * Instance-level error categorization config
   * Overrides global config for errors reported through this instance
   */
  categorizationConfig?: ErrorCategorizationConfig;

  /**
   * Instance-level retry classification config
   * Overrides global config for errors reported through this instance
   */
  retryConfig?: RetryClassificationConfig;
}

/**
 * Create an error reporter with pre-configured context and optional instance-level configuration
 *
 * M5 fix: For multi-tenant applications, use instance-level configuration instead of
 * the deprecated global `configureErrorCategorization()` and `configureRetryClassification()`.
 *
 * @example
 * // Multi-tenant usage with different error handling per tenant
 * const tenantAReporter = createErrorReporter({
 *   defaultContext: { tenantId: 'tenant-a' },
 *   categorizationConfig: { disableDefaults: false },
 *   retryConfig: { retryableCategories: [ErrorCategory.TIMEOUT, ErrorCategory.NETWORK] },
 * });
 *
 * const tenantBReporter = createErrorReporter({
 *   defaultContext: { tenantId: 'tenant-b' },
 *   retryConfig: { retryableCategories: [] }, // No automatic retries for this tenant
 * });
 *
 * @example
 * // Legacy usage (backward compatible)
 * const reporter = createErrorReporter({ service: 'my-service' });
 */
export function createErrorReporter(
  optionsOrContext: ErrorReporterOptions | Record<string, unknown>,
) {
  // Known ErrorReporterOptions keys for detection
  const optionsKeys = ["defaultContext", "categorizationConfig", "retryConfig"];

  // backward compatibility: detect if this is ErrorReporterOptions or plain context
  const isOptionsObject =
    optionsOrContext && optionsKeys.some((key) => key in optionsOrContext);

  // M5 fix: Warn if user passes mixed object (options fields + extra properties)
  // This prevents silent data loss during migration
  if (isOptionsObject) {
    const unknownKeys = Object.keys(optionsOrContext).filter(
      (key) => !optionsKeys.includes(key),
    );
    if (unknownKeys.length > 0) {
      console.warn(
        `[@satoshibits/observability] Properties [${unknownKeys.join(", ")}] on ` +
          "createErrorReporter() options were ignored. Move them into 'defaultContext': " +
          `createErrorReporter({ defaultContext: { ${unknownKeys.join(", ")}, ... }, ... })`,
      );
    }
  }

  const options: ErrorReporterOptions = isOptionsObject
    ? (optionsOrContext as ErrorReporterOptions)
    : { defaultContext: optionsOrContext as Record<string, unknown> };

  const defaultContext = options.defaultContext ?? {};

  // instance-level categorize function that uses local config if provided
  const categorizeWithConfig = (error: Error): ErrorCategory => {
    if (options.categorizationConfig) {
      // use instance config - check disableDefaults
      if (options.categorizationConfig.disableDefaults) {
        return ErrorCategory.UNKNOWN;
      }
      return defaultCategorizationLogic(error);
    }
    // fall back to global
    return categorizeErrorForObservability(error);
  };

  // instance-level retry check that uses local config if provided
  const isRetryableWithConfig = (error: Error): boolean => {
    if (options.retryConfig) {
      const category = categorizeWithConfig(error);
      const retryableCategories =
        options.retryConfig.retryableCategories ?? defaultRetryableCategories();
      return retryableCategories.includes(category);
    }
    // fall back to global
    return isRetryableError(error);
  };

  // M5 fix: Helper to build instance context for both report and reportResult
  const buildInstanceContext = (error: Error): Record<string, unknown> => {
    if (options.categorizationConfig || options.retryConfig) {
      return {
        "error.category": categorizeWithConfig(error),
        "error.retryable": isRetryableWithConfig(error),
      };
    }
    return {};
  };

  // create reporter object with self-reference for reportResult to use report()
  const reporter = {
    report(error: Error, additionalContext?: Record<string, unknown>) {
      // add instance-level categorization info if custom config provided
      const instanceContext = buildInstanceContext(error);

      reportError(error, {
        ...defaultContext,
        ...instanceContext,
        ...additionalContext,
      });
    },

    // M5 fix: Now uses this.report() to ensure instance config is applied
    reportResult<_T, _E extends Error>(
      result: unknown,
      additionalContext?: Record<string, unknown>,
    ) {
      const adapter = getResultAdapter<_T, _E>(result);
      if (adapter && !adapter.isSuccess()) {
        const error = adapter.getError();
        if (error) {
          // Use reporter.report to ensure instance config is applied
          reporter.report(error, additionalContext);
        }
      }
    },

    /**
     * Categorize an error using this instance's configuration
     */
    categorize(error: Error): ErrorCategory {
      return categorizeWithConfig(error);
    },

    /**
     * Check if an error is retryable using this instance's configuration
     */
    isRetryable(error: Error): boolean {
      return isRetryableWithConfig(error);
    },
  };

  return reporter;
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

// [M3] Removed createErrorMetrics() - unused factory, use errors.record() API instead
