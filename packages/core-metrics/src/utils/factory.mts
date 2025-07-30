/**
 * Factory functions for creating metric collectors
 */

import { BaseCollector } from '../collector.mjs';
import type { MetricConfig, MetricEvent } from '../types.mjs';
import { ConsoleHandler } from '../handlers/console.mjs';
import { PrometheusHandler } from '../handlers/prometheus.mjs';
import { JsonHandler } from '../handlers/json.mjs';

/**
 * Simple collector implementation for general use
 */
export class MetricsCollector extends BaseCollector {
  constructor(config?: MetricConfig) {
    super(config ?? { name: 'metrics' });
  }

  /**
   * Record a custom metric event
   */
  recordCustom(event: MetricEvent): void {
    this.record(event);
  }
}

/**
 * Options for creating a metrics collector with handlers
 */
export interface CollectorFactoryOptions {
  /** Metrics configuration */
  config?: MetricConfig;
  /** Enable console output */
  enableConsole?: boolean;
  /** Enable Prometheus output */
  enablePrometheus?: boolean;
  /** Prometheus output function */
  prometheusOutput?: (text: string) => void;
  /** Enable JSON output */
  enableJson?: boolean;
  /** JSON output function */
  jsonOutput?: (json: string) => void;
  /** Snapshot interval in milliseconds */
  snapshotInterval?: number;
}

/**
 * Create a metrics collector with common handlers pre-configured
 */
export function createMetricsCollector(options?: CollectorFactoryOptions): {
  collector: MetricsCollector;
  handlers: {
    console?: ConsoleHandler;
    prometheus?: PrometheusHandler;
    json?: JsonHandler;
  };
} {
  const collector = new MetricsCollector(options?.config);
  const handlers: {
    console?: ConsoleHandler;
    prometheus?: PrometheusHandler;
    json?: JsonHandler;
  } = {};

  // add console handler
  if (options?.enableConsole !== false) {
    const consoleHandler = new ConsoleHandler();
    collector.on('snapshot', (snapshot) => consoleHandler.handleSnapshot(snapshot));
    handlers.console = consoleHandler;
  }

  // add prometheus handler
  if (options?.enablePrometheus) {
    const prometheusHandler = new PrometheusHandler('prometheus', {
      output: options.prometheusOutput
    });
    collector.on('snapshot', (snapshot) => prometheusHandler.handleSnapshot(snapshot));
    handlers.prometheus = prometheusHandler;
  }

  // add json handler
  if (options?.enableJson) {
    const jsonHandler = new JsonHandler('json', {
      output: options.jsonOutput
    });
    collector.on('snapshot', (snapshot) => jsonHandler.handleSnapshot(snapshot));
    handlers.json = jsonHandler;
  }

  // start snapshot timer if requested
  if (options?.snapshotInterval) {
    collector.startSnapshotTimer(options.snapshotInterval);
  }

  return { collector, handlers };
}