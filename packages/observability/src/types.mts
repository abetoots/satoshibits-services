/**
 * Type mappings from old metrics system to OpenTelemetry
 * 
 * This file provides compatibility types and mappings for migrating
 * from the custom metrics implementation to OpenTelemetry SDK
 */

import type { 
  Attributes,
  SpanStatusCode 
} from '@opentelemetry/api';
import type { LogAttributes, SeverityNumber } from '@opentelemetry/api-logs';

// Re-export error types from functional-errors package
export type { ErrorType, ErrorContext } from '@satoshibits/functional-errors';

// Label types - map to OpenTelemetry Attributes
export type LabelSet = Record<string, string | number | boolean>;

// Metric event types for adapters
export interface MetricEvent {
  name: string;
  type: 'increment' | 'record' | 'set';
  value: number;
  labels?: LabelSet;
  timestamp?: Date;
}

// Collector types - these map to OpenTelemetry instruments
export interface CollectorOptions {
  name: string;
  help?: string;
  unit?: string;
  labelNames?: string[];
}

// Percentiles type for calculations
export interface Percentiles {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
}

// ============================================================================
// Testing & Recording Types - Canonical definitions for mock clients
// ============================================================================

/**
 * NOTE ON ATTRIBUTES TYPE:
 * 
 * The public API accepts `Record<string, unknown>` instead of OTel's `Attributes`
 * for better developer experience:
 * 
 * 1. No OTel imports needed in user code
 * 2. More flexible - accepts any object without strict typing
 * 3. Internal implementation handles conversion to OTel types
 * 
 * However, for storage in our testing types, we use OTel's Attributes
 * to ensure consistency with what actually gets sent to backends.
 */

/**
 * Recorded metric for testing - captures metric emissions
 * Note: We use our own type/name/value structure for testing purposes
 * but store with OTel's Attributes type for backend consistency
 */
export interface RecordedMetric {
  type: 'increment' | 'decrement' | 'record' | 'gauge';
  name: string;
  value: number;
  attributes?: Attributes;  // Stored as OTel's Attributes type
  timestamp: number;
}

/**
 * Recorded span for testing - captures span lifecycle
 * Note: status uses string values for easier testing, but maps to SpanStatusCode
 */
export interface RecordedSpan {
  name: string;
  attributes?: Attributes;  // Using OTel's Attributes type
  status?: 'OK' | 'ERROR' | 'UNSET';  // Maps to SpanStatusCode values
  error?: Error;
  duration?: number;
  timestamp: number;
  traceId?: string;
  spanId?: string; 
  parentSpanId?: string;
}

/**
 * Log severity levels aligned with OpenTelemetry
 * Maps to SeverityNumber but uses string for easier testing
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Recorded log entry for testing
 */
export interface RecordedLog {
  level: LogLevel;
  message: string;
  attributes?: LogAttributes;  // Using OTel's LogAttributes type
  error?: Error;
  timestamp: number;
}

/**
 * Recorded error for testing - our own concept for error tracking
 */
export interface RecordedError {
  error: Error;
  context?: Attributes;  // Using OTel's Attributes for consistency
  timestamp: number;
}

/**
 * Breadcrumb for tracking user journey - Sentry-like concept, not OTel
 * This is our own domain concept for tracking user actions
 */
export interface Breadcrumb {
  timestamp: number;
  category: 'navigation' | 'action' | 'console' | 'error' | 'http' | 'info';
  message: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  data?: Record<string, unknown>;
}

/**
 * Recorded breadcrumb for testing
 */
export interface RecordedBreadcrumb {
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Recorded tag for testing
 */
export interface RecordedTag {
  key: string;
  value: string | number | boolean;  // Aligned with OTel AttributeValue
  timestamp: number;
}

// Re-export OTel types for convenience
export type { Attributes, SpanStatusCode, LogAttributes, SeverityNumber };

