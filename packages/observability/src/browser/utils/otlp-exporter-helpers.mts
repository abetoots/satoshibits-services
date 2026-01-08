/**
 * OTLP Exporter Helpers
 *
 * Shared utilities for browser OTLP exporters (spans, metrics, logs).
 * Extracted from FetchSpanExporter, FetchMetricExporter, and FetchLogExporter
 * to eliminate code duplication (~150 lines) and provide single point of maintenance.
 *
 * @module browser/utils/otlp-exporter-helpers
 */

import type { HrTime } from "@opentelemetry/api";

// ============================================================================
// Types
// ============================================================================

/**
 * OTLP attribute value structure matching the OTLP proto format.
 */
export interface OtlpAttributeValue {
  stringValue?: string;
  intValue?: number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values: OtlpAttributeValue[] };
}

/**
 * OTLP key-value pair for attributes.
 */
export interface OtlpKeyValue {
  key: string;
  value: OtlpAttributeValue;
}

/**
 * Options for sending OTLP data.
 */
export interface SendOtlpDataOptions<T> {
  /** Target endpoint URL */
  url: string;
  /** JSON-stringified payload */
  body: string;
  /** HTTP headers (Content-Type should be included) */
  headers: Record<string, string>;
  /** Use sendBeacon for same-origin when available (default: false) */
  useBeacon?: boolean;
  /** Maximum payload size for sendBeacon (default: 65536) */
  maxBeaconBytes?: number;
  /** Label for debug logging (e.g., "spans", "metrics", "logs") */
  debugLabel?: string;
  /** Override window origin for cross-origin detection (useful for testing) */
  windowOrigin?: string;
  /** Called on successful send - returns exporter-specific result */
  onSuccess: () => T;
  /** Called on failure - receives Error instance, returns exporter-specific result */
  onError: (error: Error) => T;
}

// ============================================================================
// Time Conversion
// ============================================================================

/**
 * Converts OpenTelemetry HrTime to nanoseconds string for OTLP export.
 *
 * @param hrTime - High-resolution time tuple [seconds, nanoseconds] or undefined
 * @returns Nanoseconds as string (BigInt-safe for large values)
 *
 * @example
 * hrTimeToNanos([1234567890, 123456789]) // "1234567890123456789"
 * hrTimeToNanos(undefined) // "0"
 */
export function hrTimeToNanos(hrTime: HrTime | undefined): string {
  if (hrTime === undefined) return "0";
  const [seconds, nanos] = hrTime;
  return (BigInt(seconds) * BigInt(1e9) + BigInt(nanos)).toString();
}

// ============================================================================
// Attribute Conversion
// ============================================================================

/**
 * Converts a single attribute value to OTLP format.
 *
 * @param value - Any attribute value
 * @returns OTLP-formatted value object with appropriate type field
 *
 * @example
 * convertAttributeValue("hello") // { stringValue: "hello" }
 * convertAttributeValue(42) // { intValue: 42 }
 * convertAttributeValue(3.14) // { doubleValue: 3.14 }
 * convertAttributeValue(true) // { boolValue: true }
 */
export function convertAttributeValue(value: unknown): OtlpAttributeValue {
  if (typeof value === "string") {
    return { stringValue: value };
  }
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { intValue: value }
      : { doubleValue: value };
  }
  if (typeof value === "boolean") {
    return { boolValue: value };
  }
  // OTLP spec: arrays should use arrayValue with nested values
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(convertAttributeValue) } };
  }
  // fallback: stringify other types (objects, null, undefined)
  return { stringValue: String(value) };
}

/**
 * Converts attributes record to OTLP KeyValue array.
 *
 * @param attrs - Record of attribute key-value pairs
 * @returns Array of OTLP KeyValue objects
 *
 * @example
 * convertAttributes({ service: "api", count: 5 })
 * // [{ key: "service", value: { stringValue: "api" }}, { key: "count", value: { intValue: 5 }}]
 */
export function convertAttributes(
  attrs: Record<string, unknown>,
): OtlpKeyValue[] {
  return Object.entries(attrs).map(([key, value]) => ({
    key,
    value: convertAttributeValue(value),
  }));
}

// ============================================================================
// Cross-Origin Detection
// ============================================================================

/**
 * Detects if an endpoint is cross-origin (for CORS/sendBeacon decisions).
 *
 * Used to determine whether to use fetch (handles CORS preflight) or sendBeacon.
 * sendBeacon with application/json content-type triggers CORS preflight for
 * cross-origin requests, which it cannot handle.
 *
 * @param endpoint - The target URL
 * @param windowOrigin - Optional origin override for testing (avoids window dependency)
 * @returns true if endpoint is cross-origin, false otherwise
 *
 * @example
 * isCrossOrigin("/v1/traces") // false (relative URL)
 * isCrossOrigin("//other.com/api") // true (protocol-relative)
 * isCrossOrigin("https://other.com/api") // true (different host)
 * isCrossOrigin("https://same.com/api", "https://same.com") // false
 */
