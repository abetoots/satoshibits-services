/**
 * Metric registry for managing multiple collectors
 */

import { EventEmitter } from './event-emitter.mjs';
import { BaseCollector } from './collector.mjs';
import type { MetricSnapshot, MetricHandler } from './types.mjs';

/**
 * Registry for managing metric collectors
 */
export class MetricRegistry extends EventEmitter {
  private collectors = new Map<string, BaseCollector>();
  private handlers = new Set<MetricHandler>();
  private snapshotTimer?: ReturnType<typeof setInterval>;
  
  constructor() {
    super();
    
    // add default error listener to prevent unhandled errors
    this.on('handler-error', (error) => {
      // default logging fallback if no other listeners are attached
      if (this.listenerCount('handler-error') === 1) {
        // only this default listener exists
        console.error('[MetricRegistry] Handler error:', error);
      }
    });
  }

  /**
   * Register a collector
   */
  register(collector: BaseCollector): void {
    const name = collector.getName();
    
    if (this.collectors.has(name)) {
      throw new Error(`Collector '${name}' is already registered`);
    }

    this.collectors.set(name, collector);
    
    // forward events from collector
    collector.on('event', (event) => {
      this.emit('metric', event);
      
      // notify handlers
      for (const handler of this.handlers) {
        try {
          handler.handle(event);
        } catch (error) {
          this.emit('handler-error', {
            handler: handler.name,
            error: error instanceof Error ? error : new Error(String(error)),
            operation: 'handle'
          });
        }
      }
    });
  }

  /**
   * Unregister a collector
   */
  unregister(name: string): boolean {
    const collector = this.collectors.get(name);
    if (!collector) return false;

    // remove all listeners
    collector.removeAllListeners();
    return this.collectors.delete(name);
  }

  /**
   * Get a collector by name
   */
  get(name: string): BaseCollector | undefined {
    return this.collectors.get(name);
  }

  /**
   * Get all collectors
   */
  getAll(): BaseCollector[] {
    return Array.from(this.collectors.values());
  }

  /**
   * Add a metric handler
   */
  addHandler(handler: MetricHandler): void {
    this.handlers.add(handler);
  }

  /**
   * Remove a metric handler
   */
  removeHandler(handler: MetricHandler): boolean {
    return this.handlers.delete(handler);
  }

  /**
   * Create a snapshot of all metrics
   */
  snapshot(): MetricSnapshot {
    const snapshot: MetricSnapshot = {
      timestamp: Date.now(),
      metrics: new Map()
    };

    // collect snapshots from all collectors
    for (const collector of this.collectors.values()) {
      const collectorSnapshot = collector.snapshot();
      
      // merge metrics
      for (const [key, value] of collectorSnapshot.metrics) {
        snapshot.metrics.set(key, value);
      }
    }

    // emit snapshot event
    this.emit('snapshot', snapshot);

    // notify handlers
    for (const handler of this.handlers) {
      if ('handleSnapshot' in handler && typeof handler.handleSnapshot === 'function') {
        try {
          handler.handleSnapshot(snapshot);
        } catch (error) {
          this.emit('handler-error', {
            handler: handler.name,
            error: error instanceof Error ? error : new Error(String(error)),
            operation: 'handleSnapshot'
          });
        }
      }
    }

    return snapshot;
  }

  /**
   * Start automatic snapshots
   */
  startSnapshotTimer(intervalMs: number): void {
    this.stopSnapshotTimer();
    
    this.snapshotTimer = setInterval(() => {
      this.snapshot();
    }, intervalMs);
  }

  /**
   * Stop automatic snapshots
   */
  stopSnapshotTimer(): void {
    if (this.snapshotTimer !== undefined) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = undefined;
    }
  }

  /**
   * Clear all collectors
   */
  clear(): void {
    // stop timer
    this.stopSnapshotTimer();

    // remove all collectors
    for (const collector of this.collectors.values()) {
      collector.removeAllListeners();
    }
    this.collectors.clear();

    // remove all handlers
    this.handlers.clear();

    // remove all registry listeners
    this.removeAllListeners();
  }

  /**
   * Get registry statistics
   */
  getStats() {
    return {
      collectors: this.collectors.size,
      handlers: this.handlers.size,
      hasTimer: this.snapshotTimer !== undefined
    };
  }
}