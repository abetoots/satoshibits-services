/**
 * The preset with in-memory exporters, for a consumer's own tests.
 *
 * It runs the real pipeline: the same `start()`, the same processors and the
 * same wrapper in front of each exporter. Telemetry is exported as given
 * (`redaction: false`) unless the test names a policy; a test that wants to
 * see what a backend would receive passes the application's own.
 *
 * Spans and log records are handed out as exported: read-through views of the
 * SDK's records. Read their properties; do not spread, serialize or
 * deep-compare the objects themselves.
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

import {
  forceFlush,
  getStatus,
  resetForTesting,
  start,
} from "../preset/runtime.mjs";

export interface TestMetricPoint {
  attributes: Attributes;
  /** a number for sums and gauges; the histogram object for histograms */
  value: unknown;
}

export interface TestTelemetry {
  /** the status when started; call `getStatus()` for the current one */
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

  // checked first, so nothing is started and nothing needs undoing
  if (process.env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true") {
    throw new Error(
      "@satoshibits/observability/testing: telemetry is disabled; " +
        "unset OTEL_SDK_DISABLED for tests that read telemetry",
    );
  }

  const status = start({
    instrumentations: false,
    loaderHook: false,
    ...options,
    serviceName: options.serviceName ?? "test",
    // exported as given unless the test names a policy: what a test asserts on is what its code emitted
    // only when left out: anything else, `null` included, is start()'s to accept or refuse
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- `??` would read null as "left out"
    redaction: options.redaction === undefined ? false : options.redaction,
    testExporters: { spanExporter, metricExporter, logRecordExporter },
  });

  // once stopped (by stop(), or by the preset's own shutdown()) the exporters
  // are empty and flushing does nothing, so an accessor would report "nothing
  // was emitted" for any test: refuse instead
  let stopped = false;
  const live = () => {
    if (stopped || getStatus().state !== "running") {
      throw new Error(
        "@satoshibits/observability/testing: this test telemetry was stopped; start a new one",
      );
    }
  };

  const metrics = async (): Promise<MetricData[]> => {
    live();
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
      live();
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
      live();
      await forceFlush();
      return logRecordExporter.getFinishedLogRecords();
    },
    clear: () => {
      spanExporter.reset();
      metricExporter.reset();
      logRecordExporter.reset();
    },
    stop: () => {
      // a second call must not stop the telemetry a later test has started
      if (stopped) return Promise.resolve();
      stopped = true;
      return resetForTesting();
    },
  };
}
