/**
 * Base collector implementation for metrics
 * 
 * Provides core functionality for recording metrics, managing time windows,
 * and generating snapshots. Domain-specific collectors extend this class.
 */

import { EventEmitter } from './event-emitter.mjs';
import { MetricType } from './types.mjs';
import type {
  MetricEvent,
  MetricConfig,
  MetricSnapshot,
  MetricValue,
  CollectorEvents,
  MetricSummary,
  Percentiles
} from './types.mjs';
import {
  CardinalityLimitError,
  InvalidMetricValueError
} from './errors.mjs';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Partial<MetricConfig> = {
  defaultLabels: {},
  aggregationInterval: 60000, // 1 minute
  maxHistogramSize: 1000,
  enablePercentiles: true,
  enableRates: true,
  maxCardinality: 1000
};

/**
 * Base metrics collector that can be extended by domain-specific collectors
 */
export abstract class BaseCollector extends EventEmitter<CollectorEvents> {
  protected config: MetricConfig;
  protected metrics = new Map<string, MetricValue>();
  protected labelCombinations = new Set<string>();
  protected startTime: number;
  protected lastSnapshotTime: number;
  private snapshotTimer?: ReturnType<typeof setInterval>;

  constructor(config: MetricConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = Date.now();
    this.lastSnapshotTime = this.startTime;
  }

