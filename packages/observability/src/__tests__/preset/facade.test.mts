/**
 * The deprecated 1.x facade over the preset, in-process: the runtime's
 * injection point for the facade's test hooks, how a failure behind an
 * injected reader is reported, and the facade attaching to a runtime that is
 * already there. What leaves the process is asserted in
 * subprocess/facade.test.mts.
 */

import { metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { ExportResultCode } from "@opentelemetry/core";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
// the 1.x span processor, as a 1.x consumer passes it
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { standardPolicy } from "@satoshibits/redaction";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiagnosticsEvent } from "../../preset/diagnostics.mjs";
import type { OtlpSink } from "../../testing/otlp-sink.mjs";
import type { PushMetricExporter } from "@opentelemetry/sdk-metrics";

import { forceFlush, getStatus, start } from "../../preset.mjs";
import { resetForTesting, startWithTestHooks } from "../../preset/runtime.mjs";
import { SmartClient } from "../../index.mjs";
import { startTestTelemetry } from "../../testing/in-memory.mjs";
import { startOtlpSink } from "../../testing/otlp-sink.mjs";

let sink: OtlpSink | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.resolve()
    .then(() => SmartClient.shutdown())
    .catch(() => undefined);
  await resetForTesting();
  await sink?.close();
  sink = undefined;
});

/** the preset's options as the facade passes them, less what a test adds */
const BASE = {
  serviceName: "facade-test",
  redaction: standardPolicy,
  instrumentations: false,
  loaderHook: false,
} as const;

/** every telemetry variable a deployment would set, pointed at a sink that must stay empty */
async function exportingEnvironment(): Promise<OtlpSink> {
  sink = await startOtlpSink();
  vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", sink.url);
  vi.stubEnv("OTEL_TRACES_EXPORTER", "otlp");
  vi.stubEnv("OTEL_METRICS_EXPORTER", "otlp");
  vi.stubEnv("OTEL_LOGS_EXPORTER", "otlp");
  return sink;
}

function emitOneOfEach(spanName = "facade-span"): void {
  trace.getTracer("facade-test").startSpan(spanName).end();
  metrics.getMeter("facade-test").createCounter("facade_counter").add(1);
  logs.getLogger("facade-test").emit({ body: "facade-line" });
}

const failingMetricExporter = (): PushMetricExporter => ({
  export: (_metrics, resultCallback) => {
    resultCallback({ code: ExportResultCode.FAILED, error: new Error("refused by the far end") });
  },
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
});

const errorsOf = (events: DiagnosticsEvent[]) => events.filter((event) => event.level === "error");

describe("the runtime's injection point for test hooks", () => {
  it("an injected span processor gets the spans; every other signal is off, whatever the variables say", async () => {
    const network = await exportingEnvironment();
    const exporter = new InMemorySpanExporter();

    const status = startWithTestHooks(BASE, { spanProcessor: new SimpleSpanProcessor(exporter) });

    expect(status.signals).toEqual({
      traces: { enabled: true, destination: "test" },
      metrics: { enabled: false, reason: "test-hooks" },
      logs: { enabled: false, reason: "test-hooks" },
    });
    emitOneOfEach();
    await forceFlush();
    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(["facade-span"]);
    expect(network.connections).toEqual([]);
  });

  it("an injected metric reader gets the metrics; every other signal is off, whatever the variables say", async () => {
    const network = await exportingEnvironment();
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 2 ** 31 - 1 });

    const status = startWithTestHooks(BASE, { metricReader: reader });

    expect(status.signals).toEqual({
      traces: { enabled: false, reason: "test-hooks" },
      metrics: { enabled: true, destination: "test" },
      logs: { enabled: false, reason: "test-hooks" },
    });
    emitOneOfEach();
    await forceFlush();
    const names = exporter
      .getMetrics()
      .flatMap((collection) => collection.scopeMetrics)
      .flatMap((scope) => scope.metrics.map((metric) => metric.descriptor.name));
    expect(names).toContain("facade_counter");
    expect(network.connections).toEqual([]);
  });

  it("with no hook given, every signal is off, whatever the variables say", async () => {
    const network = await exportingEnvironment();

    const status = startWithTestHooks(BASE, {});

    expect(status.signals).toEqual({
      traces: { enabled: false, reason: "test-hooks" },
      metrics: { enabled: false, reason: "test-hooks" },
      logs: { enabled: false, reason: "test-hooks" },
    });
    emitOneOfEach();
    await forceFlush();
    expect(network.connections).toEqual([]);
  });

  it("hands an injected processor the span as the application made it: the hook is the consumer's, not an exporter", async () => {
    const exporter = new InMemorySpanExporter();
    startWithTestHooks(BASE, { spanProcessor: new SimpleSpanProcessor(exporter) });

    emitOneOfEach("lookup for jane.doe@example.com");
    await forceFlush();

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
      "lookup for jane.doe@example.com",
    ]);
  });
});

