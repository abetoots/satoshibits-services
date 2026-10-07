/**
 * Exporters, and the wrapper every exporter sits behind.
 *
 * The wrapper does two things at the one point all telemetry passes on its
 * way out:
 *
 * - it hands the real exporter redacted views of the records (originals are
 *   never mutated, so another exporter on the same pipeline is unaffected);
 * - it reports a failed export through diagnostics, naming the signal and the
 *   HTTP status or network error code. The SDK's own error path names
 *   neither, and says nothing at all unless a diagnostics logger is installed.
 */

import { ExportResultCode } from "@opentelemetry/core";
import { OTLPLogExporter as JsonLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPLogExporter as ProtoLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter as JsonMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPMetricExporter as ProtoMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter as JsonTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as ProtoTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

import type { Signal, SignalConfig } from "./config.mjs";
import type { Diagnostics } from "./diagnostics.mjs";
import type { Redactor } from "./redaction.mjs";
import type { ExportResult } from "@opentelemetry/core";
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from "@opentelemetry/sdk-logs";
import type {
  PushMetricExporter,
  ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";

import { createRateLimiter } from "./diagnostics.mjs";

type EnabledSignal = Extract<SignalConfig, { enabled: true }>;

/** a persistent failure is reported once per this interval, with a count of the rest */
export const FAILURE_REPORT_INTERVAL_MILLIS = 60_000;

export interface ExporterContext {
  diagnostics: Diagnostics;
  redactor: Redactor;
  /** shown in failure reports; never the full URL, which can carry credentials */
  endpointHost?: string;
  failureReportIntervalMillis?: number;
}

/** the host and port of an endpoint, for status and diagnostics */
export function hostOf(url: string): string {
  return new URL(url).host;
}

function failureReporter(signal: Signal, context: ExporterContext) {
  const limit = createRateLimiter(
    context.failureReportIntervalMillis ?? FAILURE_REPORT_INTERVAL_MILLIS,
  );
  return (error: unknown) => {
    limit((suppressed) => {
      const detail = (error ?? {}) as { name?: unknown; code?: unknown };
      context.diagnostics.report({
        level: "error",
        message: `${signal} export failed`,
        // the error's message is left out on purpose: it is free text from the far end
        fields: {
          signal,
          // an HTTP status for a rejected request, a code such as ECONNREFUSED otherwise
          ...(typeof detail.code === "number" && { status: detail.code }),
          ...(typeof detail.code === "string" && { code: detail.code }),
          error: typeof detail.name === "string" ? detail.name : "Error",
          ...(context.endpointHost !== undefined && {
            endpoint: context.endpointHost,
          }),
          ...(suppressed > 0 && { suppressed }),
        },
      });
    });
  };
}

function observing(
  report: (error: unknown) => void,
  resultCallback: (result: ExportResult) => void,
): (result: ExportResult) => void {
  return (result) => {
    if (result.code !== ExportResultCode.SUCCESS) report(result.error);
    resultCallback(result);
  };
}

/**
 * A view of `record` with some properties replaced. Everything else,
 * methods included, is read through to the original.
 */
function viewOf<T extends object>(record: T, replaced: Partial<T>): T {
  const descriptors: PropertyDescriptorMap = {};
  for (const [key, value] of Object.entries(replaced)) {
    descriptors[key] = { value, enumerable: true };
  }
  return Object.create(record, descriptors) as T;
}

export function wrapSpanExporter(
  inner: SpanExporter,
  context: ExporterContext,
): SpanExporter {
  const report = failureReporter("traces", context);
  const { redactor } = context;
  return {
    export: (spans: ReadableSpan[], resultCallback) => {
      inner.export(
        spans.map((span) =>
          viewOf(span, {
            instrumentationScope: redactor.scope(span.instrumentationScope),
          }),
        ),
        observing(report, resultCallback),
      );
    },
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush?.() ?? Promise.resolve(),
  };
}

export function wrapMetricExporter(
  inner: PushMetricExporter,
  context: ExporterContext,
): PushMetricExporter {
  const report = failureReporter("metrics", context);
  const { redactor } = context;
  return {
    export: (metrics: ResourceMetrics, resultCallback) => {
      inner.export(
        {
          ...metrics,
          scopeMetrics: metrics.scopeMetrics.map((scopeMetrics) => ({
            ...scopeMetrics,
            scope: redactor.scope(scopeMetrics.scope),
          })),
        },
        observing(report, resultCallback),
      );
    },
    forceFlush: () => inner.forceFlush(),
    shutdown: () => inner.shutdown(),
    // the reader asks the exporter for these; without them the exporter's own
    // temporality and aggregation preferences would be lost
    ...(inner.selectAggregationTemporality && {
      selectAggregationTemporality: (type) =>
        inner.selectAggregationTemporality!(type),
    }),
    ...(inner.selectAggregation && {
      selectAggregation: (type) => inner.selectAggregation!(type),
    }),
  };
}

export function wrapLogRecordExporter(
  inner: LogRecordExporter,
  context: ExporterContext,
): LogRecordExporter {
  const report = failureReporter("logs", context);
  const { redactor } = context;
  return {
    export: (records: ReadableLogRecord[], resultCallback) => {
      inner.export(
        records.map((record) =>
          viewOf(record, {
            instrumentationScope: redactor.scope(record.instrumentationScope),
          }),
        ),
        observing(report, resultCallback),
      );
    },
    shutdown: () => inner.shutdown(),
    forceFlush: () => inner.forceFlush(),
  };
}

interface OtlpOptions {
  url: string;
  headers?: Record<string, string>;
}

/**
 * The upstream exporters read the timeout, compression, certificate and
 * header variables themselves; only what the preset resolved is passed.
 */
const otlpOptions = (
  signal: EnabledSignal,
  headers: Record<string, string> | undefined,
): OtlpOptions => ({
  url: signal.url,
  ...(headers !== undefined && { headers }),
});

export function createSpanExporter(
  signal: EnabledSignal,
  headers: Record<string, string> | undefined,
): SpanExporter {
  const options = otlpOptions(signal, headers);
  return signal.protocol === "http/json"
    ? new JsonTraceExporter(options)
    : new ProtoTraceExporter(options);
}

export function createMetricExporter(
  signal: EnabledSignal,
  headers: Record<string, string> | undefined,
): PushMetricExporter {
  const options = otlpOptions(signal, headers);
  return signal.protocol === "http/json"
    ? new JsonMetricExporter(options)
    : new ProtoMetricExporter(options);
}

export function createLogRecordExporter(
  signal: EnabledSignal,
  headers: Record<string, string> | undefined,
): LogRecordExporter {
  const options = otlpOptions(signal, headers);
  return signal.protocol === "http/json"
    ? new JsonLogExporter(options)
    : new ProtoLogExporter(options);
}
