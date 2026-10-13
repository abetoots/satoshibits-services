/**
 * The wrapper every exporter sits behind, exercised through the real `start()`
 * with exporters a test controls.
 */

import { diag, metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { ExportResultCode, globalErrorHandler } from "@opentelemetry/core";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { afterEach, describe, expect, it } from "vitest";

import type { DiagnosticsEvent } from "../../preset/diagnostics.mjs";
import type { TestExporters } from "../../preset/runtime.mjs";
import type { ExportResult } from "@opentelemetry/core";

import { getStatus } from "../../preset.mjs";
import { createDiagnostics } from "../../preset/diagnostics.mjs";
import {
  wasReportedByExporter,
  wrapSpanExporter,
} from "../../preset/exporters.mjs";
import { createRedactor } from "../../preset/redaction.mjs";
import { forceFlush, resetForTesting, start } from "../../preset/runtime.mjs";
import { startTestTelemetry } from "../../testing/in-memory.mjs";

afterEach(async () => {
  await resetForTesting();
});

function startWith(testExporters: TestExporters) {
  const events: DiagnosticsEvent[] = [];
  start({
    serviceName: "wrapper-test",
    instrumentations: false,
    loaderHook: false,
    diagnostics: () => (event) => events.push(event),
    testExporters,
  });
  return events;
}

const throwing = (message: string) => ({
  export: () => {
    throw new Error(message);
  },
  shutdown: () => Promise.resolve(),
  forceFlush: () => Promise.resolve(),
});

describe("exporter wrapper", () => {
  it.each([
    [
      "traces",
      { spanExporter: throwing("span exporter blew up") },
      () => trace.getTracer("t").startSpan("s").end(),
    ],
    [
      "metrics",
      { metricExporter: throwing("metric exporter blew up") },
      () => metrics.getMeter("m").createCounter("c").add(1),
    ],
    [
      "logs",
      { logRecordExporter: throwing("log exporter blew up") },
      () => logs.getLogger("l").emit({ body: "b" }),
    ],
  ] as const)(
    "answers an exporter that throws (%s) with a failed result and one report, and never throws at the caller",
    async (signal, testExporters, emit) => {
      const events = startWith(testExporters as TestExporters);

      expect(emit).not.toThrow();
      // the metric reader rejects a flush whose export failed; spans and logs do not
      await forceFlush().catch(() => undefined);

      const reports = events.filter((e) => e.message === `${signal} export failed`);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ level: "error", fields: { signal, error: "Error" } });
      // the thrown text is the exporter's own; it is not copied into the report
      expect(JSON.stringify(reports[0])).not.toContain("blew up");
      expect(getStatus().state).toBe("running");
    },
  );

  it("answers once when an exporter answers and then throws, answers twice, or the callback itself throws", () => {
    const reports: DiagnosticsEvent[] = [];
    const context = {
      diagnostics: createDiagnostics({ sinkFactory: () => (e) => reports.push(e) }),
      redactor: createRedactor(),
    };
    context.diagnostics.activate();

    const answers: ExportResult[] = [];
    wrapSpanExporter(
      {
        export: (_spans, callback) => {
          callback({ code: ExportResultCode.SUCCESS });
          throw new Error("thrown after answering");
        },
        shutdown: () => Promise.resolve(),
      },
      context,
    ).export([], (result) => answers.push(result));
    expect(answers.map((a) => a.code)).toEqual([ExportResultCode.SUCCESS]);
    // the export succeeded: nothing to report
    expect(reports).toEqual([]);

    const twice: ExportResult[] = [];
    wrapSpanExporter(
      {
        export: (_spans, callback) => {
          callback({ code: ExportResultCode.SUCCESS });
          callback({ code: ExportResultCode.FAILED });
        },
        shutdown: () => Promise.resolve(),
      },
      context,
    ).export([], (result) => twice.push(result));
    expect(twice.map((a) => a.code)).toEqual([ExportResultCode.SUCCESS]);

    let calls = 0;
    expect(() =>
      wrapSpanExporter(
        {
          export: (_spans, callback) => callback({ code: ExportResultCode.SUCCESS }),
          shutdown: () => Promise.resolve(),
        },
        context,
      ).export([], () => {
        calls++;
        throw new Error("the processor's callback threw");
      }),
    ).not.toThrow();
    expect(calls).toBe(1);
  });

  it("reports a timed-out request with a reason, since it has neither status nor code", async () => {
    const events = startWith({
      spanExporter: {
        export: (_spans, callback) =>
          callback({ code: ExportResultCode.FAILED, error: new Error("Request timed out") }),
        shutdown: () => Promise.resolve(),
      },
    });
    trace.getTracer("t").startSpan("s").end();
    await forceFlush().catch(() => undefined);
    expect(events.find((e) => e.message === "traces export failed")?.fields).toMatchObject({
      signal: "traces",
      reason: "timeout",
    });
  });

  it("keeps the exporter's own temporality: a delta exporter reports each interval's increase", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
    startWith({ metricExporter: exporter });
    const counter = metrics.getMeter("m").createCounter("ticks_total");

    counter.add(1);
    await forceFlush();
    counter.add(1);
    await forceFlush();

    const values = exporter
      .getMetrics()
      .flatMap((collection) => collection.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.descriptor.name === "ticks_total")
      .flatMap((metric) => metric.dataPoints.map((point) => point.value));
    // cumulative, the reader's default without the pass-through, would give [1, 2]
    expect(values).toEqual([1, 1]);
  });
});

