/**
 * @satoshibits/core-metrics
 * 
 * Zero-dependency metrics collection core for Node.js and browsers.
 * Provides the foundation for domain-specific metrics packages.
 */

// import collectors for factory functions
import { CounterCollector } from './collectors/counter.mjs';
import { GaugeCollector } from './collectors/gauge.mjs';
import { HistogramCollector } from './collectors/histogram.mjs';
import { SummaryCollector } from './collectors/summary.mjs';
import type { CollectorOptions } from './types.mjs';

// core types
export type {
  MetricEvent,
  MetricConfig,
  MetricValue,
  MetricSnapshot,
  MetricSummary,
  Percentiles,
  MetricHandler,
  CollectorEvents,
  TimeWindow,
  ExportOptions
} from './types.mjs';

export { MetricType } from './types.mjs';

// event emitter
export { EventEmitter, createEventEmitter } from './event-emitter.mjs';
export type { EventListener } from './event-emitter.mjs';

// base collector
export { BaseCollector } from './collector.mjs';
export { ThreadSafeCollector } from './thread-safe-collector.mjs';

// specific collectors
export { CounterCollector } from './collectors/counter.mjs';
export { GaugeCollector } from './collectors/gauge.mjs';
export { HistogramCollector } from './collectors/histogram.mjs';
export { SummaryCollector } from './collectors/summary.mjs';

// registry
export { MetricRegistry } from './registry.mjs';

// handlers
export {
  BaseHandler,
  FilteredHandler,
  BatchingHandler,
  HandlerChain,
  createEventHandler,
  createSnapshotHandler
} from './handlers/base.mjs';

export type { EventHandler, SnapshotHandler } from './handlers/base.mjs';

// prometheus handler
export { PrometheusHandler, createPrometheusFormatter } from './handlers/prometheus.mjs';
export type { PrometheusHandlerOptions } from './handlers/prometheus.mjs';

// json handler
export { JsonHandler, JsonHandler as JSONHandler, createJsonFormatter } from './handlers/json.mjs';
export type { JsonHandlerOptions, JsonMetrics } from './handlers/json.mjs';

// console handler
export {
  ConsoleHandler,
  createConsoleEventHandler,
  createConsoleSnapshotHandler
} from './handlers/console.mjs';
export type { ConsoleHandlerOptions } from './handlers/console.mjs';

// utility functions
export { createMetricsCollector, MetricsCollector } from './utils/factory.mjs';
export { TimeWindowAggregator } from './utils/time-window.mjs';
export { calculatePercentiles, calculateRate } from './utils/calculations.mjs';
export { Mutex, synchronized } from './utils/mutex.mjs';

// error handling
export {
  MetricsError,
  CardinalityLimitError,
  InvalidMetricConfigError,
  HandlerError,
  CollectorError,
  InvalidMetricValueError,
  ConsoleErrorHandler,
  CollectingErrorHandler
} from './errors.mjs';
export type { ErrorHandler } from './errors.mjs';

/**
 * Version information
 */
export const VERSION = '1.0.0';

/**
 * Factory functions for creating collectors
 */
export function createCounter(name: string, options?: CollectorOptions): CounterCollector {
  return new CounterCollector(name, options);
}

export function createGauge(name: string, options?: CollectorOptions): GaugeCollector {
  return new GaugeCollector(name, options);
}

export function createHistogram(name: string, options?: CollectorOptions): HistogramCollector {
  return new HistogramCollector(name, options);
}

export function createSummary(name: string, options?: CollectorOptions): SummaryCollector {
  return new SummaryCollector(name, options);
}

// re-export CollectorOptions type for factory functions
export type { CollectorOptions } from './types.mjs';