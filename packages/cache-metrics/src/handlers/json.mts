/**
 * JSON handler for cache metrics
 * Formats metrics as JSON for easy parsing and storage
 */

import { BaseHandler, type MetricSnapshot, type MetricEvent } from '@satoshibits/core-metrics';
import type { 
  JsonMetrics, 
  CacheOperation,
} from '../types.mjs';

export interface JsonHandlerOptions {
  pretty?: boolean;
  output?: (json: string) => void;
}

export class JsonHandler extends BaseHandler {
  private options: Required<JsonHandlerOptions>;

  constructor(options: JsonHandlerOptions = {}) {
    super('json');
    this.options = {
      pretty: options.pretty ?? false,
      output: options.output ?? console.log,
    };
  }

  handle(_event: MetricEvent): void {
    if (!this.shouldHandle()) return;
    // json handler only processes snapshots, not individual events
  }

  handleSnapshot(snapshot: MetricSnapshot): void {
    if (!this.shouldHandle()) return;

    const metrics = snapshot.metrics;
    const prefix = 'cache_'; // standard prefix
    
    // extract metric values
    const hits = metrics.get(`${prefix}hits`)?.value ?? 0;
    const misses = metrics.get(`${prefix}misses`)?.value ?? 0;
    const sets = metrics.get(`${prefix}sets`)?.value ?? 0;
    const deletes = metrics.get(`${prefix}deletes`)?.value ?? 0;
    const stampedePrevented = metrics.get(`${prefix}stampede_prevented`)?.value ?? 0;
    const cacheSize = metrics.get(`${prefix}size`)?.value ?? 0;
    const hitRate = metrics.get(`${prefix}hit_rate`)?.value ?? 0;
    
    // extract per-operation error counts
    const errors: Record<CacheOperation, number> = {
      get: metrics.get(`${prefix}errors_get`)?.value ?? 0,
      set: metrics.get(`${prefix}errors_set`)?.value ?? 0,
      del: metrics.get(`${prefix}errors_del`)?.value ?? 0,
      clear: metrics.get(`${prefix}errors_clear`)?.value ?? 0,
    };
    
    const totalErrors = Object.values(errors).reduce((sum, val) => sum + val, 0);
    const totalOps = hits + misses + sets + deletes;
    const errorRate = totalOps > 0 ? totalErrors / totalOps : 0;
    
    // extract per-operation latency data
    const latencyGet = metrics.get(`${prefix}latency_get_ms`);
    const latencySet = metrics.get(`${prefix}latency_set_ms`);
    const latencyDel = metrics.get(`${prefix}latency_del_ms`);
    
    const getAvg = (metric: { values?: number[] } | undefined) => 
      metric?.values && metric.values.length > 0 
        ? metric.values.reduce((a, b) => a + b, 0) / metric.values.length 
        : 0;
    const getSamples = (metric: { values?: number[] } | undefined) => metric?.values?.length ?? 0;
    
    // build JSON output
    const jsonMetrics: JsonMetrics = {
      timestamp: new Date(snapshot.timestamp).toISOString(),
      metrics: {
        operations: {
          hits,
          misses,
          sets,
          deletes,
        },
        errors,
        performance: {
          hitRate,
          errorRate,
          latency: {
            get: { average: getAvg(latencyGet), samples: getSamples(latencyGet) },
            set: { average: getAvg(latencySet), samples: getSamples(latencySet) },
            del: { average: getAvg(latencyDel), samples: getSamples(latencyDel) },
          },
        },
        cache: {
          size: cacheSize,
          stampedesPrevented: stampedePrevented,
        },
      },
      meta: {
        // note: core-metrics MetricSnapshot doesn't expose collector startTime
        // using snapshot timestamp as approximation for now
        startTime: new Date(snapshot.timestamp).toISOString(),
        duration: 60000, // default window duration assumption
      },
    };
    
    const json = this.options.pretty
      ? JSON.stringify(jsonMetrics, null, 2)
      : JSON.stringify(jsonMetrics);
    
    this.options.output(json);
  }
}

/**
 * NDJSON handler - outputs newline-delimited JSON
 */
export class NdjsonHandler extends BaseHandler {
  private output: (json: string) => void;

  constructor(output: (json: string) => void = console.log) {
    super('ndjson');
    this.output = output;
  }

  handle(event: MetricEvent): void {
    if (!this.shouldHandle()) return;

    const json = JSON.stringify({
      type: 'event',
      timestamp: event.timestamp,
      name: event.name,
      value: event.value,
      labels: event.labels,
      metadata: event.metadata,
    });
    
    this.output(json);
  }

  handleSnapshot(snapshot: MetricSnapshot): void {
    if (!this.shouldHandle()) return;

    const json = JSON.stringify({
      type: 'snapshot',
      timestamp: snapshot.timestamp,
      data: {
        metrics: Object.fromEntries(snapshot.metrics),
      },
    });
    
    this.output(json);
  }
}

