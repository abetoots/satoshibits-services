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
import { resolveConfig } from "../../preset/config.mjs";
import { createDiagnostics } from "../../preset/diagnostics.mjs";
import { ExportFailureLog } from "../../preset/exporters.mjs";
import { createRedactor } from "../../preset/redaction.mjs";
import { buildPipelines, resetForTesting, startWithTestHooks } from "../../preset/runtime.mjs";
import { sanitizeObject, SmartClient } from "../../index.mjs";
import { NodeSDK as FacadeSdk } from "../../sdk-wrapper-node.mjs";
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

  it("returns the client it already has when initialize is called twice, and starts nothing again", async () => {
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

  it("a second facade instance attaches to the runtime the first one started", () => {
    const first = new InMemorySpanExporter();
    const second = new InMemorySpanExporter();
    const errors = vi.spyOn(console, "error");
    const config = (exporter: InMemorySpanExporter) =>
      ({
        environment: "node",
        serviceName: "facade",
        disableInstrumentation: true,
        testSpanProcessor: new SimpleSpanProcessor(exporter),
      }) as const;

    new FacadeSdk(config(first)).start();
    const status = getStatus();
    // past SmartClient's own cache: the facade's guard is what stops a second start
    expect(() => new FacadeSdk(config(second)).start()).not.toThrow();

    expect(getStatus()).toEqual(status);
    expect(errors).not.toHaveBeenCalled();
    trace.getTracer("facade-test").startSpan("after-second").end();
    expect(first.getFinishedSpans().map((span) => span.name)).toEqual(["after-second"]);
    expect(second.getFinishedSpans()).toEqual([]);
  });

  it("warns that the test hooks it was given are not used when it attaches", async () => {
    startTestTelemetry({ serviceName: "preloaded" });
    const warnings = vi.spyOn(console, "warn");

    await SmartClient.initialize({
      environment: "node",
      serviceName: "facade",
      testSpanProcessor: new SimpleSpanProcessor(new InMemorySpanExporter()),
    });

    expect(warnings.mock.calls.map(([message]) => String(message))).toContainEqual(
      expect.stringContaining("testSpanProcessor and testMetricReader are not used"),
    );
  });
});

describe("the facade's config", () => {
  it("warns that sampling no longer has an effect", async () => {
    const warnings = vi.spyOn(console, "warn");

    await SmartClient.initialize({
      environment: "node",
      serviceName: "facade",
      disableInstrumentation: true,
      testSpanProcessor: new SimpleSpanProcessor(new InMemorySpanExporter()),
      sampling: { baseRate: 0.5 },
    });

    expect(warnings.mock.calls.map(([message]) => String(message))).toContainEqual(
      expect.stringContaining("sampling is configured but has no effect"),
    );
  });

  it("gives a metric reader passed to initialize the metrics", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
    await SmartClient.initialize({
      environment: "node",
      serviceName: "facade",
      disableInstrumentation: true,
      testMetricReader: new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 2 ** 31 - 1 }),
    });
    metrics.getMeter("facade-test").createCounter("facade_counter").add(1);
    await forceFlush();
    const names = exporter
      .getMetrics()
      .flatMap((collection) => collection.scopeMetrics)
      .flatMap((scope) => scope.metrics.map((metric) => metric.descriptor.name));
    expect(names).toContain("facade_counter");
  });

  it("reports a failed export behind a metric reader given to initialize exactly once", async () => {
    const lines: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    vi.spyOn(process.stderr, "write").mockImplementation((chunk, ...rest) => {
      lines.push(String(chunk));
      return write(chunk, ...(rest as []));
    });
    await SmartClient.initialize({
      environment: "node",
      serviceName: "facade",
      disableInstrumentation: true,
      testMetricReader: new PeriodicExportingMetricReader({
        exporter: failingMetricExporter(),
        exportIntervalMillis: 2 ** 31 - 1,
      }),
    });

    metrics.getMeter("facade-test").createCounter("facade_counter").add(1);
    await forceFlush().catch(() => undefined);

    const failures = lines
      .flatMap((chunk) => chunk.split("\n"))
      .filter((line) => line.includes('"msg":"metrics export failed"'));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('"signal":"metrics"');
  });
});