describe("a failed export behind a metric reader", () => {
  it("is reported once when the reader is injected with an exporter the preset did not wrap", async () => {
    const events: DiagnosticsEvent[] = [];
    const reader = new PeriodicExportingMetricReader({
      exporter: failingMetricExporter(),
      exportIntervalMillis: 2 ** 31 - 1,
    });
    startWithTestHooks(
      { ...BASE, diagnostics: () => (event) => events.push(event) },
      { metricReader: reader },
    );

    metrics.getMeter("facade-test").createCounter("facade_counter").add(1);
    await forceFlush().catch(() => undefined);

    expect(errorsOf(events)).toEqual([
      { level: "error", message: "metrics export failed", fields: { signal: "metrics", error: "Error" } },
    ]);
    // the far end's text is not repeated
    expect(JSON.stringify(events)).not.toContain("refused by the far end");
  });

  it("is still reported once, not twice, when the exporter is the preset's own (wrapped)", async () => {
    const events: DiagnosticsEvent[] = [];
    start({
      ...BASE,
      diagnostics: () => (event) => events.push(event),
      testExporters: { metricExporter: failingMetricExporter() },
    });

    metrics.getMeter("facade-test").createCounter("facade_counter").add(1);
    await forceFlush().catch(() => undefined);

    expect(errorsOf(events)).toEqual([
      { level: "error", message: "metrics export failed", fields: { signal: "metrics", error: "Error" } },
    ]);
  });
});

describe("the facade and a runtime that is already there", () => {
  it("attaches to a runtime started before it and builds nothing", async () => {
    const events: DiagnosticsEvent[] = [];
    const telemetry = startTestTelemetry({
      serviceName: "preloaded",
      diagnostics: () => (event) => events.push(event),
    });
    const before = getStatus();
    const tracerProvider = trace.getTracerProvider();
    const delegate = (tracerProvider as { getDelegate?: () => unknown }).getDelegate?.();
    const meterProvider = metrics.getMeterProvider();
    const loggerProvider = logs.getLoggerProvider();
    const facadeExporter = new InMemorySpanExporter();
    const errors = vi.spyOn(console, "error");

    await SmartClient.initialize({
      environment: "node",
      serviceName: "facade",
      endpoint: "http://127.0.0.1:9/never",
      testSpanProcessor: new SimpleSpanProcessor(facadeExporter),
    });

    expect(getStatus()).toEqual(before);
    // a second SDK would have tried to register its providers, and been told it could not
    expect(events).toEqual([]);
    expect((trace.getTracerProvider() as { getDelegate?: () => unknown }).getDelegate?.()).toBe(delegate);
    expect(metrics.getMeterProvider()).toBe(meterProvider);
    expect(logs.getLoggerProvider()).toBe(loggerProvider);
    // a second start() would have thrown and been logged as a failed initialisation
    expect(errors).not.toHaveBeenCalled();
    // the spans go to the runtime that was there, not to the facade's hook
    trace.getTracer("facade-test").startSpan("after-attach").end();
    expect((await telemetry.spans()).map((span) => span.name)).toEqual(["after-attach"]);
    expect(facadeExporter.getFinishedSpans()).toEqual([]);
  });

  it("starts the runtime once when initialize is called twice", async () => {
    const exporter = new InMemorySpanExporter();
    const errors = vi.spyOn(console, "error");
    const config = {
      environment: "node",
      serviceName: "facade",
      disableInstrumentation: true,
      testSpanProcessor: new SimpleSpanProcessor(exporter),
    } as const;

    const first = await SmartClient.initialize(config);
    const status = getStatus();
    const second = await SmartClient.initialize(config);

    expect(second).toBe(first);
    expect(status).toMatchObject({ state: "running", serviceName: "facade" });
    expect(getStatus()).toEqual(status);
    expect(errors).not.toHaveBeenCalled();
  });
});
