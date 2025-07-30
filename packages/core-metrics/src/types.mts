/**
 * Core type definitions for the metrics system
 * 
 * This module defines the fundamental types used throughout the metrics ecosystem.
 * All types are designed to be zero-dependency and work in both Node.js and browsers.
 */

/**
 * Generic metric event that can be extended by domain-specific packages
 */
export interface MetricEvent<T = unknown> {
  /** Type of metric event (e.g., 'counter.increment', 'gauge.set') */
  type: string;
  /** Name of the metric */
  name: string;
  /** Numeric value associated with the event */
  value: number;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Labels for categorization (e.g., { service: 'api', region: 'us-west' }) */
  labels?: Record<string, string>;
  /** Domain-specific metadata */
  metadata?: T;
}

/**
 * Types of metrics supported by the system
 */
export enum MetricType {
  /** Monotonically increasing value (e.g., request count) */
  Counter = 'counter',
  /** Value that can go up or down (e.g., active connections) */
  Gauge = 'gauge',
  /** Distribution of values (e.g., response times) */
  Histogram = 'histogram',
  /** Statistical summary with percentiles */
  Summary = 'summary'
}

/**
 * Configuration for metric collectors
 */
export interface MetricConfig {
  /** Name of the metric */
  name: string;
  /** Type of the metric */
  type?: MetricType;
  /** Default labels applied to all metrics */
  defaultLabels?: Record<string, string>;
  /** Interval for aggregation in milliseconds (default: 60000) */
  aggregationInterval?: number;
  /** Maximum size for histogram buckets (default: 1000) */
  maxHistogramSize?: number;
  /** Enable percentile calculations (default: true) */
  enablePercentiles?: boolean;
  /** Enable rate calculations (default: true) */
  enableRates?: boolean;
  /** Maximum number of unique label combinations per metric (default: 1000) */
  maxCardinality?: number;
}

/**
 * Options for creating collectors
 */
export interface CollectorOptions extends Partial<MetricConfig> {
  /** Description of the metric */
  description?: string;
  /** Unit of measurement */
  unit?: string;
}

/**
 * Single metric value with type information
 */
export interface MetricValue {
  /** Type of the metric */
  type: MetricType;
  /** Current value */
  value: number;
  /** Labels associated with this metric */
  labels: Record<string, string>;
  /** For histograms: all recorded values */
  values?: number[];
  /** For counters: previous value for rate calculation */
  previousValue?: number;
  /** Timestamp of last update */
  lastUpdated: number;
}

/**
 * Aggregated metrics snapshot
 */
export interface MetricSnapshot {
  /** Timestamp when snapshot was taken */
  timestamp: number;
  /** Map of metric names to their values */
  metrics: Map<string, MetricValue>;
  /** Global labels for this snapshot */
  labels?: Record<string, string>;
}

/**
 * Percentile values for distributions
 */
export interface Percentiles {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p999: number;
}

/**
 * Statistical summary of a metric
 */
export interface MetricSummary {
  count: number;
  sum: number;
  min: number;
  max: number;
  mean: number;
  stdDev?: number;
  percentiles?: Percentiles;
}

/**
 * Handler interface for processing metric events and snapshots
 */
export interface MetricHandler {
  /** Handle a single metric event */
  handle(event: MetricEvent): void;
  /** Handle an aggregated snapshot */
  handleSnapshot(snapshot: MetricSnapshot): void;
  /** Handler name for identification */
  name: string;
  /** Whether the handler is enabled */
  enabled: boolean;
}

/**
 * Collector events that can be listened to
 */
export interface CollectorEvents extends Record<string, unknown> {
  /** Emitted when a metric event is recorded */
  event: MetricEvent;
  /** Emitted when a snapshot is generated */
  snapshot: MetricSnapshot;
  /** Emitted when metrics are reset */
  reset: { timestamp: number };
  /** Emitted when an error occurs */
  error: { error: Error; context: string };
}

/**
 * Time window configuration for aggregation
 */
export interface TimeWindow {
  /** Window size in milliseconds */
  size: number;
  /** Number of buckets to maintain */
  buckets: number;
  /** Sliding or tumbling window */
  type: 'sliding' | 'tumbling';
}

/**
 * Export format options
 */
export interface ExportOptions {
  /** Include timestamp in export */
  includeTimestamp?: boolean;
  /** Include labels in export */
  includeLabels?: boolean;
  /** Pretty print JSON output */
  pretty?: boolean;
  /** Custom prefix for metric names */
  prefix?: string;
}

/**
 * Interface for metric collectors
 */
export interface MetricCollector {
  /** Get the collector name */
  getName(): string;
  /** Record a metric event */
  record(event: MetricEvent): void;
  /** Create a snapshot of current metrics */
  snapshot(): MetricSnapshot;
  /** Reset all metrics */
  reset(): void;
}