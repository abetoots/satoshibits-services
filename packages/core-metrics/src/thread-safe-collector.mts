/**
 * Thread-safe collector implementation
 * 
 * Provides mutex-protected operations to prevent race conditions
 * in concurrent environments.
 */

import { BaseCollector } from './collector.mjs';
import { Mutex } from './utils/mutex.mjs';
import type { MetricEvent, MetricSnapshot, MetricSummary } from './types.mjs';

/**
 * Thread-safe metrics collector that prevents race conditions
 */
export abstract class ThreadSafeCollector extends BaseCollector {
  private mutex = new Mutex();
  private snapshotMutex = new Mutex();
  private snapshotTimerId?: ReturnType<typeof setTimeout>;

  /**
   * Record a metric event with thread safety
   */
  async recordSafe(event: MetricEvent): Promise<void> {
    await this.mutex.withLock(() => {
      this.record(event);
    });
  }

  /**
   * Generate a metrics snapshot with thread safety
   */
  async snapshotSafe(): Promise<MetricSnapshot> {
    return this.snapshotMutex.withLock(() => {
      return this.snapshot();
    });
  }

  /**
   * Reset all metrics with thread safety
   */
  async resetSafe(): Promise<void> {
    await this.mutex.withLock(() => {
      this.reset();
    });
  }

  /**
   * Get summary statistics with thread safety
   */
  async getSummarySafe(name: string, labels?: Record<string, string>): Promise<MetricSummary | undefined> {
    return this.mutex.withLock(() => {
      return this.getSummary(name, labels);
    });
  }

  /**
   * Increment counter with thread safety
   */
  async incrementSafe(name: string, value = 1, labels?: Record<string, string>): Promise<void> {
    await this.mutex.withLock(() => {
      this.increment(name, value, labels);
    });
  }

  /**
   * Set gauge with thread safety
   */
  async gaugeSafe(name: string, value: number, labels?: Record<string, string>): Promise<void> {
    await this.mutex.withLock(() => {
      this.gauge(name, value, labels);
    });
  }

  /**
   * Record histogram value with thread safety
   */
  async histogramSafe(name: string, value: number, labels?: Record<string, string>): Promise<void> {
    await this.mutex.withLock(() => {
      this.histogram(name, value, labels);
    });
  }

  /**
   * Start automatic snapshot generation with proper cleanup
   */
  startSnapshotTimer(interval?: number): void {
    this.stopSnapshotTimer();
    
    const snapshotInterval = interval ?? this.config.aggregationInterval ?? 60000;
    
    // use async interval to prevent overlapping snapshots
    const asyncInterval = async () => {
      try {
        await this.snapshotSafe();
      } catch (error) {
        this.emit('error', {
          error: error instanceof Error ? error : new Error(String(error)),
          context: 'snapshot-timer'
        });
      }
    };

    // create a proper async interval
    const scheduleNext = () => {
      this.snapshotTimerId = setTimeout(() => {
        void (async () => {
          await asyncInterval();
          scheduleNext();
        })();
      }, snapshotInterval);
    };

    scheduleNext();
  }

  /**
   * Stop automatic snapshot generation
   */
  stopSnapshotTimer(): void {
    if (this.snapshotTimerId !== undefined) {
      clearTimeout(this.snapshotTimerId);
      this.snapshotTimerId = undefined;
    }
  }
}