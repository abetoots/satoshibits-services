/**
 * Prometheus handler for cache metrics
 * Formats metrics in Prometheus exposition format
 */

import { BaseHandler, type MetricSnapshot, type MetricValue } from '@satoshibits/core-metrics';

export interface PrometheusHandlerOptions {
  prefix?: string;
  labels?: Record<string, string>;
  includeHelp?: boolean;
  includeType?: boolean;
}

/**
 * Prometheus format handler for metrics snapshots
 */
export class PrometheusHandler extends BaseHandler {
  private options: Required<PrometheusHandlerOptions>;
  private output: (text: string) => void;

  constructor(
    output: (text: string) => void = console.log,
    options: PrometheusHandlerOptions = {}
  ) {
    super('prometheus');
    this.output = output;
    this.options = {
      prefix: options.prefix ?? 'cache_',
      labels: options.labels ?? {},
      includeHelp: options.includeHelp ?? true,
      includeType: options.includeType ?? true,
    };
  }

  /**
   * Handle individual metric events (not used for Prometheus)
   */
  handle(): void {
    // prometheus handler only works with snapshots
  }

  handleSnapshot(snapshot: MetricSnapshot): void {
    if (!this.shouldHandle()) return;
    
    const metrics = snapshot.metrics;
    const prefix = this.options.prefix;
    const lines: string[] = [];
    
    // counters
    this.addCounter(lines, metrics, `${prefix}hits`, 'Total number of cache hits');
    this.addCounter(lines, metrics, `${prefix}misses`, 'Total number of cache misses');
    this.addCounter(lines, metrics, `${prefix}sets`, 'Total number of cache sets');
    this.addCounter(lines, metrics, `${prefix}deletes`, 'Total number of cache deletes');
    this.addCounter(lines, metrics, `${prefix}errors`, 'Total number of cache errors');
    this.addCounter(lines, metrics, `${prefix}stampede_prevented`, 'Total number of prevented cache stampedes');
    
    // per-operation error counters
    this.addCounter(lines, metrics, `${prefix}errors_get`, 'Total number of cache get errors');
    this.addCounter(lines, metrics, `${prefix}errors_set`, 'Total number of cache set errors');
    this.addCounter(lines, metrics, `${prefix}errors_del`, 'Total number of cache del errors');
    this.addCounter(lines, metrics, `${prefix}errors_clear`, 'Total number of cache clear errors');
    
    // gauges
    this.addGauge(lines, metrics, `${prefix}hit_rate`, 'Cache hit rate (0-1)');
    this.addGauge(lines, metrics, `${prefix}size`, 'Current cache size');
    
    // histograms - per-operation latency metrics
    this.addHistogram(lines, metrics, `${prefix}latency_get_ms`, 'Cache get operation latency in milliseconds');
    this.addHistogram(lines, metrics, `${prefix}latency_set_ms`, 'Cache set operation latency in milliseconds');
    this.addHistogram(lines, metrics, `${prefix}latency_del_ms`, 'Cache del operation latency in milliseconds');
    
    this.output(lines.join('\n'));
  }

  /**
   * Add a counter metric to the output
   */
  private addCounter(lines: string[], metrics: Map<string, MetricValue>, name: string, help: string): void {
    const value = metrics.get(name)?.value ?? 0;
    
    if (this.options.includeHelp) {
      lines.push(`# HELP ${name}_total ${help}`);
    }
    if (this.options.includeType) {
      lines.push(`# TYPE ${name}_total counter`);
    }
    
    const labelStr = this.formatLabels(this.options.labels);
    lines.push(`${name}_total${labelStr} ${value}`);
    lines.push('');
  }
  
  /**
   * Add a gauge metric to the output
   */
  private addGauge(lines: string[], metrics: Map<string, MetricValue>, name: string, help: string): void {
    const value = metrics.get(name)?.value ?? 0;
    
    if (this.options.includeHelp) {
      lines.push(`# HELP ${name} ${help}`);
    }
    if (this.options.includeType) {
      lines.push(`# TYPE ${name} gauge`);
    }
    
    const labelStr = this.formatLabels(this.options.labels);
    lines.push(`${name}${labelStr} ${value}`);
    lines.push('');
  }
  
  /**
   * Add a histogram metric to the output
   */
  private addHistogram(lines: string[], metrics: Map<string, MetricValue>, name: string, help: string): void {
    const metric = metrics.get(name);
    if (!metric?.values || metric.values.length === 0) {
      return; // no histogram data available
    }
    
    if (this.options.includeHelp) {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# HELP ${name}_bucket ${help} (histogram buckets)`);
      lines.push(`# HELP ${name}_count ${help} (total count)`);
      lines.push(`# HELP ${name}_sum ${help} (sum of all values)`);
    }
    if (this.options.includeType) {
      lines.push(`# TYPE ${name} histogram`);
    }
    
    const labelStr = this.formatLabels(this.options.labels);
    
    // calculate basic histogram stats
    const count = metric.values.length;
    const sum = metric.values.reduce((acc, val) => acc + val, 0);
    
    // output standard buckets if we have histogram data
    // for now, use some standard latency buckets in ms
    const buckets = [0.1, 0.5, 1, 5, 10, 25, 50, 100, 250, 500, 1000, Infinity];
    
    for (const bucket of buckets) {
      const bucketCount = metric.values.filter(v => v <= bucket).length;
      const bucketLabel = bucket === Infinity ? '+Inf' : bucket.toString();
      lines.push(`${name}_bucket{le="${bucketLabel}"${labelStr ? ',' + labelStr.slice(1) : ''}} ${bucketCount}`);
    }
    
    lines.push(`${name}_count${labelStr} ${count}`);
    lines.push(`${name}_sum${labelStr} ${sum}`);
    lines.push('');
  }

  /**
   * Format labels for Prometheus
   */
  private formatLabels(labels: Record<string, string>): string {
    const pairs = Object.entries(labels)
      .filter(([_, value]) => value !== undefined && value !== '')
      .map(([key, value]) => `${key}="${value}"`);
    
    return pairs.length > 0 ? `{${pairs.join(',')}}` : '';
  }
}

