/**
 * Prometheus format handler for metrics
 * 
 * Converts metrics to Prometheus exposition format with proper escaping
 * and type annotations.
 */

import { BaseHandler } from './base.mjs';
import { MetricType } from '../types.mjs';
import type { MetricEvent, MetricSnapshot, MetricValue } from '../types.mjs';

/**
 * Options for Prometheus handler
 */
export interface PrometheusHandlerOptions {
  /** Prefix for all metric names */
  prefix?: string;
  /** Global labels to add to all metrics */
  labels?: Record<string, string>;
  /** Include HELP annotations */
  includeHelp?: boolean;
  /** Include TYPE annotations */
  includeType?: boolean;
  /** Output function for the formatted text */
  output?: (text: string) => void;
}

/**
 * Prometheus exposition format handler
 */
export class PrometheusHandler extends BaseHandler {
  private options: Required<PrometheusHandlerOptions>;
  private metricHelp = new Map<string, string>();
  private metricTypes = new Map<string, MetricType>();

  constructor(name = 'prometheus', options: PrometheusHandlerOptions = {}) {
    super(name);
    this.options = {
      prefix: options.prefix ?? '',
      labels: options.labels ?? {},
      includeHelp: options.includeHelp ?? true,
      includeType: options.includeType ?? true,
      output: options.output ?? console.log
    };
  }

  /**
   * Set help text for a metric
   */
  setHelp(metricName: string, help: string): void {
    this.metricHelp.set(metricName, help);
  }

  /**
   * Set type for a metric
   */
  setType(metricName: string, type: MetricType): void {
    this.metricTypes.set(metricName, type);
  }

  handle(_event: MetricEvent): void {
    // prometheus handler typically works with snapshots
    // individual events are not directly formatted
  }

  handleSnapshot(snapshot: MetricSnapshot): void {
    if (!this.shouldHandle()) return;

    const lines: string[] = [];
    const processedMetrics = new Map<string, string[]>();

    // group metrics by name
    snapshot.metrics.forEach((_metric, key) => {
      const parts = key.split('|');
      const name = parts[0];
      if (name) {
        if (!processedMetrics.has(name)) {
          processedMetrics.set(name, []);
        }
        processedMetrics.get(name)!.push(key);
      }
    });

    // process each metric group
    processedMetrics.forEach((keys, baseName) => {
      const metricName = this.formatMetricName(baseName);
      const firstKey = keys[0];
      if (!firstKey) return;
      
      const firstMetric = snapshot.metrics.get(firstKey);
      if (!firstMetric) return;
      
      // add help text
      if (this.options.includeHelp) {
        const help = this.metricHelp.get(baseName) ?? `${baseName} metric`;
        lines.push(`# HELP ${metricName} ${help}`);
      }

      // add type annotation
      if (this.options.includeType) {
        const type = this.metricTypes.get(baseName) ?? firstMetric.type;
        lines.push(`# TYPE ${metricName} ${this.prometheusType(type)}`);
      }

      // add metric values
      keys.forEach(key => {
        const metric = snapshot.metrics.get(key);
        if (metric) {
          const labels = { ...this.options.labels, ...metric.labels };
          lines.push(...this.formatMetric(metricName, metric, labels));
        }
      });
    });

    this.options.output(lines.join('\n'));
  }

  /**
   * Format metric name with prefix
   */
  private formatMetricName(name: string): string {
    // replace invalid characters with underscores
    const sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
    return this.options.prefix ? `${this.options.prefix}${sanitized}` : sanitized;
  }

  /**
   * Convert internal metric type to Prometheus type
   */
  private prometheusType(type: MetricType): string {
    switch (type) {
      case MetricType.Counter:
        return 'counter';
      case MetricType.Gauge:
        return 'gauge';
      case MetricType.Histogram:
        return 'histogram';
      case MetricType.Summary:
        return 'summary';
      default:
        return 'untyped';
    }
  }

  /**
   * Format a metric value with labels
   */
  private formatMetric(
    name: string,
    metric: MetricValue,
    labels: Record<string, string>
  ): string[] {
    const lines: string[] = [];
    const labelStr = this.formatLabels(labels);

    switch (metric.type) {
      case MetricType.Counter:
      case MetricType.Gauge:
        lines.push(`${name}${labelStr} ${metric.value}`);
        break;

      case MetricType.Histogram:
      case MetricType.Summary:
        if (metric.values && metric.values.length > 0) {
          const summary = this.calculateSummary(metric.values);
          
          // add quantiles
          if (summary.percentiles) {
            Object.entries(summary.percentiles).forEach(([quantile, value]) => {
              const q = quantile.replace('p', '0.');
              const quantileLabels = { ...labels, quantile: q };
              lines.push(`${name}${this.formatLabels(quantileLabels)} ${value}`);
            });
          }
          
          // add sum and count
          lines.push(`${name}_sum${labelStr} ${summary.sum}`);
          lines.push(`${name}_count${labelStr} ${summary.count}`);
        }
        break;
    }

    return lines;
  }

  /**
   * Format labels for Prometheus
   */
  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) {
      return '';
    }

    const formatted = entries
      .map(([key, value]) => `${this.escapeLabel(key)}="${this.escapeValue(value)}"`)
      .join(',');
    
    return `{${formatted}}`;
  }

  /**
   * Escape label names
   */
  private escapeLabel(label: string): string {
    // prometheus label names must match [a-zA-Z_][a-zA-Z0-9_]*
    return label.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  /**
   * Escape label values
   */
  private escapeValue(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/\f/g, '\\f')
      .replace(/\b/g, '\\b');
  }

  /**
   * Calculate summary statistics from values
   */
  private calculateSummary(values: number[]): {
    count: number;
    sum: number;
    percentiles?: Record<string, number>;
  } {
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);
    
    const percentile = (p: number): number => {
      const index = Math.ceil(sorted.length * p) - 1;
      return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
    };

    return {
      count: values.length,
      sum,
      percentiles: {
        '0.5': percentile(0.5),
        '0.9': percentile(0.9),
        '0.95': percentile(0.95),
        '0.99': percentile(0.99),
        '0.999': percentile(0.999)
      }
    };
  }
}

/**
 * Create a Prometheus formatter function
 */
export function createPrometheusFormatter(
  options?: PrometheusHandlerOptions
): (snapshot: MetricSnapshot) => string {
  let result = '';
  const handler = new PrometheusHandler('formatter', {
    ...options,
    output: (text) => { result = text; }
  });
  
  return (snapshot: MetricSnapshot): string => {
    handler.handleSnapshot(snapshot);
    return result;
  };
}