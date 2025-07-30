/**
 * Gauge collector for values that can go up or down
 */

import { BaseCollector } from '../collector.mjs';
import { MetricType } from '../types.mjs';
import type { CollectorOptions, MetricEvent } from '../types.mjs';

/**
 * Gauge collector for metrics that can increase or decrease
 * Examples: memory usage, queue size, temperature, active connections
 */
export class GaugeCollector extends BaseCollector {
  private value = 0;

  constructor(name: string, options?: CollectorOptions) {
    super({
      name,
      type: MetricType.Gauge,
      ...options
    });
  }

  /**
   * Set the gauge to a specific value
   * @param value The new value
   * @param labels Optional labels for this metric
   */
  set(value: number, labels?: Record<string, string>): void {
    this.value = value;
    
    const event: MetricEvent = {
      type: 'gauge.set',
      name: this.config.name,
      value: this.value,
      timestamp: Date.now(),
      labels
    };

    this.record(event);
  }

  /**
   * Increment the gauge by a given value
   * @param value Amount to increment (can be negative)
   * @param labels Optional labels for this metric
   */
  inc(value = 1, labels?: Record<string, string>): void {
    this.value += value;
    
    const event: MetricEvent = {
      type: 'gauge.increment',
      name: this.config.name,
      value: this.value,
      timestamp: Date.now(),
      labels
    };

    this.record(event);
  }

  /**
   * Decrement the gauge by a given value
   * @param value Amount to decrement
   * @param labels Optional labels for this metric
   */
  dec(value = 1, labels?: Record<string, string>): void {
    this.inc(-value, labels);
  }

  /**
   * Get current gauge value
   */
  getValue(): number {
    return this.value;
  }

  /**
   * Set to current timestamp (useful for recording last occurrence)
   * @param labels Optional labels for this metric
   */
  setToCurrentTime(labels?: Record<string, string>): void {
    const now = Date.now();
    this.set(now / 1000, labels); // convert to seconds
  }
}