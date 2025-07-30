/**
 * Counter collector for monotonically increasing values
 */

import { BaseCollector } from '../collector.mjs';
import { MetricType } from '../types.mjs';
import type { CollectorOptions, MetricEvent } from '../types.mjs';

/**
 * Counter collector for metrics that only increase
 * Examples: request count, error count, bytes processed
 */
export class CounterCollector extends BaseCollector {
  private value = 0;

  constructor(name: string, options?: CollectorOptions) {
    super({
      name,
      type: MetricType.Counter,
      ...options
    });
  }

  /**
   * Increment the counter by a given value
   * @param value Amount to increment (must be positive)
   * @param labels Optional labels for this metric
   */
  inc(value = 1, labels?: Record<string, string>): void {
    try {
      if (value < 0) {
        this.emit('error', {
          error: new Error('Counter can only be incremented by positive values'),
          context: 'counter.inc'
        });
        return;
      }

      this.value += value;
      
      const event: MetricEvent = {
        type: 'counter.increment',
        name: this.config.name,
        value: this.value,
        timestamp: Date.now(),
        labels
      };

      this.record(event);
    } catch (error) {
      this.emit('error', {
        error: error instanceof Error ? error : new Error(String(error)),
        context: 'counter.inc'
      });
    }
  }

  /**
   * Get current counter value
   */
  getValue(): number {
    return this.value;
  }

  /**
   * Reset counter to zero
   */
  reset(): void {
    this.value = 0;
    
    const event: MetricEvent = {
      type: 'counter.reset',
      name: this.config.name,
      value: 0,
      timestamp: Date.now()
    };

    this.record(event);
  }
}