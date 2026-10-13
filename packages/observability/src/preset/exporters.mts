/**
 * Exporters, and the wrapper every exporter sits behind.
 *
 * The wrapper does two things at the one point all telemetry passes on its
 * way out:
 *
 * - it hands the real exporter views of the records as the named policy left them (originals are
 *   never mutated, so another exporter on the same pipeline is unaffected);
 * - it reports a failed export through diagnostics, naming the signal and the
 *   HTTP status or network error code. The SDK's own error path names
 *   neither, and says nothing at all unless a diagnostics logger is installed.
 */

import { types } from "node:util";

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
}

/** the host and port of an endpoint, for status and diagnostics */
export function hostOf(url: string): string {
  return new URL(url).host;
}

/**
 * Errors this module has reported, by signal. The SDK hands the same error
 * objects to its global error handler, which skips these so one failure is
 * not reported twice (and skips nothing else).
 */
const reported = new WeakSet<object>();

export const wasReportedByExporter = (error: unknown): boolean =>
  typeof error === "object" && error !== null && reported.has(error);

/** a reason this module can state itself, from the SDK's own fixed error texts */
function localReason(message: unknown): string | undefined {
  if (typeof message !== "string") return undefined;
  if (/timed? ?out/i.test(message)) return "timeout";
  return undefined;
}

function failureReporter(signal: Signal, context: ExporterContext) {
  const limit = createRateLimiter(FAILURE_REPORT_INTERVAL_MILLIS);
  return (error: unknown) => {
    // marked whether or not the line below is let through by the limit
    if (typeof error === "object" && error !== null) reported.add(error);
    // read before the limit is consulted: an error that cannot be read must
    // not use up the interval's one line and then print nothing
    const detail: { name?: unknown; code?: unknown; message?: unknown } = {};
    for (const key of ["name", "code", "message"] as const) {
      try {
        detail[key] = (error as typeof detail | null | undefined)?.[key];
      } catch {
        // what cannot be read is left out; the rest is still reported
      }
    }
    limit((suppressed) => {
      const reason = localReason(detail.message);
      context.diagnostics.report({
        level: "error",
        message: `${signal} export failed`,
        // the error's message is left out on purpose: it is free text from the far end
        fields: {
          signal,
          // an HTTP status for a rejected request, a code such as ECONNREFUSED otherwise;
          // neither when the exporter gave up after retrying (a 429 or 503 that never cleared)
          ...(typeof detail.code === "number" && { status: detail.code }),
          ...(typeof detail.code === "string" && { code: detail.code }),
          error: typeof detail.name === "string" ? detail.name : "Error",
          // a request that timed out carries neither status nor code
          ...(reason !== undefined && { reason }),
          ...(context.endpointHost !== undefined && {
            endpoint: context.endpointHost,
          }),
          ...(suppressed > 0 && { suppressed }),
        },
      });
    });
  };
}

/**
 * The error of a failed export. Anything that is not an `Error` (a string
 * from the far end, an object that cannot be printed) is replaced by one with
 * a fixed text: its content is never read, so it can neither leak nor throw.
 */
const asError = (value: unknown): Error =>
  // not `instanceof`: that walks the prototype chain, which a proxy can make throw
  // (and it would not know an error from another realm)
  types.isNativeError(value)
    ? value
    : new Error(
        value === undefined || value === null
          ? "export failed"
          : "export failed with a value that is not an error",
      );

/** an error's name for a report; `Error` when it has none that can be read as text */
function nameOf(error: unknown): string {
  try {
    const name = types.isNativeError(error) ? (error.name as unknown) : undefined;
    return typeof name === "string" ? name : "Error";
  } catch {
    return "Error";
  }
}

/**
 * What this guards against is an exporter that fails in the ways code fails:
 * it throws, rejects, answers twice, late, with nothing or with something
 * that is not a result, and the values involved are whatever they are. It is
 * not a defence against an object built to subvert the language itself (a
 * promise whose `constructor` throws when read, for which no handler can be
 * attached at all).
 *
 * The answer is the result callback. A returned promise that fulfils is not
 * taken for one: an exporter that neither calls back nor rejects is left to
 * the processor that called (its export timeout, where it has one).
 *
 * Run one export. A throw from the policy or from the exporter itself is
 * reported like any failed export and answered with a failed result, so the
 * processor that called is never left waiting and never sees an exception.
 */
