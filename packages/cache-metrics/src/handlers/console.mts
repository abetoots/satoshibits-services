/**
 * Console handler for cache metrics
 * Provides colorized console output for development and debugging
 */

import { BaseHandler, type MetricSnapshot, type MetricEvent } from '@satoshibits/core-metrics';
import type { CacheOperation } from '../types.mjs';

export interface ConsoleHandlerOptions {
  colors?: boolean;
  timestamp?: boolean;
  logLevel?: 'event' | 'snapshot' | 'both';
  prefix?: string;
  formatNumbers?: boolean;
}

/**
 * Unified console handler for both events and snapshots
 */
export class ConsoleHandler extends BaseHandler {
  private options: Required<ConsoleHandlerOptions>;
  private colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
  };

  constructor(options: ConsoleHandlerOptions = {}) {
    super('console');
    this.options = {
      colors: options.colors ?? true,
      timestamp: options.timestamp ?? true,
      logLevel: options.logLevel ?? 'both',
      prefix: options.prefix ?? '[Cache]',
      formatNumbers: options.formatNumbers ?? true,
    };
  }

  handle(event: MetricEvent): void {
    if (!this.shouldHandle()) return;
    if (this.options.logLevel === 'snapshot') return;

    const timestamp = this.options.timestamp
      ? `[${new Date(event.timestamp).toISOString()}] `
      : '';
    
    const color = this.getEventColor(event.type);
    const prefix = this.options.colors ? color : '';
    const suffix = this.options.colors ? this.colors.reset : '';
    
    const metadata = event.metadata as { key?: string; error?: Error } | undefined;
    const key = metadata?.key ?? '';
    const latency = event.value ? ` (${event.value.toFixed(2)}ms)` : '';
    
    console.log(`${prefix}${timestamp}${this.options.prefix} ${event.type}: ${key}${latency}${suffix}`);
  }

  handleSnapshot(snapshot: MetricSnapshot): void {
    if (!this.shouldHandle()) return;
    if (this.options.logLevel === 'event') return;

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
    
    const avgLatency = {
      get: getAvg(latencyGet),
      set: getAvg(latencySet),
      del: getAvg(latencyDel),
    };
    
    this.logSnapshot({
      hits,
      misses,
      sets,
      deletes,
      errors,
      stampedePrevented,
      cacheSize,
      hitRate,
      errorRate,
      averageLatency: avgLatency,
      timestamp: snapshot.timestamp,
    });
  }

  /**
   * Log metrics snapshot to console
   */
  private logSnapshot(data: {
    hits: number;
    misses: number;
    sets: number;
    deletes: number;
    errors: Record<CacheOperation, number>;
    stampedePrevented: number;
    cacheSize: number;
    hitRate: number;
    errorRate: number;
    averageLatency: { get: number; set: number; del: number };
    timestamp: number;
  }): void {
    const timestamp = this.options.timestamp
      ? `[${new Date(data.timestamp).toISOString()}] `
      : '';

    console.log(`\n${timestamp}=== Cache Metrics Snapshot ===`);
    
    // operations
    console.log(`Operations:`);
    console.log(`  Hits: ${this.colorNumber(data.hits, 'green')}`);
    console.log(`  Misses: ${this.colorNumber(data.misses, 'yellow')}`);
    console.log(`  Sets: ${this.colorNumber(data.sets, 'cyan')}`);
    console.log(`  Deletes: ${this.colorNumber(data.deletes, 'magenta')}`);
    
    // rates
    console.log(`Rates:`);
    console.log(`  Hit Rate: ${this.colorPercent(data.hitRate)}`);
    console.log(`  Error Rate: ${this.colorPercent(data.errorRate, true)}`);
    
    // errors
    const totalErrors = Object.values(data.errors).reduce((sum, val) => sum + val, 0);
    if (totalErrors > 0) {
      console.log(`Errors:`);
      Object.entries(data.errors).forEach(([op, count]) => {
        if (count > 0) {
          console.log(`  ${op}: ${this.colorNumber(count, 'red')}`);
        }
      });
    }
    
    // latency
    if (data.averageLatency.get > 0 || data.averageLatency.set > 0 || data.averageLatency.del > 0) {
      console.log(`Average Latency:`);
      if (data.averageLatency.get > 0) console.log(`  GET: ${this.colorLatency(data.averageLatency.get)}`);
      if (data.averageLatency.set > 0) console.log(`  SET: ${this.colorLatency(data.averageLatency.set)}`);
      if (data.averageLatency.del > 0) console.log(`  DEL: ${this.colorLatency(data.averageLatency.del)}`);
    }
    
    // cache info
    console.log(`Cache Info:`);
    console.log(`  Size: ${this.colorNumber(data.cacheSize, 'dim')}`);
    console.log(`  Stampedes Prevented: ${this.colorNumber(data.stampedePrevented, 'green')}`);
    
    console.log('==============================\n');
  }

  /**
   * Get color for event type
   */
  private getEventColor(type: string): string {
    if (type.includes('hit')) return this.colors.green;
    if (type.includes('miss')) return this.colors.yellow;
    if (type.includes('error')) return this.colors.red;
    if (type.includes('set')) return this.colors.cyan;
    if (type.includes('delete')) return this.colors.magenta;
    return this.colors.dim;
  }

  /**
   * Color a number based on its value
   */
  private colorNumber(value: number, color: keyof typeof this.colors): string {
    if (!this.options.colors) return value.toLocaleString();
    
    const formatted = this.options.formatNumbers ? value.toLocaleString() : value.toString();
    return `${this.colors[color]}${formatted}${this.colors.reset}`;
  }

  /**
   * Color a percentage value
   */
  private colorPercent(value: number, inverse = false): string {
    const percent = (value * 100).toFixed(2) + '%';
    if (!this.options.colors) return percent;
    
    let color: string;
    if (inverse) {
      // for error rate, lower is better
      color = value < 0.01 ? this.colors.green :
              value < 0.05 ? this.colors.yellow :
              this.colors.red;
    } else {
      // for hit rate, higher is better
      color = value > 0.9 ? this.colors.green :
              value > 0.7 ? this.colors.yellow :
              this.colors.red;
    }
    
    return `${color}${percent}${this.colors.reset}`;
  }

  /**
   * Color latency value
   */
  private colorLatency(ms: number): string {
    const formatted = `${ms.toFixed(2)}ms`;
    if (!this.options.colors) return formatted;
    
    const color = ms < 1 ? this.colors.green :
                  ms < 10 ? this.colors.yellow :
                  this.colors.red;
    
    return `${color}${formatted}${this.colors.reset}`;
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

