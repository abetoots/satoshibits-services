/**
 * The preset with in-memory exporters, for a consumer's own tests.
 *
 * It runs the real pipeline: the same `start()`, the same processors and the
 * same redacting wrapper in front of each exporter. A test therefore sees
 * what a backend would receive, not what the code handed to the API.
 *
 * The `OTEL_*` variables of the test process still apply (a sampler
 * variable, for instance). `OTEL_SDK_DISABLED=true` makes this throw: a test
 * that asks for telemetry must not pass on none.
 */

import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";

import type { PresetStatus, StartOptions } from "../preset/runtime.mjs";
import type { Attributes } from "@opentelemetry/api";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import type { MetricData } from "@opentelemetry/sdk-metrics";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";

import { forceFlush, resetForTesting, start } from "../preset/runtime.mjs";

export interface TestMetricPoint {
  attributes: Attributes;
  /** a number for sums and gauges; the histogram object for histograms */
  value: unknown;
}

export interface TestTelemetry {
  status: PresetStatus;
  /** finished spans, as exported */
  spans: () => Promise<ReadableSpan[]>;
  /** the metrics of the latest collection, as exported */
  metrics: () => Promise<MetricData[]>;
  /** the data points of one metric in the latest collection */
  metricPoints: (name: string) => Promise<TestMetricPoint[]>;
  /** emitted log records, as exported */
  logRecords: () => Promise<ReadableLogRecord[]>;
  /** forget what was collected so far */
  clear: () => void;
  /** stop telemetry and clear the API's global registrations, so another test can start it again */
  stop: () => Promise<void>;
}

/**
 * Start the preset with in-memory exporters for all three signals. No
 * instrumentation and no loader hook unless asked for: a test runner has
 * loaders of its own.
 */
export function startTestTelemetry(
  options: Omit<StartOptions, "testExporters"> = {},
): TestTelemetry {
  const spanExporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  const logRecordExporter = new InMemoryLogRecordExporter();

  const status = start({
    serviceName: "test",
    instrumentations: false,
    loaderHook: false,
    ...options,
    testExporters: { spanExporter, metricExporter, logRecordExporter },
  });
  if (status.state !== "running") {
    // forget the disabled start, so it does not block the next test's
    void resetForTesting();
    throw new Error(
      `@satoshibits/observability/testing: telemetry is ${status.state}; ` +
        "unset OTEL_SDK_DISABLED for tests that read telemetry",
    );
  }

  const metrics = async (): Promise<MetricData[]> => {
    metricExporter.reset();
    await forceFlush();
    return metricExporter
      .getMetrics()
      .flatMap((collection) => collection.scopeMetrics)
      .flatMap((scope) => scope.metrics);
  };

  return {
    status,
    spans: async () => {
      await forceFlush();
      return spanExporter.getFinishedSpans();
    },
    metrics,
    metricPoints: async (name) =>
      (await metrics())
        .filter((metric) => metric.descriptor.name === name)
        .flatMap((metric) => metric.dataPoints as TestMetricPoint[])
        .map(({ attributes, value }) => ({ attributes, value })),
    logRecords: async () => {
      await forceFlush();
      return logRecordExporter.getFinishedLogRecords();
    },
    clear: () => {
      spanExporter.reset();
      metricExporter.reset();
      logRecordExporter.reset();
    },
    stop: resetForTesting,
  };
}
