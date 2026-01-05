/**
 * Metric validation utilities for OpenTelemetry compliance
 *
 * Validates metric names and values according to OpenTelemetry specification,
 * emits diagnostic telemetry, and provides console warnings for validation failures.
 *
 * @module internal/metric-validation
 * @internal
 * @see https://opentelemetry.io/docs/specs/otel/metrics/api/#instrument-name-syntax
 * @see https://opentelemetry.io/docs/specs/otel/common/#attribute-limits
 */

import { metrics } from "@opentelemetry/api";
import { isAttributeValue } from "@opentelemetry/core";
import type { Meter } from "@opentelemetry/api";

/**
 * Creates a safe cache key that prevents collisions.
 * Sanitizes the scope name and uses double underscore as separator.
 * @param scopeName - The instrumentation scope name
 * @param type - The instrument type (counter, histogram, gauge, updown)
 * @param name - The metric name
 * @returns A collision-safe cache key
 */
export function createSafeCacheKey(
  scopeName: string,
  type: string,
  name: string,
): string {
  // replace any character that's not alphanumeric, dash, underscore, at, dot, or slash
  // this prevents injection of our separator and ensures cache key safety
  const sanitizedScope = scopeName.replace(/[^a-zA-Z0-9\-_@./]/g, "_");
  const sanitizedName = name.replace(/[^a-zA-Z0-9\-_@./]/g, "_");
  // use double underscore as separator since it's unlikely in normal names
  return `${sanitizedScope}__${type}__${sanitizedName}`;
}

/**
 * Diagnostic meter for tracking validation failures
 * Uses a separate instrumentation scope to avoid polluting user metrics
 */
const getDiagnosticMeter = (() => {
  let diagnosticMeter: Meter | null = null;

  return () => {
    if (!diagnosticMeter) {
      diagnosticMeter = metrics.getMeter("@satoshibits/observability/diagnostics", "1.0.0");
    }
    return diagnosticMeter;
  };
})();

/**
 * Validation failure reasons for diagnostic telemetry
 */
enum ValidationFailureReason {
  INVALID_NAME_TYPE = "invalid_name_type",
  EMPTY_NAME = "empty_name",
  NAME_TOO_LONG = "name_too_long",
  HIGH_CARDINALITY_PATTERN = "high_cardinality_pattern",
  INVALID_VALUE_TYPE = "invalid_value_type",
  NOT_A_NUMBER = "not_a_number",
  NON_FINITE_NUMBER = "non_finite_number",
}

/**
 * Tracks validation failures with diagnostic telemetry and console warnings
 */
function recordValidationFailure(
  type: "name" | "value",
  reason: ValidationFailureReason,
  input: unknown,
  context?: { metricType?: string; scopeName?: string }
): void {
  // emit diagnostic metric to track validation failures
  try {
    const meter = getDiagnosticMeter();
    const counter = meter.createCounter("metric.validation.failures", {
      description: "Tracks metric validation failures to help debug missing metrics",
    });

    counter.add(1, {
      "validation.type": type,
      "validation.reason": reason,
      "metric.type": context?.metricType ?? "unknown",
      "scope.name": context?.scopeName ?? "unknown",
    });
  } catch {
    // diagnostic telemetry failure should not break application logic
  }

  // emit console warning for developer visibility
  const inputStr = String(input).substring(0, 100); // limit output length
  const contextStr = context?.metricType
    ? ` (metric type: ${context.metricType}, scope: ${context.scopeName})`
    : "";

  console.warn(
    `[@satoshibits/observability] Metric validation failed: ${reason}. ` +
    `Input: ${inputStr}${contextStr}. ` +
    `This metric will not be recorded. ` +
    `See: https://opentelemetry.io/docs/specs/otel/metrics/api/#instrument`
  );
}

/**
 * Validates metric names and values according to OpenTelemetry specification.
 * Emits diagnostic telemetry and console warnings on validation failures.
 * @see https://opentelemetry.io/docs/specs/otel/metrics/api/#instrument-name-syntax
 * @see https://opentelemetry.io/docs/specs/otel/common/#attribute-limits
 */
