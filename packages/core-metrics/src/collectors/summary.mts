/**
 * Summary collector for calculating quantiles over a sliding time window
 */

import { BaseCollector } from '../collector.mjs';
import { MetricType } from '../types.mjs';
import type { CollectorOptions, MetricEvent } from '../types.mjs';
// import { calculatePercentiles } from '../utils/calculations.mjs';

interface SummaryOptions extends CollectorOptions {
  /** Time window in milliseconds (default: 10 minutes) */
  windowMs?: number;
  /** Maximum age of observations in milliseconds */
  maxAgeMs?: number;
  /** Quantiles to calculate (default: [0.5, 0.9, 0.95, 0.99]) */
  quantiles?: number[];
}

interface TimestampedValue {
  value: number;
  timestamp: number;
}

/**
 * Summary collector for calculating quantiles over sliding time windows
 * Examples: API response times, processing durations
 */
export class SummaryCollector extends BaseCollector {
  private observations: TimestampedValue[] = [];
  private windowMs: number;
  private maxAgeMs: number;
  private quantiles: number[];

  constructor(name: string, options?: SummaryOptions) {
    super({
      name,
      type: MetricType.Summary,
      ...options
    });

    this.windowMs = options?.windowMs ?? 10 * 60 * 1000; // 10 minutes
    this.maxAgeMs = options?.maxAgeMs ?? this.windowMs;
    this.quantiles = options?.quantiles ?? [0.5, 0.9, 0.95, 0.99];
  }

  /**
   * Observe a value
   * @param value The value to observe
   * @param labels Optional labels for this metric
   */
  observe(value: number, labels?: Record<string, string>): void {
    const now = Date.now();
    
    // add new observation
    this.observations.push({ value, timestamp: now });

    // clean old observations
    this.cleanOldObservations(now);

    const event: MetricEvent = {
      type: 'summary.observe',
      name: this.config.name,
      value,
      timestamp: now,
      labels
    };

    this.record(event);
  }

  /**
   * Remove observations outside the time window
   */
  private cleanOldObservations(now: number): void {
    const cutoff = now - this.maxAgeMs;
    
    // find first observation within window
    let firstValidIndex = 0;
    for (let i = 0; i < this.observations.length; i++) {
      if (this.observations[i]!.timestamp >= cutoff) {
        firstValidIndex = i;
        break;
      }
    }

    // remove old observations
    if (firstValidIndex > 0) {
      this.observations = this.observations.slice(firstValidIndex);
    }
  }

  /**
   * Get summary statistics
   */
  getStats() {
    // clean before calculating
    this.cleanOldObservations(Date.now());

    if (this.observations.length === 0) {
      return {
        count: 0,
        sum: 0,
        quantiles: this.quantiles.reduce((acc, q) => {
          acc[q] = 0;
          return acc;
        }, {} as Record<number, number>)
      };
    }

    const values = this.observations.map(o => o.value);
    const sorted = values.sort((a, b) => a - b);
    const windowedSum = values.reduce((acc, val) => acc + val, 0);
    const windowedCount = values.length;
    
    // calculate requested quantiles
    const quantileValues: Record<number, number> = {};
    for (const q of this.quantiles) {
      const index = Math.ceil(sorted.length * q) - 1;
      quantileValues[q] = sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
    }

    return {
      count: windowedCount,
      sum: windowedSum,
      quantiles: quantileValues
    };
  }

  /**
   * Get Prometheus-style quantiles
   */
  getQuantiles(): { quantile: number; value: number }[] {
    const stats = this.getStats();
    
    return Object.entries(stats.quantiles).map(([q, value]) => ({
      quantile: parseFloat(q),
      value
    }));
  }

  /**
   * Reset the summary
   */
  reset(): void {
    this.observations = [];

    const event: MetricEvent = {
      type: 'summary.reset',
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