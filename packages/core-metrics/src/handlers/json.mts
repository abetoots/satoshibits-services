/**
 * JSON format handler for metrics
 * 
 * Outputs metrics in a structured JSON format suitable for ingestion
 * by various monitoring systems.
 */

import { BaseHandler } from './base.mjs';
import type { MetricEvent, MetricSnapshot, ExportOptions } from '../types.mjs';

/**
 * JSON output format for metrics
 */
export interface JsonMetrics {
  timestamp: number;
  events?: MetricEvent[];
  metrics: {
    name: string;
    type: string;
    value: number;
    labels?: Record<string, string>;
    summary?: {
      count: number;
      sum: number;
      min: number;
      max: number;
      mean: number;
      stdDev?: number;
      percentiles?: Record<string, number>;
    };
  }[];
}

/**
 * Options for JSON handler
 */
export interface JsonHandlerOptions extends ExportOptions {
  /** Output function for the formatted JSON */
  output?: (json: string) => void;
  /** Include raw event data */
  includeRawEvents?: boolean;
}

/**
 * JSON format handler for metrics
 */
export class JsonHandler extends BaseHandler {
  private options: JsonHandlerOptions;
  private events: MetricEvent[] = [];

  constructor(name = 'json', options: JsonHandlerOptions = {}) {
    super(name);
    this.options = {
      includeTimestamp: true,
      includeLabels: true,
      pretty: false,
      includeRawEvents: false,
      ...options
    };
  }

  handle(event: MetricEvent): void {
    if (!this.shouldHandle()) return;
    
    if (this.options.includeRawEvents) {
      this.events.push(event);
    }
  }

  handleSnapshot(snapshot: MetricSnapshot): void {
    if (!this.shouldHandle()) return;

    const json = this.formatSnapshot(snapshot);
    const output = this.options.pretty 
      ? JSON.stringify(json, null, 2)
      : JSON.stringify(json);
    
    if (this.options.output) {
      this.options.output(output);
    } else {
      console.log(output);
    }

    // clear events after snapshot
    if (this.options.includeRawEvents) {
      this.events = [];
    }
  }

  /**
   * Format snapshot as JSON
   */
  private formatSnapshot(snapshot: MetricSnapshot): JsonMetrics {
    const metrics: JsonMetrics['metrics'] = [];

    snapshot.metrics.forEach((metric, key) => {
      const parts = key.split('|');
      const name = parts[0] ?? key;
      const prefixedName = this.options.prefix ? `${this.options.prefix}${name}` : name;
      
      const jsonMetric: JsonMetrics['metrics'][0] = {
        name: prefixedName,
        type: metric.type,
        value: metric.value
      };

      if (this.options.includeLabels && Object.keys(metric.labels).length > 0) {
        jsonMetric.labels = metric.labels;
      }

      // add summary for histograms
      if (metric.values && metric.values.length > 0) {
        const sorted = [...metric.values].sort((a, b) => a - b);
        const sum = metric.values.reduce((a, b) => a + b, 0);
        const mean = sum / metric.values.length;
        
        const summary = {
          count: metric.values.length,
          sum,
          min: sorted[0] ?? 0,
          max: sorted[sorted.length - 1] ?? 0,
          mean,
          stdDev: undefined as number | undefined,
          percentiles: undefined as Record<string, number> | undefined
        };

        // calculate standard deviation
        if (metric.values.length > 1) {
          const variance = metric.values.reduce(
            (acc, val) => acc + Math.pow(val - mean, 2), 0
          ) / metric.values.length;
          summary.stdDev = Math.sqrt(variance);
        }

        // calculate percentiles
        if (metric.values.length > 0) {
          summary.percentiles = {
            p50: this.percentile(sorted, 0.5),
            p75: this.percentile(sorted, 0.75),
            p90: this.percentile(sorted, 0.9),
            p95: this.percentile(sorted, 0.95),
            p99: this.percentile(sorted, 0.99),
            p999: this.percentile(sorted, 0.999)
          };
        }

        jsonMetric.summary = summary;
      }

      metrics.push(jsonMetric);
    });

    const result: JsonMetrics = {
      timestamp: snapshot.timestamp,
      metrics
    };

    if (this.options.includeTimestamp) {
      result.timestamp = Date.now();
    }

    // include raw events if requested
    if (this.options.includeRawEvents && this.events.length > 0) {
      return {
        ...result,
        events: this.events
      };
    }

    return result;
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
  }
}

/**
 * Create a JSON formatter function
 */
export function createJsonFormatter(
  options?: JsonHandlerOptions
): (snapshot: MetricSnapshot) => string {
  let result = '';
  const handler = new JsonHandler('formatter', {
    ...options,
    output: (json) => { result = json; }
  });
  
  return (snapshot: MetricSnapshot): string => {
    handler.handleSnapshot(snapshot);
    return result;
  };
}