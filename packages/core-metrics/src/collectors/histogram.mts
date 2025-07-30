/**
 * Histogram collector for observing value distributions
 */

import { BaseCollector } from '../collector.mjs';
import { MetricType } from '../types.mjs';
import type { CollectorOptions, MetricEvent } from '../types.mjs';
import { calculatePercentiles } from '../utils/calculations.mjs';

interface HistogramOptions extends CollectorOptions {
  /** Maximum number of observations to keep (default: 1000) */
  maxObservations?: number;
  /** Histogram buckets for value ranges */
  buckets?: number[];
}

/**
 * Histogram collector for observing distributions of values
 * Examples: request latency, response size, processing time
 */
export class HistogramCollector extends BaseCollector {
  private observations: number[] = [];
  private maxObservations: number;
  private buckets?: number[];

  constructor(name: string, options?: HistogramOptions) {
    super({
      name,
      type: MetricType.Histogram,
      ...options
    });

    this.maxObservations = options?.maxObservations ?? 1000;
    this.buckets = options?.buckets;
  }

  /**
   * Observe a value
   * @param value The value to observe
   * @param labels Optional labels for this metric
   */
  observe(value: number, labels?: Record<string, string>): void {
    // add to observations with size limit
    this.observations.push(value);
    if (this.observations.length > this.maxObservations) {
      // remove oldest observation to prevent unbounded growth
      this.observations.shift();
    }

    const event: MetricEvent = {
      type: 'histogram.observe',
      name: this.config.name,
      value,
      timestamp: Date.now(),
      labels
    };

    this.record(event);
  }

  /**
   * Get histogram statistics
   */
  getStats() {
    if (this.observations.length === 0) {
      return {
        count: 0,
        sum: 0,
        mean: 0,
        min: 0,
        max: 0,
        percentiles: calculatePercentiles([])
      };
    }

    const sorted = [...this.observations].sort((a, b) => a - b);
    const windowedSum = sorted.reduce((acc, val) => acc + val, 0);
    const windowedCount = sorted.length;
    
    return {
      count: windowedCount,
      sum: windowedSum,
      mean: windowedCount > 0 ? windowedSum / windowedCount : 0,
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      percentiles: calculatePercentiles(sorted)
    };
  }

  /**
   * Get bucket counts if buckets are configured
   */
  getBucketCounts(): { le: number; count: number }[] | undefined {
    if (!this.buckets) return undefined;

    // sort observations once for efficient bucket counting
    const sorted = [...this.observations].sort((a, b) => a - b);
    const counts: { le: number; count: number }[] = [];
    let currentIndex = 0;

    // count values for each bucket efficiently
    for (const bucket of this.buckets) {
      while (currentIndex < sorted.length && sorted[currentIndex]! <= bucket) {
        currentIndex++;
      }
      counts.push({
        le: bucket,
        count: currentIndex
      });
    }

    // add +Inf bucket
    counts.push({
      le: Infinity,
      count: sorted.length
    });

    return counts;
  }

  /**
   * Reset the histogram
   */
  reset(): void {
    this.observations = [];

    const event: MetricEvent = {
      type: 'histogram.reset',
      name: this.config.name,
      value: 0,
      timestamp: Date.now()
    };

    this.record(event);
  }

  /**
   * Start a timer and return a function to observe the duration
   * @param labels Optional labels for this metric
   */
  startTimer(labels?: Record<string, string>): () => void {
    const start = Date.now();
    
    return () => {
      const duration = (Date.now() - start) / 1000; // convert to seconds
      this.observe(duration, labels);
    };
  }
}