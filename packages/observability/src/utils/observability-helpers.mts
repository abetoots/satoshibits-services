/**
 * Shared helper functions for observability operations
 *
 * These functions extract common logic for logging and error handling
 * that is used by both ScopedInstrument and UnifiedObservabilityClient.
 */

import { SeverityNumber } from "@opentelemetry/api-logs";

import type { Tracer } from "@opentelemetry/api";
import type { LogAttributes, Logger } from "@opentelemetry/api-logs";

import { getEnrichedLabels } from "../enrichment/context.mjs";
import { reportError } from "../smart-errors.mjs";

/**
 * Convert object to OpenTelemetry-compatible attribute values
 * @internal
 */
function toOtelAttributes(
  obj: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | (string | number | boolean)[]> {
  if (!obj) return {};

  const result: Record<
    string,
    string | number | boolean | (string | number | boolean)[]
  > = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue; // skip null/undefined values
    }

    // handle primitives that OpenTelemetry accepts directly
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      result[key] = value;
      continue;
    }

    // handle arrays of primitives
    if (Array.isArray(value)) {
      const filtered = value.filter(
        (item) =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      );
      if (filtered.length > 0) {
        result[key] = filtered;
      }
      continue;
    }

    // handle objects - convert to JSON strings to avoid '[object Object]'
    if (typeof value === "object") {
      try {
        result[key] = JSON.stringify(value);
      } catch {
        // fallback for non-serializable objects
        result[key] = "[Object]";
      }
      continue;
    }

    // handle functions
    if (typeof value === "function") {
      result[key] = "[Function]";
      continue;
    }

    // handle symbols - safe to stringify
    if (typeof value === "symbol") {
      result[key] = String(value);
      continue;
    }

    // handle bigints - safe to stringify
    if (typeof value === "bigint") {
      result[key] = String(value);
      continue;
    }

    // all other types are skipped
  }
  return result;
}

/**
 * Shared helper for emitting log entries with proper sanitization and enrichment
 *
 * @param logger - OpenTelemetry logger instance
 * @param level - Log severity level (number)
 * @param levelText - Log severity level (text)
 * @param message - Log message
 * @param attributes - Log attributes to include
 * @param sanitizer - Function to sanitize attributes before emission
 */
export function emitLogEntry(
  logger: Logger,
  level: SeverityNumber,
  levelText: string,
  message: string,
  attributes: LogAttributes | undefined,
  sanitizer: (
    attrs: LogAttributes | undefined,
  ) => Record<string, unknown> | LogAttributes | undefined,
): void {
  const sanitized = sanitizer(attributes);

  logger.emit({
    severityNumber: level,
    severityText: levelText,
    body: message,
    attributes: {
      ...toOtelAttributes(sanitized as Record<string, unknown>),
      ...getEnrichedLabels(),
    },
  });
}

/**
 * Shared helper for reporting errors with proper sanitization and context
 *
 * @param error - Error instance to report
 * @param context - Additional context for the error
 * @param logger - OpenTelemetry logger instance
 * @param tracer - OpenTelemetry tracer instance
 * @param sanitizer - Function to sanitize the error before reporting
 */
export function reportErrorWithInstrumentation(
  error: Error,
  context: Record<string, unknown> | undefined,
  logger: Logger,
  tracer: Tracer,
  sanitizer: (error: Error) => Error | undefined,
): void {
  const sanitizedError = sanitizer(error) ?? error;

  // Pass the scoped instrumentation to reportError
  reportError(sanitizedError, context, { logger, tracer });
}
