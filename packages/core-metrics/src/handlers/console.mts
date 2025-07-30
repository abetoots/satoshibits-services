/**
 * Console output handler for metrics
 * 
 * Provides human-readable output for development and debugging.
 */

import { BaseHandler } from './base.mjs';
import { MetricType } from '../types.mjs';
import type { MetricEvent, MetricSnapshot, MetricValue } from '../types.mjs';

/**
 * Options for console output
 */
export interface ConsoleHandlerOptions {
  /** Include timestamp in output */
  showTimestamp?: boolean;
  /** Include event details */
  showEventDetails?: boolean;
  /** Show summary statistics */
  showSummary?: boolean;
  /** Use colors in output (if supported) */
  useColors?: boolean;
  /** Minimum event value to display */
  minValue?: number;
  /** Custom log function */
  logger?: (...args: unknown[]) => void;
}

/**
 * Console handler for human-readable output
 */
export class ConsoleHandler extends BaseHandler {
  private options: ConsoleHandlerOptions;
  private eventCount = 0;

  constructor(name = 'console', options: ConsoleHandlerOptions = {}) {
    super(name);
    this.options = {
      showTimestamp: true,
      showEventDetails: false,
      showSummary: true,
      useColors: true,
      logger: console.log,
      ...options
    };
  }

  handle(event: MetricEvent): void {
    if (!this.shouldHandle()) return;
    
    this.eventCount++;
    
    if (this.options.showEventDetails) {
      const timestamp = this.options.showTimestamp 
        ? `[${new Date(event.timestamp).toISOString()}] `
        : '';
      
      const value = typeof event.value === 'number' 
        ? event.value.toFixed(2)
        : event.value;
      
      const labels = event.labels && Object.keys(event.labels).length > 0
        ? ` {${Object.entries(event.labels).map(([k, v]) => `${k}="${String(v)}"`).join(', ')}}`
        : '';
      
      this.log(
        `${timestamp}${event.type} ${event.name}${labels} = ${value}`
      );
    }
  }

  handleSnapshot(snapshot: MetricSnapshot): void {
    if (!this.shouldHandle()) return;

    const lines: string[] = [];
    const timestamp = new Date().toISOString();
    
    // header
    lines.push('');
    lines.push(`${'='.repeat(60)}`);
    lines.push(`Metrics Snapshot - ${timestamp}`);
    lines.push(`Events: ${this.eventCount}`);
    lines.push(`${'='.repeat(60)}`);
    
    // group metrics by type
    const byType = new Map<MetricType, [string, MetricValue][]>();
    
    snapshot.metrics.forEach((metric, key) => {
      const parts = key.split('|');
      const name = parts[0] ?? key;
      if (!byType.has(metric.type)) {
        byType.set(metric.type, []);
      }
      byType.get(metric.type)!.push([name, metric]);
    });

    // display each type
    byType.forEach((metrics, type) => {
      lines.push('');
      lines.push(`${this.formatType(type)} (${metrics.length})`);
      lines.push('-'.repeat(40));
      
      metrics
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([name, metric]) => {
          if (this.options.minValue !== undefined && metric.value < this.options.minValue) {
            return;
          }
          
          const labels = Object.keys(metric.labels).length > 0
            ? ` {${Object.entries(metric.labels).map(([k, v]) => `${k}="${String(v)}"`).join(', ')}}`
            : '';
          
          switch (type) {
            case MetricType.Counter:
            case MetricType.Gauge:
              lines.push(`  ${name}${labels}: ${metric.value.toFixed(2)}`);
              break;
              
            case MetricType.Histogram:
            case MetricType.Summary:
              if (metric.values && metric.values.length > 0 && this.options.showSummary) {
                const summary = this.calculateSummary(metric.values);
                lines.push(`  ${name}${labels}:`);
                lines.push(`    count: ${summary.count}, sum: ${summary.sum.toFixed(2)}`);
                lines.push(`    min: ${summary.min.toFixed(2)}, max: ${summary.max.toFixed(2)}, mean: ${summary.mean.toFixed(2)}`);
                if (summary.percentiles) {
                  lines.push(`    p50: ${summary.p50.toFixed(2)}, p95: ${summary.p95.toFixed(2)}, p99: ${summary.p99.toFixed(2)}`);
                }
              } else {
                lines.push(`  ${name}${labels}: ${metric.value.toFixed(2)} (last)`);
              }
              break;
          }
        });
    });
    
    lines.push('');
    this.eventCount = 0;
    
    // output all lines
    lines.forEach(line => this.log(line));
  }

  /**
   * Format metric type for display
   */
  private formatType(type: MetricType): string {
    const typeStr = type.charAt(0).toUpperCase() + type.slice(1) + 's';
    return this.options.useColors && this.supportsColor()
      ? this.colorize(typeStr, type)
      : typeStr;
  }

  /**
   * Simple color support detection
   */
  private supportsColor(): boolean {
    if (typeof process === 'undefined') return false;
    return process.stdout?.isTTY || false;
  }

  /**
   * Add color to text based on metric type
   */
  private colorize(text: string, type: MetricType): string {
    const colors: Record<MetricType, string> = {
      [MetricType.Counter]: '\x1b[32m',    // green
      [MetricType.Gauge]: '\x1b[33m',      // yellow
      [MetricType.Histogram]: '\x1b[36m',  // cyan
      [MetricType.Summary]: '\x1b[35m'     // magenta
    };
    
    const color = colors[type] || '';
    const reset = '\x1b[0m';
    
    return `${color}${text}${reset}`;
  }

  /**
   * Calculate summary statistics
   */
  private calculateSummary(values: number[]): {
    count: number;
    sum: number;
    min: number;
    max: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    percentiles: { p50: number; p95: number; p99: number };
  } {
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    
    const percentile = (p: number): number => {
      const index = Math.ceil(sorted.length * p) - 1;
      return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
    };

    return {
      count: values.length,
      sum,
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      mean,
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      percentiles: {
        p50: percentile(0.5),
        p95: percentile(0.95),
        p99: percentile(0.99)
      }
    };
  }

  /**
   * Log output
   */
  private log(...args: unknown[]): void {
    if (this.options.logger) {
      this.options.logger(...args);
    }
  }
}

/**
 * Create a simple console event handler
 */
export function createConsoleEventHandler(
  options?: ConsoleHandlerOptions
): (event: MetricEvent) => void {
  const handler = new ConsoleHandler('console-event', {
    ...options,
    showEventDetails: true
  });
  
  return (event: MetricEvent) => handler.handle(event);
}

/**
 * Create a simple console snapshot handler
 */
export function createConsoleSnapshotHandler(
  options?: ConsoleHandlerOptions
): (snapshot: MetricSnapshot) => void {
  const handler = new ConsoleHandler('console-snapshot', options);
  
  return (snapshot: MetricSnapshot) => handler.handleSnapshot(snapshot);
}