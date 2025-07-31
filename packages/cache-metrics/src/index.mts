/**
 * @satoshibits/cache-metrics - Cache performance monitoring with core-metrics
 * 
 * This package provides cache-specific metrics collection built on top of
 * the zero-dependency @satoshibits/core-metrics package.
 */

// main cache collector
export { CacheCollector } from './cache-collector.mjs';
export type { CacheCollectorOptions } from './cache-collector.mjs';

// types
export type {
  CacheOperation,
  CacheMetadata,
  CacheMetricEvent,
  CacheMetricSnapshot,
  PrometheusMetrics,
  JsonMetrics,
} from './types.mjs';

// handlers
export { PrometheusHandler } from './handlers/prometheus.mjs';
export type { PrometheusHandlerOptions } from './handlers/prometheus.mjs';

export { JsonHandler, NdjsonHandler } from './handlers/json.mjs';
export type { JsonHandlerOptions } from './handlers/json.mjs';

export { ConsoleHandler } from './handlers/console.mjs';
export type { ConsoleHandlerOptions } from './handlers/console.mjs';

// re-export useful types from core-metrics
export type {
  MetricEvent,
  MetricSnapshot,
  MetricValue,
  MetricHandler as CoreMetricHandler,
} from '@satoshibits/core-metrics';

