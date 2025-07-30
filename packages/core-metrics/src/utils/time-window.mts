/**
 * Time window aggregation utilities
 * 
 * Provides sliding and tumbling window implementations for metric aggregation.
 */

import type { MetricEvent, TimeWindow } from '../types.mjs';

/**
 * Bucket for storing events in a time window
 */
interface TimeBucket {
  startTime: number;
  endTime: number;
  events: MetricEvent[];
}

/**
 * Time window aggregator for metric events
 */
export class TimeWindowAggregator {
  private config: TimeWindow;
  private buckets: TimeBucket[] = [];
  private currentBucket: TimeBucket | null = null;

  constructor(config: TimeWindow) {
    this.config = config;
  }

  /**
   * Add an event to the time window
   */
  add(event: MetricEvent): void {
    const now = Date.now();
    
    // create first bucket if needed
    if (!this.currentBucket) {
      this.currentBucket = this.createBucket(now);
    }

    // check if we need to rotate buckets
    if (now - this.currentBucket.startTime >= this.getBucketSize()) {
      this.rotateBuckets(now);
    }

    // add event to current bucket
    this.currentBucket.events.push(event);
  }

  /**
   * Get all events in the current window
   */
  getEvents(): MetricEvent[] {
    this.cleanOldBuckets();
    
    const events: MetricEvent[] = [];
    for (const bucket of this.buckets) {
      events.push(...bucket.events);
    }
    
    if (this.currentBucket) {
      events.push(...this.currentBucket.events);
    }
    
    return events;
  }

  /**
   * Get events for a specific metric
   */
  getMetricEvents(metricName: string): MetricEvent[] {
    return this.getEvents().filter(event => event.name === metricName);
  }

  /**
   * Clear all buckets
   */
  clear(): void {
    this.buckets = [];
    this.currentBucket = null;
  }

  /**
   * Get bucket size based on configuration
   */
  private getBucketSize(): number {
    return Math.floor(this.config.size / this.config.buckets);
  }

  /**
   * Create a new time bucket
   */
  private createBucket(startTime: number): TimeBucket {
    const bucketSize = this.getBucketSize();
    return {
      startTime,
      endTime: startTime + bucketSize,
      events: []
    };
  }

  /**
   * Rotate buckets when time advances
   */
  private rotateBuckets(now: number): void {
    if (this.currentBucket) {
      this.buckets.push(this.currentBucket);
    }
    
    // create new bucket
    this.currentBucket = this.createBucket(now);
    
    // limit number of buckets
    while (this.buckets.length > this.config.buckets) {
      this.buckets.shift();
    }
    
    this.cleanOldBuckets();
  }

  /**
   * Remove buckets that are outside the time window
   */
  private cleanOldBuckets(): void {
    const now = Date.now();
    const windowStart = now - this.config.size;
    
    if (this.config.type === 'sliding') {
      // sliding window: remove events older than window
      this.buckets = this.buckets.filter(bucket => bucket.endTime > windowStart);
    } else {
      // tumbling window: keep buckets within the window
      // Only remove buckets that are older than the window size
      this.buckets = this.buckets.filter(bucket => bucket.endTime > windowStart);
    }
  }

  /**
   * Get and clear completed tumbling window
   * Returns events only if a complete window is available
   * @returns Events from the completed window, or empty array if window not complete
   */
  getCompletedWindow(): MetricEvent[] {
    if (this.config.type !== 'tumbling') {
      return this.getEvents();
    }
    
    // check if we have a complete window
    if (!this.currentBucket || Date.now() - this.currentBucket.startTime < this.config.size) {
      return [];
    }
    
    // collect all events from completed window
    const events: MetricEvent[] = [];
    for (const bucket of this.buckets) {
      events.push(...bucket.events);
    }
    if (this.currentBucket) {
      events.push(...this.currentBucket.events);
    }
    
    // clear the window
    this.buckets = [];
    this.currentBucket = null;
    
    return events;
  }

  /**
   * Get statistics for the current window
   */
  getStats(): {
    eventCount: number;
    uniqueMetrics: number;
    windowStart: number;
    windowEnd: number;
    bucketCount: number;
  } {
    const events = this.getEvents();
    const uniqueMetrics = new Set(events.map(e => e.name)).size;
    
    let windowStart = Date.now();
    let windowEnd = 0;
    
    if (this.buckets.length > 0) {
      const firstBucket = this.buckets[0];
      const lastBucket = this.buckets[this.buckets.length - 1];
      if (firstBucket) {
        windowStart = firstBucket.startTime;
      }
      if (lastBucket) {
        windowEnd = lastBucket.endTime;
      }
    }
    
    if (this.currentBucket) {
      windowEnd = Math.max(windowEnd, this.currentBucket.endTime);
    }
    
    return {
      eventCount: events.length,
      uniqueMetrics,
      windowStart,
      windowEnd,
      bucketCount: this.buckets.length + (this.currentBucket ? 1 : 0)
    };
  }
}

/**
 * Create a sliding window aggregator
 */
export function createSlidingWindow(
  sizeMs: number,
  buckets = 10
): TimeWindowAggregator {
  return new TimeWindowAggregator({
    size: sizeMs,
    buckets,
    type: 'sliding'
  });
}

/**
 * Create a tumbling window aggregator
 */
export function createTumblingWindow(
  sizeMs: number,
  buckets = 1
): TimeWindowAggregator {
  return new TimeWindowAggregator({
    size: sizeMs,
    buckets,
    type: 'tumbling'
  });
}