describe("the SDK's global error handler", () => {
  it("reports an error once per kind per interval, and skips only what the exporter wrapper reported", async () => {
    const reportedByWrapper = new Error("connect ECONNREFUSED");
    const events = startWith({
      spanExporter: {
        export: (_spans, callback) =>
          callback({ code: ExportResultCode.FAILED, error: reportedByWrapper }),
        shutdown: () => Promise.resolve(),
      },
    });
    trace.getTracer("t").startSpan("s").end();
    await forceFlush().catch(() => undefined);
    expect(wasReportedByExporter(reportedByWrapper)).toBe(true);
    events.length = 0;

    // what the SDK would hand over during an outage, and beside it unrelated failures
    globalErrorHandler(reportedByWrapper);
    globalErrorHandler(new Error("PeriodicExportingMetricReader: metrics export failed (error x)"));
    globalErrorHandler(new Error("first plain error"));
    globalErrorHandler(new Error("second plain error"));
    globalErrorHandler(new Error("third plain error"));
    globalErrorHandler(new TypeError("a type error"));
    // an error with a string code the wrapper never saw must not be swallowed
    globalErrorHandler(Object.assign(new RangeError("no such file"), { code: "ENOENT" }));
    globalErrorHandler(null as never);
    globalErrorHandler("a bare string" as never);

    const pipeline = events.filter((e) => e.message === "telemetry pipeline error");
    expect(pipeline.map((e) => e.fields?.error)).toEqual(["Error", "TypeError", "RangeError"]);
    expect(pipeline[0]!.fields).toMatchObject({ detail: "first plain error" });
  });

  it("stops reaching the sink once telemetry is reset", async () => {
    const events = startWith({});
    await resetForTesting();
    events.length = 0;
    globalErrorHandler(new Error("after reset"));
    diag.warn("after reset");
    expect(events).toEqual([]);
  });
});

describe("a start that fails part-way", () => {
  it("gives back what it registered, delivers what diagnostics held, and lets the next start work", async () => {
    const events: DiagnosticsEvent[] = [];
    expect(() =>
      start({
        serviceName: "fails",
        instrumentations: false,
        loaderHook: false,
        diagnostics: () => (event) => events.push(event),
        testExporters: {
          get metricExporter(): never {
            throw new Error("exporter could not be built");
          },
        },
      }),
    ).toThrow("exporter could not be built");

    expect(getStatus().state).toBe("not-started");
    // the logger and the error handler were given back: neither reaches the failed start's sink
    const before = events.length;
    diag.warn("after the failed start");
    globalErrorHandler(new Error("after the failed start"));
    expect(events).toHaveLength(before);
    // no tracer provider was left registered
    expect(trace.getTracer("t").startSpan("s").isRecording()).toBe(false);

    const telemetry = startTestTelemetry();
    trace.getTracer("t").startSpan("works").end();
    expect((await telemetry.spans()).map((s) => s.name)).toEqual(["works"]);
  });
});