  /**
   * Get the collector name
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * Record a metric event
   */
  record(event: MetricEvent): void {
    try {
      // validate event
      if (typeof event.value !== 'number' || !isFinite(event.value)) {
        throw new InvalidMetricValueError(
          event.name,
          event.value,
          'finite number'
        );
      }

      // apply default labels
      const labels = { ...this.config.defaultLabels, ...event.labels };
      const key = this.getMetricKey(event.name, labels);
      
      // emit the raw event
      this.emit('event', event);

      // update internal metrics based on event type
      const metricType = this.inferMetricType(event.type);
      this.updateMetric(key, event.value, metricType, labels);
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        context: 'record'
      });
    }
  }

  /**
   * Record a counter increment
   */
  increment(name: string, value = 1, labels?: Record<string, string>): void {
    this.record({
      type: 'counter.increment',
      name,
      value,
      timestamp: Date.now(),
      labels
    });
  }

  /**
   * Record a gauge value
   */
  gauge(name: string, value: number, labels?: Record<string, string>): void {
    this.record({
      type: 'gauge.set',
      name,
      value,
      timestamp: Date.now(),
      labels
    });
  }

  /**
   * Record a histogram value
   */
  histogram(name: string, value: number, labels?: Record<string, string>): void {
    this.record({
      type: 'histogram.observe',
      name,
      value,
      timestamp: Date.now(),
      labels
    });
  }

  /**
   * Generate a metrics snapshot
   */
  snapshot(): MetricSnapshot {
    const now = Date.now();
    const snapshot: MetricSnapshot = {
      timestamp: now,
      metrics: new Map(this.metrics),
      labels: this.config.defaultLabels
    };

    this.lastSnapshotTime = now;
    this.emit('snapshot', snapshot);
    
    return snapshot;
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics.clear();
    this.labelCombinations.clear();
    this.startTime = Date.now();
    this.lastSnapshotTime = this.startTime;
    this.emit('reset', { timestamp: this.startTime });
  }

  /**
   * Get cardinality statistics
   */
  getCardinalityStats() {
    return {
      current: this.labelCombinations.size,
      max: this.config.maxCardinality ?? 1000,
      percentage: (this.labelCombinations.size / (this.config.maxCardinality ?? 1000)) * 100
    };
  }

  /**
   * Start automatic snapshot generation
   */
  startSnapshotTimer(interval?: number): void {
    this.stopSnapshotTimer();
    
    const snapshotInterval = interval ?? this.config.aggregationInterval ?? 60000;
    this.snapshotTimer = setInterval(() => {
      this.snapshot();
    }, snapshotInterval);
  }

  /**
   * Stop automatic snapshot generation
   */
  stopSnapshotTimer(): void {
    if (this.snapshotTimer !== undefined) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  /**
   * Get summary statistics for a metric
   */
  getSummary(name: string, labels?: Record<string, string>): MetricSummary | undefined {
    const key = this.getMetricKey(name, labels ?? {});
    const metric = this.metrics.get(key);
    
    if (!metric?.values || metric.values.length === 0) {
      return undefined;
    }

    const values = metric.values;
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    
    const summary: MetricSummary = {
      count: values.length,
      sum,
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      mean
    };

    if (this.config.enablePercentiles && values.length > 1) {
      summary.percentiles = this.calculatePercentiles(sorted);
      
      // calculate standard deviation
      const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
      summary.stdDev = Math.sqrt(variance);
    }

    return summary;
  }

  /**
   * Get all metric names
   */
  getMetricNames(): string[] {
    const names = new Set<string>();
    this.metrics.forEach((_, key) => {
      const name = key.split('|')[0];
      if (name) {
        names.add(name);
      }
    });
    return Array.from(names);
  }

  /**
   * Update a metric value
   */
  protected updateMetric(
    key: string,
    value: number,
    type: MetricType,
    labels: Record<string, string>
  ): void {
    let metric = this.metrics.get(key);
    
    if (!metric) {
      // check cardinality limit
      const labelKey = this.getLabelKey(labels);
      if (!this.labelCombinations.has(labelKey)) {
        const maxCardinality = this.config.maxCardinality ?? 1000;
        if (this.labelCombinations.size >= maxCardinality) {
          // emit error and drop metric to prevent memory leak
          const error = new CardinalityLimitError(
            this.config.name,
            this.labelCombinations.size,
            maxCardinality
          );
          this.emit('error', { error, context: 'updateMetric' });
          return;
        }
        this.labelCombinations.add(labelKey);
      }
      
      metric = {
        type,
        value: 0,
        labels,
        lastUpdated: Date.now()
      };
      this.metrics.set(key, metric);
    }

    metric.lastUpdated = Date.now();

    switch (type) {
      case MetricType.Counter:
        metric.previousValue = metric.value;
        metric.value += value;
        break;
        
      case MetricType.Gauge:
        metric.value = value;
        break;
        
      case MetricType.Histogram:
      case MetricType.Summary:
        if (!metric.values) {
          metric.values = [];
        }
        metric.values.push(value);
        
        // limit histogram size using circular buffer logic
        if (metric.values.length > (this.config.maxHistogramSize ?? 1000)) {
          // remove oldest value more efficiently
          metric.values.shift();
        }
        
        metric.value = value; // store last value
        break;
    }
  }

  /**
   * Generate a unique key for a metric
   */
  protected getMetricKey(name: string, labels: Record<string, string>): string {
    const sortedLabels = Object.keys(labels)
      .sort()
      .map(key => `${key}="${labels[key]}"`)
      .join(',');
    
    return sortedLabels ? `${name}|${sortedLabels}` : name;
  }

  /**
   * Generate a key for label combinations
   */
  protected getLabelKey(labels: Record<string, string>): string {
    const sortedLabels = Object.keys(labels)
      .sort()
      .map(key => `${key}="${labels[key]}"`)
      .join(',');
    
    return sortedLabels || 'no-labels';
  }

  /**
   * Infer metric type from event type string
   */
  protected inferMetricType(eventType: string): MetricType {
    if (eventType.startsWith('counter.')) {
      return MetricType.Counter;
    } else if (eventType.startsWith('gauge.')) {
      return MetricType.Gauge;
    } else if (eventType.startsWith('histogram.')) {
      return MetricType.Histogram;
    } else if (eventType.startsWith('summary.')) {
      return MetricType.Summary;
    }
    
    // default to gauge for unknown types
    return MetricType.Gauge;
  }

  /**
   * Calculate percentiles from sorted array
   */
  protected calculatePercentiles(sorted: number[]): Percentiles {
    const percentile = (p: number): number => {
      const index = Math.ceil(sorted.length * p) - 1;
      return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
    };

    return {
      p50: percentile(0.5),
      p75: percentile(0.75),
      p90: percentile(0.9),
      p95: percentile(0.95),
      p99: percentile(0.99),
      p999: percentile(0.999)
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopSnapshotTimer();
    this.removeAllListeners();
    this.metrics.clear();
  }
}