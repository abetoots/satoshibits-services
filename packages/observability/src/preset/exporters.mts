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

import { SIGNALS } from "./config.mjs";
import { createRateLimiter, isPlainShortToken } from "./diagnostics.mjs";

type EnabledSignal = Extract<SignalConfig, { enabled: true }>;

/** a persistent failure is reported once per this interval, with a count of the rest */
export const FAILURE_REPORT_INTERVAL_MILLIS = 60_000;

export interface ExporterContext {
  diagnostics: Diagnostics;
  redactor: Redactor;
  /** shown in failure reports; never the full URL, which can carry credentials */
  endpointHost?: string;
  /** where a failed export is recorded for the forceFlush or shutdown call it belongs to */
  failures?: ExportFailureLog;
}

/** one failed export, as the preset's error states it: identifiers only */
export interface ExportFailure {
  signal: Signal;
  /** the error's name when it is a short identifier, `Error` otherwise */
  error: string;
  /** the HTTP status the far end answered with */
  status?: number;
  /** the error's code (`ECONNREFUSED`, say) when it is a short identifier; never a policy's */
  code?: string;
}

const describeFailure = (failure: ExportFailure): string =>
  [
    failure.error,
    ...(failure.status !== undefined ? [`status ${failure.status}`] : []),
    ...(failure.code !== undefined ? [`code ${failure.code}`] : []),
  ].join(" ");

/**
 * What `forceFlush()` and `shutdown()` reject with when something they were
 * to send could not be sent. It names each signal that failed with the
 * failure's identifiers only: never the far end's status text or response
 * body, never an error's message, and of an error a redaction policy threw
 * only its name. The original errors are not attached, for the same reason
 * (the diagnostics line for each failure says the same, by signal).
 */
export class TelemetryExportError extends Error {
  readonly failures: readonly ExportFailure[];
  constructor(failures: readonly ExportFailure[]) {
    const bySignal = SIGNALS.flatMap((signal) => {
      const described = [
        ...new Set(failures.filter((f) => f.signal === signal).map(describeFailure)),
      ];
      return described.length > 0 ? [`${signal}: ${described.join(", ")}`] : [];
    });
    super(`@satoshibits/observability: telemetry could not be delivered (${bySignal.join("; ")})`);
    this.name = "TelemetryExportError";
    this.failures = failures;
  }
}

/** errors a redaction policy threw: of these only the name is ever stated */
const thrownByPolicy = new WeakSet<object>();

/** run the policy; what it throws is marked as its own and thrown on */
function byPolicy<T>(redact: () => T): T {
  try {
    return redact();
  } catch (error) {
    if (typeof error === "object" && error !== null) thrownByPolicy.add(error);
    throw error;
  }
}

/** a failed export's identifiers; anything that cannot be read, or is not an identifier, is left out */
export function exportFailure(signal: Signal, error: unknown): ExportFailure {
  const read = (key: "code"): unknown => {
    try {
      return (error as Record<string, unknown> | null | undefined)?.[key];
    } catch {
      return undefined;
    }
  };
  const name = nameOf(error);
  const code = read("code");
  const fromPolicy = typeof error === "object" && error !== null && thrownByPolicy.has(error);
  return {
    signal,
    error: isPlainShortToken(name) ? name : "Error",
    // the upstream OTLP exporters' error carries the HTTP status as a numeric code
    ...(!fromPolicy &&
      typeof code === "number" &&
      Number.isInteger(code) &&
      code >= 100 &&
      code <= 599 && { status: code }),
    ...(!fromPolicy && typeof code === "string" && isPlainShortToken(code) && { code }),
  };
}

/**
 * Failed exports, by the `forceFlush()` or `shutdown()` call they belong to.
 *
 * The batch span processor rejects a flush whose export failed, but the
 * batch log record processor and the periodic metric reader only hand the
 * failure to the global error handler and resolve. Every export passes
 * through the wrapper, which sees every result, so the wrapper records
 * failures here and the call reads them, whatever the processor does.
 *
 * A failure belongs to the calls that are running when it arrives, whoever
 * began the export: a flush waits for what was already in flight, and that
 * is part of what it was asked to deliver. One that arrived before the call
 * began is not the call's: it was reported when it failed, and a call is not
 * failed by what went wrong before it was made (a processor that rejects a
 * flush for it, as the simple processors do while it is still pending, is
 * heard through its rejection).
 */
export class ExportFailureLog {
  readonly #open = new Set<[unknown, ExportFailure][]>();

  /**
   * collect the failures that arrive from now until `close()`, by the error
   * the processor was handed (so a processor's rejection with that same
   * error is not counted twice)
   */
  open(): { failures: [unknown, ExportFailure][]; close: () => void } {
    const failures: [unknown, ExportFailure][] = [];
    this.#open.add(failures);
    return { failures, close: () => this.#open.delete(failures) };
  }

  /** a failed export: recorded for every call running now */
  record(error: unknown, failure: ExportFailure): void {
    for (const failures of this.#open) failures.push([error, failure]);
  }
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
export function nameOf(error: unknown): string {
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
      try {
        context.failures?.record(result.error, exportFailure(signal, result.error));
      } catch {
        // nor may recording it for the call that is waiting
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
          byPolicy(() => spans.map((span) => viewOf<ReadableSpan>(span, redactor.span(span)))),
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
          byPolicy(() => ({
            ...metrics,
            scopeMetrics: metrics.scopeMetrics.map((scopeMetrics) => ({
              ...scopeMetrics,
              scope: redactor.scope(scopeMetrics.scope),
            })),
          })),
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
          byPolicy(() =>
            records.map((record) =>
              viewOf<ReadableLogRecord>(record, redactor.logRecord(record)),
            ),
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