// rows of COMPATIBILITY.md that need no network
describe("the facade's config, as against 1.x (in-process)", () => {
  const hooked = (exporter = new InMemorySpanExporter()) =>
    ({
      environment: "node",
      serviceName: "facade",
      disableInstrumentation: true,
      testSpanProcessor: new SimpleSpanProcessor(exporter),
    }) as const;

  it("builds the metric reader for an endpoint with a 60 s interval, where 1.x used 10 s", async () => {
    const resolution = resolveConfig(
      { serviceName: "facade", endpoint: "http://127.0.0.1:9", redaction: standardPolicy },
      {},
    );
    if (resolution.disabled) throw new Error("not disabled here");
    const pipelines = buildPipelines(
      resolution.config,
      {},
      { diagnostics: createDiagnostics(), redactor: createRedactor(standardPolicy), failures: new ExportFailureLog() },
      true,
    );

    const reader = pipelines.metricReaders[0] as unknown as { _exportInterval: number };
    expect(reader._exportInterval).toBe(60_000);
    await Promise.all(pipelines.spanProcessors.map((processor) => processor.shutdown()));
  });

  it("gives the test hooks nothing with OTEL_SDK_DISABLED=true", async () => {
    vi.stubEnv("OTEL_SDK_DISABLED", "true");
    const exporter = new InMemorySpanExporter();

    await SmartClient.initialize(hooked(exporter));
    trace.getTracer("facade-test").startSpan("disabled").end();

    expect(getStatus().state).toBe("disabled");
    expect(exporter.getFinishedSpans()).toEqual([]);
  });

  it("starts again after a shutdown in test mode, with the new hooks", async () => {
    const first = new InMemorySpanExporter();
    const second = new InMemorySpanExporter();

    await SmartClient.initialize(hooked(first));
    await SmartClient.shutdown();
    await SmartClient.initialize(hooked(second));
    trace.getTracer("facade-test").startSpan("second-run").end();

    expect(getStatus().state).toBe("running");
    expect(second.getFinishedSpans().map((span) => span.name)).toEqual(["second-run"]);
  });

  it("honours OTEL_TRACES_SAMPLER, as 1.x did", async () => {
    vi.stubEnv("OTEL_TRACES_SAMPLER", "always_off");
    const exporter = new InMemorySpanExporter();

    await SmartClient.initialize(hooked(exporter));
    trace.getTracer("facade-test").startSpan("unsampled").end();

    expect(getStatus().sampler).toBe("always_off");
    expect(exporter.getFinishedSpans()).toEqual([]);
  });

  it("builds nothing with skipSdkInitialization, as 1.x did", async () => {
    await SmartClient.initialize({ environment: "node", serviceName: "facade", skipSdkInitialization: true });

    expect(getStatus().state).toBe("not-started");
  });

  it("registers its process handlers with enableProcessHandlers and removes them at shutdown, as 1.x did", async () => {
    const before = process.listenerCount("SIGTERM");

    await SmartClient.initialize({ ...hooked(), enableProcessHandlers: true });
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    await SmartClient.shutdown();

    expect(process.listenerCount("SIGTERM")).toBe(before);
  });

  it("warns about an invalid samplingRate and about enablePrometheus, and applies neither, as 1.x did", async () => {
    const warnings = vi.spyOn(console, "warn");

    await SmartClient.initialize({ ...hooked(), samplingRate: 1.5, enablePrometheus: true });

    const messages = warnings.mock.calls.map(([message]) => String(message));
    expect(messages).toContainEqual(expect.stringContaining("Invalid samplingRate: 1.5"));
    expect(messages).toContainEqual(expect.stringContaining("enablePrometheus is configured"));
    expect(getStatus().sampler).toBe("parentbased_always_on");
  });

  it("configures the root entry's sanitize helpers with sanitizerOptions, as 1.x did", async () => {
    await SmartClient.initialize({ ...hooked(), sanitizerOptions: { customRedactFields: ["account"] } });

    expect(sanitizeObject({ account: "acc-1", plain: "kept" })).toEqual({
      account: "[REDACTED]",
      plain: "kept",
    });
  });
});