export const MetricValidation = {
  /**
   * Validates a metric name - must be 63 chars or less per OTel spec
   * Also checks for high-cardinality patterns to prevent cardinality explosion
   * @param name - The metric name to validate
   * @param context - Optional context for better diagnostics (metric type, scope)
   * @returns The validated (potentially truncated/sanitized) name, or null if invalid
   * @see https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/metrics/api.md#instrument-name-syntax
   */
  validateName(
    name: unknown,
    context?: { metricType?: string; scopeName?: string }
  ): string | null {
    if (typeof name !== "string") {
      recordValidationFailure("name", ValidationFailureReason.INVALID_NAME_TYPE, name, context);
      return null;
    }

    if (!name) {
      recordValidationFailure("name", ValidationFailureReason.EMPTY_NAME, name, context);
      return null;
    }

    // OTel spec: metric names limited to 63 characters
    let validatedName = name;
    if (name.length > 63) {
      recordValidationFailure("name", ValidationFailureReason.NAME_TOO_LONG, name, context);
      // truncate to 63 chars but warn about it
      console.warn(
        `[@satoshibits/observability] Metric name truncated from ${name.length} to 63 chars: "${name}" -> "${name.substring(0, 63)}". ` +
        `This changes metric semantics. Use shorter names to avoid confusion.`
      );
      validatedName = name.substring(0, 63);
    }

    // check for high-cardinality patterns (dynamic values in metric names)
    const dynamicPatterns = [
      { pattern: /\{[^}]+\}/g, description: "template variable" },        // {userId}, {requestId}
      { pattern: /\$\{[^}]+\}/g, description: "template literal" },       // ${userId}, ${id}
      { pattern: /\{\{[^}]+\}\}/g, description: "double-brace variable" }, // {{userId}}
    ];

    let hasDynamicPattern = false;
    let patternDescription = "";
    for (const { pattern, description } of dynamicPatterns) {
      if (pattern.test(validatedName)) {
        hasDynamicPattern = true;
        patternDescription = description;
        break;
      }
    }

    if (hasDynamicPattern) {
      // emit diagnostic warning
      recordValidationFailure("name", ValidationFailureReason.HIGH_CARDINALITY_PATTERN, validatedName, context);
      console.warn(
        `[@satoshibits/observability] Metric name contains dynamic pattern (${patternDescription}): "${validatedName}". ` +
        `This can cause cardinality explosion. Use attributes instead: ` +
        `metrics.increment("requests", 1, { userId: "123" }). ` +
        `The pattern will be sanitized to prevent unbounded cardinality.`
      );

      // sanitize by replacing patterns with placeholder
      let sanitized = validatedName;
      for (const { pattern } of dynamicPatterns) {
        sanitized = sanitized.replace(pattern, "{value}");
      }
      return sanitized;
    }

    return validatedName;
  },

  /**
   * Validates a numeric value per OTel spec
   * @param value - The value to validate
   * @param context - Optional context for better diagnostics (metric type, scope)
   * @returns The validated number, or null if invalid
   */
  validateValue(
    value: unknown,
    context?: { metricType?: string; scopeName?: string }
  ): number | null {
    // use OTel's isAttributeValue to check if it's a valid primitive type
    if (!isAttributeValue(value)) {
      recordValidationFailure("value", ValidationFailureReason.INVALID_VALUE_TYPE, value, context);
      return null;
    }

    if (typeof value !== "number") {
      recordValidationFailure("value", ValidationFailureReason.NOT_A_NUMBER, value, context);
      return null;
    }

    // OTel spec requires finite numbers (no NaN or Infinity)
    if (!Number.isFinite(value)) {
      recordValidationFailure("value", ValidationFailureReason.NON_FINITE_NUMBER, value, context);
      return null;
    }

    return value;
  },
};