export function isCrossOrigin(
  endpoint: string,
  windowOrigin?: string,
): boolean {
  // determine origin: prefer explicit param, then window, then undefined (SSR)
  const origin =
    windowOrigin ??
    (typeof window !== "undefined" ? window.location.origin : undefined);

  // SSR safety - if no origin can be determined, assume same-origin
  if (!origin) {
    return false;
  }

  try {
    // protocol-relative URLs (//host.com/path) are cross-origin
    if (endpoint.startsWith("//")) {
      return true;
    }
    // relative URLs are same-origin (but not protocol-relative)
    if (endpoint.startsWith("/")) {
      return false;
    }

    const url = new URL(endpoint, origin);
    return url.origin !== origin;
  } catch {
    // if URL parsing fails, assume same-origin (relative path)
    return false;
  }
}

// ============================================================================
// Data Transmission
// ============================================================================

/**
 * Sends OTLP JSON payload via fetch or sendBeacon.
 *
 * Transport selection logic:
 * 1. If cross-origin OR custom auth headers → use fetch with keepalive (handles CORS)
 * 2. If same-origin, no auth headers, useBeacon=true, small payload → use sendBeacon
 * 3. Otherwise → use fetch with keepalive
 *
 * Error handling:
 * - Network failures: onError receives TypeError from fetch
 * - HTTP errors: onError receives Error with message "HTTP {status}"
 * - Beacon failures: onError receives Error with message "sendBeacon failed"
 *
 * @param options - Send configuration including callbacks for result mapping
 * @returns T for synchronous paths (sendBeacon), Promise<T> for async paths (fetch)
 *
 * @example
 * // Span exporter usage
 * sendOtlpData({
 *   url: this.endpoint,
 *   body: JSON.stringify(payload),
 *   headers: this.headers,
 *   debugLabel: "spans",
 *   onSuccess: () => ({ code: 0 }),
 *   onError: () => ({ code: 1 }),
 * });
 *
 * // Metric exporter usage with callback-style
 * sendOtlpData({
 *   url: this.endpoint,
 *   body: data,
 *   headers: this.headers,
 *   debugLabel: "metrics",
 *   onSuccess: () => resultCallback({ code: ExportResultCode.SUCCESS }),
 *   onError: () => resultCallback({ code: ExportResultCode.FAILED }),
 * });
 */
export function sendOtlpData<T>(
  options: SendOtlpDataOptions<T>,
): T | Promise<T> {
  const {
    url,
    body,
    headers,
    useBeacon = false,
    maxBeaconBytes = 65536,
    debugLabel = "telemetry",
    windowOrigin,
    onSuccess,
    onError,
  } = options;

  // check for custom auth headers (anything other than Content-Type)
  const hasCustomAuthHeaders = Object.keys(headers).some(
    (key) => key.toLowerCase() !== "content-type",
  );
  const crossOrigin = isCrossOrigin(url, windowOrigin);

  // doc 4 H2 fix: prefer fetch for cross-origin (CORS preflight) or custom headers
  if (typeof fetch !== "undefined" && (hasCustomAuthHeaders || crossOrigin)) {
    return fetch(url, {
      method: "POST",
      headers,
      body,
      keepalive: true,
    })
      .then((response) =>
        response.ok
          ? onSuccess()
          : onError(new Error(`HTTP ${response.status}`)),
      )
      .catch((err) => onError(err instanceof Error ? err : new Error(String(err))));
  }

  // sendBeacon for same-origin, no custom headers, small payloads
  // doc 4 H2 fix: same-origin sendBeacon can use application/json
  if (
    useBeacon &&
    typeof navigator !== "undefined" &&
    navigator.sendBeacon
  ) {
    // use Blob.size for accurate byte length (handles multi-byte UTF-8 chars)
    const blob = new Blob([body], { type: "application/json" });
    if (blob.size >= maxBeaconBytes) {
      // payload too large for sendBeacon, fall through to fetch
    } else {
      const success = navigator.sendBeacon(url, blob);
      // sendBeacon is fire-and-forget, return result synchronously
      if (success) {
        return onSuccess();
      }
      return onError(new Error("sendBeacon failed"));
    }
  }

  // fallback to fetch
  if (typeof fetch !== "undefined") {
    return fetch(url, {
      method: "POST",
      headers,
      body,
      keepalive: true,
    })
      .then((response) =>
        response.ok
          ? onSuccess()
          : onError(new Error(`HTTP ${response.status}`)),
      )
      .catch((err) => onError(err instanceof Error ? err : new Error(String(err))));
  }

  // no transport available - this is an error, not silent success
  console.error(
    `[${debugLabel}] No transport available (fetch/sendBeacon). Data not sent.`,
  );
  return onError(new Error("No transport available (fetch/sendBeacon)"));
}