function guarded(
  signal: Signal,
  context: ExporterContext,
  report: (error: unknown) => void,
  resultCallback: (result: ExportResult) => void,
  send: (observed: (result: ExportResult) => void) => unknown,
): void {
  // exactly one answer per export, and one report for it: an exporter that
  // answers and then throws, or answers twice, is heard the first time only
  let settled = false;
  const once = (given: ExportResult | undefined) => {
    if (settled) return;
    settled = true;
    // an answer that is no result at all is a failed export
    // the answer is read once, here, and the processor is handed a result of the wrapper's
    // own making: what the exporter passed may read differently, or throw, a second time
    let result: ExportResult;
    try {
      result =
        given?.code === ExportResultCode.SUCCESS
          ? { code: ExportResultCode.SUCCESS }
          : // a failure always carries an error, so the processor passes this (marked)
            // object on to the SDK's error handler and not one of its own
            { code: ExportResultCode.FAILED, error: asError(given?.error) };
    } catch {
      // an answer that cannot even be read
      result = { code: ExportResultCode.FAILED, error: asError(undefined) };
    }
    if (result.error !== undefined) {
      try {
        report(result.error);
      } catch {
        // reporting must never keep the answer from the processor
      }
    }
    try {
      resultCallback(result);
    } catch (error) {
      // the processor's own callback threw. Whoever answered (the exporter,
      // possibly later and from its own promise chain) must not get that back.
      try {
        context.diagnostics.report({
          level: "error",
          message: `${signal} export result could not be handed back`,
          fields: { signal, error: nameOf(error) },
        });
      } catch {
        // nor may reporting it
      }
    }
  };
  const failed = (error: unknown) => {
    // a failure after the answer is not looked at at all
    if (settled) return;
    once({ code: ExportResultCode.FAILED, error: asError(error) });
  };
  try {
    // `export` returns nothing, but an exporter written as an async function returns a
    // promise (or something like one, from another realm or a promise library)
    const returned = send(once) as { then?: unknown } | null | undefined;
    // read once: what is called is what was examined
    const then: unknown = returned?.then;
    if (typeof then === "function") {
      // a fulfilment says nothing here (the answer comes through the callback), but a
      // hand-written thenable may call its first argument without checking it is one
      (then as (this: unknown, onFulfilled: () => void, onRejected: typeof failed) => unknown).call(
        returned,
        () => undefined,
        failed,
      );
    }
  } catch (error) {
    failed(error);
  }
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
      guarded("traces", context, report, resultCallback, (observed) => {
        return inner.export(
          spans.map((span) =>
            viewOf(span, {
              instrumentationScope: redactor.scope(span.instrumentationScope),
            }),
          ),
          observed,
        );
      });
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
      guarded("metrics", context, report, resultCallback, (observed) => {
        return inner.export(
          {
            ...metrics,
            scopeMetrics: metrics.scopeMetrics.map((scopeMetrics) => ({
              ...scopeMetrics,
              scope: redactor.scope(scopeMetrics.scope),
            })),
          },
          observed,
        );
      });
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
      guarded("logs", context, report, resultCallback, (observed) => {
        return inner.export(
          records.map((record) =>
            viewOf(record, {
              instrumentationScope: redactor.scope(record.instrumentationScope),
            }),
          ),
          observed,
        );
      });
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

const ENDPOINT_VARIABLES = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
] as const;

/**
 * The upstream exporters parse the endpoint variables themselves when they
 * are constructed, although the URL is passed to them, and warn with the
 * value quoted when their own parse fails where the preset's did not (an
 * endpoint with a trailing space, say). An endpoint can carry credentials,
 * so the variables are hidden for the duration of the (synchronous)
 * constructor call; the URL the preset resolved is the only one there is.
 */
function withoutEndpointVariables<T>(construct: () => T): T {
  const hidden = ENDPOINT_VARIABLES.flatMap((name) => {
    const value = process.env[name];
    if (value === undefined) return [];
    delete process.env[name];
    return [[name, value] as const];
  });
  try {
    return construct();
  } finally {
    for (const [name, value] of hidden) process.env[name] = value;
  }
}

export function createSpanExporter(
  signal: EnabledSignal,
  headers: Record<string, string> | undefined,
): SpanExporter {
  const options = otlpOptions(signal, headers);
  return withoutEndpointVariables(() =>
    signal.protocol === "http/json"
      ? new JsonTraceExporter(options)
      : new ProtoTraceExporter(options),
  );
}

export function createMetricExporter(
  signal: EnabledSignal,
  headers: Record<string, string> | undefined,
): PushMetricExporter {
  const options = otlpOptions(signal, headers);
  return withoutEndpointVariables(() =>
    signal.protocol === "http/json"
      ? new JsonMetricExporter(options)
      : new ProtoMetricExporter(options),
  );
}

export function createLogRecordExporter(
  signal: EnabledSignal,
  headers: Record<string, string> | undefined,
): LogRecordExporter {
  const options = otlpOptions(signal, headers);
  return withoutEndpointVariables(() =>
    signal.protocol === "http/json"
      ? new JsonLogExporter(options)
      : new ProtoLogExporter(options),
  );
}
