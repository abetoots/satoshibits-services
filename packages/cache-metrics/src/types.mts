/**
 * Cache-specific type definitions extending core-metrics
 */

import type { MetricEvent, MetricSnapshot } from '@satoshibits/core-metrics';

// cache operation types
export type CacheOperation = 'get' | 'set' | 'del' | 'clear';

// cache event types - matches @satoshibits/cache event structure
export interface CacheEvent {
  type: 'hit' | 'miss' | 'set' | 'delete' | 'error' | 'stampede_prevented';
  key: string;
  timestamp: number;
  duration?: number;
  error?: Error;
  metadata?: Record<string, unknown>;
}

// cache-specific event metadata
export interface CacheMetadata {
  key: string;
  operation?: CacheOperation;
  ttl?: number;
  size?: number;
  error?: Error;
  result?: 'hit' | 'miss';
}

// extend core MetricEvent for cache-specific events
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CacheMetricEvent extends MetricEvent<CacheMetadata> {
  // cache-specific metadata is already in the metadata field
  // this interface exists for type clarity and future extensibility
}

// cache-specific snapshot with additional computed metrics
export interface CacheMetricSnapshot extends MetricSnapshot {
  cache?: {
    hitRate: number;
    missRate: number;
    errorRate: number;
    size: number;
    stampedesPrevented: number;
  };
}


// prometheus-compatible metrics format
export interface PrometheusMetrics {
  cache_hits_total: number;
  cache_misses_total: number;
  cache_sets_total: number;
  cache_deletes_total: number;
  cache_errors_total: { operation: string; value: number }[];
  cache_hit_rate: number;
  cache_error_rate: number;
  cache_latency_seconds: { operation: string; quantile: string; value: number }[];
  cache_stampede_prevented_total: number;
  cache_size_bytes: number;
}

// json export format
export interface JsonMetrics {
  timestamp: string;
  metrics: {
    operations: {
      hits: number;
      misses: number;
      sets: number;
      deletes: number;
    };
    errors: Record<CacheOperation, number>;
    performance: {
      hitRate: number;
      errorRate: number;
      latency: Record<'get' | 'set' | 'del', {
        average: number;
        samples: number;
      }>;
    };
    cache: {
      size: number;
      stampedesPrevented: number;
    };
  };
  meta: {
    startTime: string;
    duration: number;
  };
}