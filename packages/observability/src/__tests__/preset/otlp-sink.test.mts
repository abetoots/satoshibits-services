/**
 * Contract of the test kit's OTLP sink: real upstream exporters send to it and
 * the sink must report what they sent, in either encoding.
 */

import { ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { ExportResultCode } from "@opentelemetry/core";
import { OTLPLogExporter as JsonLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPLogExporter as ProtoLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter as ProtoMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter as JsonTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as ProtoTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";

import type { OtlpSink } from "../../testing/otlp-sink.mjs";
import type { LogRecordExporter } from "@opentelemetry/sdk-logs";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

import { startOtlpSink } from "../../testing/otlp-sink.mjs";

const resource = resourceFromAttributes({
  "service.name": "sink-contract",
  "custom.count": 3,
});

let sink: OtlpSink | undefined;
const closers: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  // shut providers down first so no exporter is mid-request when the sink closes
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  await sink?.close();
  sink = undefined;
});

async function emitSpan(exporter: SpanExporter): Promise<void> {
  const provider = new BasicTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  closers.push(() => provider.shutdown());
  const tracer = provider.getTracer("sink-scope", "9.9.9");
  const linked = tracer.startSpan("linked");
  linked.end();
  const span = tracer.startSpan("checkout", {
    attributes: {
      "text.value": "hello",
      "int.value": 42,
      "bool.value": true,
      "list.value": ["a", "b"],
    },
    links: [{ context: linked.spanContext(), attributes: { "link.key": "lv" } }],
  });
  span.addEvent("cache-miss", { "event.key": "ev" });
  span.setStatus({ code: SpanStatusCode.ERROR, message: "boom" });
  span.end();
  await provider.forceFlush();
}

describe("OTLP sink", () => {
  it.each([
    ["protobuf", "application/x-protobuf", ProtoTraceExporter],
    ["json", "application/json", JsonTraceExporter],
  ] as const)(
    "reports a span sent as %s with every part a test may assert on",
    async (encoding, contentType, Exporter) => {
      sink = await startOtlpSink();
      await emitSpan(
        new Exporter({
          url: `${sink.url}/v1/traces`,
          headers: { "x-sink-test": "header-value" },
        }),
      );

      // the simple processor sends each span in its own request
      const request = sink
        .requestsTo("/v1/traces")
        .find((r) => r.decoded.spans.some((s) => s.name === "checkout"))!;
      expect(request).toBeDefined();
      expect(request.method).toBe("POST");
      expect(request.encoding).toBe(encoding);
      expect(request.contentType).toBe(contentType);
      expect(request.headers["x-sink-test"]).toBe("header-value");
      expect(sink.connections.length).toBeGreaterThan(0);
      expect(sink.connections[0]!.localAddress).toBe("127.0.0.1");

      const span = sink.spans().find((s) => s.name === "checkout");
      expect(span).toBeDefined();
      expect(span!.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(span!.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(span!.attributes).toEqual({
        "text.value": "hello",
        "int.value": 42,
        "bool.value": true,
        "list.value": ["a", "b"],
      });
      expect(span!.events).toEqual([
        { name: "cache-miss", attributes: { "event.key": "ev" } },
      ]);
      expect(span!.links).toHaveLength(1);
      expect(span!.links[0]!.attributes).toEqual({ "link.key": "lv" });
      expect(span!.links[0]!.traceId).toMatch(/^[0-9a-f]{32}$/);
      // 2 is STATUS_CODE_ERROR in OTLP
      expect(span!.status).toEqual({ code: 2, message: "boom" });
      expect(span!.resource).toMatchObject({
        "service.name": "sink-contract",
        "custom.count": 3,
      });
      expect(span!.scope).toMatchObject({ name: "sink-scope", version: "9.9.9" });
      // the raw text search a redaction test relies on
      expect(request.bodyText).toContain("cache-miss");
      expect(request.bodyText).not.toContain("never-sent");
    },
  );

  it("reports sums, gauges and histograms with their values and attributes", async () => {
    sink = await startOtlpSink();
    const reader = new PeriodicExportingMetricReader({
      exporter: new ProtoMetricExporter({ url: `${sink.url}/v1/metrics` }),
      exportIntervalMillis: 60_000,
    });
    const provider = new MeterProvider({ resource, readers: [reader] });
    closers.push(() => provider.shutdown());
    const meter = provider.getMeter("metric-scope");
    meter.createCounter("jobs_total").add(5, { queue: "email" });
    meter.createHistogram("job_seconds", { unit: "s" }).record(1.5, { queue: "email" });
    meter.createGauge("queue_depth").record(7, { queue: "email" });
    await provider.forceFlush();

    expect(sink.requestsTo("/v1/metrics")[0]!.encoding).toBe("protobuf");
    const byName = Object.fromEntries(sink.metrics().map((m) => [m.name, m]));
    expect(byName.jobs_total).toMatchObject({
      type: "sum",
      points: [{ attributes: { queue: "email" }, value: 5 }],
      scope: { name: "metric-scope" },
      resource: { "service.name": "sink-contract" },
    });
    expect(byName.job_seconds).toMatchObject({
      type: "histogram",
      unit: "s",
      points: [{ attributes: { queue: "email" }, value: 1.5 }],
    });
    expect(byName.queue_depth).toMatchObject({
      type: "gauge",
      points: [{ attributes: { queue: "email" }, value: 7 }],
    });
  });

  it.each([
    ["protobuf", ProtoLogExporter],
    ["json", JsonLogExporter],
  ] as const)(
    "reports a log record sent as %s, including a nested body and its trace ids",
    async (encoding, Exporter) => {
      sink = await startOtlpSink();
      const exporter: LogRecordExporter = new Exporter({
        url: `${sink.url}/v1/logs`,
      });
      const provider = new LoggerProvider({
        resource,
        processors: [new SimpleLogRecordProcessor({ exporter })],
      });
      closers.push(() => provider.shutdown());
      const tracer = new BasicTracerProvider().getTracer("t");
      const span = tracer.startSpan("parent");
      provider.getLogger("log-scope").emit({
        severityNumber: SeverityNumber.WARN,
        severityText: "WARN",
        body: { message: "disk low", detail: { free: 12, tags: ["a"] } },
        attributes: { "log.key": "lv", payload: new Uint8Array([1, 2, 255]) },
        context: trace.setSpan(ROOT_CONTEXT, span),
      });
      span.end();
      // the simple log processor's flush does not wait for a request in flight
      await sink.waitFor(() => sink!.requestsTo("/v1/logs").length > 0);

      expect(sink.requestsTo("/v1/logs")[0]!.encoding).toBe(encoding);
      const records = sink.logRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        body: { message: "disk low", detail: { free: 12, tags: ["a"] } },
        severityText: "WARN",
        // bytes are hex in this view, whichever encoding carried them
        attributes: { "log.key": "lv", payload: "0102ff" },
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        scope: { name: "log-scope" },
        resource: { "service.name": "sink-contract" },
      });
    },
  );

  it("decodes a gzip-compressed request", async () => {
    sink = await startOtlpSink();
    await emitSpan(
      new ProtoTraceExporter({
        url: `${sink.url}/v1/traces`,
        // the string form is what the exporter's own types accept
        compression: "gzip" as never,
      }),
    );
    expect(sink.requestsTo("/v1/traces")[0]!.headers["content-encoding"]).toBe(
      "gzip",
    );
    expect(sink.spans().map((s) => s.name)).toContain("checkout");
  });

  it("reports metrics sent as JSON the same way, including integer values", async () => {
    const { OTLPMetricExporter: JsonMetricExporter } = await import(
      "@opentelemetry/exporter-metrics-otlp-http"
    );
    sink = await startOtlpSink();
    const reader = new PeriodicExportingMetricReader({
      exporter: new JsonMetricExporter({ url: `${sink.url}/v1/metrics` }),
      exportIntervalMillis: 60_000,
    });
    const provider = new MeterProvider({ resource, readers: [reader] });
    closers.push(() => provider.shutdown());
    provider.getMeter("metric-scope").createCounter("jobs_total").add(5, { queue: "email" });
    await provider.forceFlush();

    expect(sink.requestsTo("/v1/metrics")[0]!.encoding).toBe("json");
    expect(sink.metrics().find((m) => m.name === "jobs_total")).toMatchObject({
      type: "sum",
      points: [{ attributes: { queue: "email" }, value: 5 }],
    });
  });

  it.each([
    ["protobuf", ProtoTraceExporter],
    ["json", JsonTraceExporter],
  ] as const)(
    "reports span kind and parent id the same way as %s",
    async (_encoding, Exporter) => {
      sink = await startOtlpSink();
      const provider = new BasicTracerProvider({
        resource,
        spanProcessors: [
          new SimpleSpanProcessor(new Exporter({ url: `${sink.url}/v1/traces` })),
        ],
      });
      closers.push(() => provider.shutdown());
      const tracer = provider.getTracer("t");
      const parent = tracer.startSpan("parent", { kind: SpanKind.SERVER });
      const child = tracer.startSpan(
        "child",
        { kind: SpanKind.CLIENT },
        trace.setSpan(ROOT_CONTEXT, parent),
      );
      child.end();
      parent.end();
      await provider.forceFlush();

      const sent = Object.fromEntries(sink.spans().map((s) => [s.name, s]));
      // OTLP numbers kinds from 1: SERVER is 2, CLIENT is 3
      expect(sent.parent!.kind).toBe(2);
      expect(sent.child!.kind).toBe(3);
      expect(sent.child!.parentSpanId).toBe(parent.spanContext().spanId);
      expect(sent.parent!.parentSpanId).toBeUndefined();
    },
  );

  it("answers with the injected status, and still records the request", async () => {
    sink = await startOtlpSink();
    sink.respondWith({ status: 401 });
    const exporter = new ProtoTraceExporter({ url: `${sink.url}/v1/traces` });
    closers.push(() => exporter.shutdown());
    const provider = new BasicTracerProvider({ resource });
    const span = provider.getTracer("t").startSpan("rejected");
    span.end();

    const result = await new Promise<{ code: ExportResultCode }>((resolve) =>
      // the span object is a ReadableSpan at runtime
      exporter.export([span as never], resolve),
    );

    expect(result.code).toBe(ExportResultCode.FAILED);
    expect(sink.spans().map((s) => s.name)).toEqual(["rejected"]);
  });

  it("answers with the injected status text and body, which reach the exporter's error", async () => {
    sink = await startOtlpSink();
    sink.respondWith({ status: 500, statusText: "Sink Says No", body: "body-from-the-sink" });
    const exporter = new ProtoTraceExporter({ url: `${sink.url}/v1/traces` });
    closers.push(() => exporter.shutdown());
    const provider = new BasicTracerProvider({ resource });
    const span = provider.getTracer("t").startSpan("rejected");
    span.end();

    const result = await new Promise<{ code: ExportResultCode; error?: Error }>((resolve) =>
      exporter.export([span as never], resolve),
    );

    expect(result.code).toBe(ExportResultCode.FAILED);
    // the upstream error carries the status text as its message and the body as its data
    expect(result.error).toMatchObject({
      name: "OTLPExporterError",
      code: 500,
      message: "Sink Says No",
      data: "body-from-the-sink",
    });
    expect(sink.spans().map((s) => s.name)).toEqual(["rejected"]);
  });

  it("records a connection and a request it never answers", async () => {
    sink = await startOtlpSink();
    sink.respondWith({ hang: true });
    const exporter = new ProtoTraceExporter({
      url: `${sink.url}/v1/traces`,
      timeoutMillis: 300,
    });
    closers.push(() => exporter.shutdown());
    const provider = new BasicTracerProvider({ resource });
    const span = provider.getTracer("t").startSpan("unanswered");
    span.end();

    const result = await new Promise<{ code: ExportResultCode }>((resolve) =>
      exporter.export([span as never], resolve),
    );

    expect(result.code).toBe(ExportResultCode.FAILED);
    expect(sink.connections.length).toBeGreaterThan(0);
    expect(sink.requests).toHaveLength(1);
  });

  it("binds IPv4 and IPv6 loopback on one port and tells them apart", async () => {
    sink = await startOtlpSink({ hosts: ["127.0.0.1", "::1"] });
    await emitSpan(
      new ProtoTraceExporter({ url: `http://[::1]:${sink.port}/v1/traces` }),
    );
    await emitSpan(
      new ProtoTraceExporter({ url: `http://127.0.0.1:${sink.port}/v1/traces` }),
    );
    expect(new Set(sink.connections.map((c) => c.localAddress))).toEqual(
      new Set(["::1", "127.0.0.1"]),
    );
  });

  it("rejects, rather than skipping, when the port is already taken", async () => {
    sink = await startOtlpSink();
    await expect(startOtlpSink({ port: sink.port })).rejects.toThrow(
      /could not bind 127\.0\.0\.1 on port/,
    );
  });

  it("waitFor resolves on arrival and rejects with what did arrive", async () => {
    sink = await startOtlpSink();
    const arrived = sink.waitFor(() => sink!.spans().length >= 2, 5000);
    await emitSpan(new ProtoTraceExporter({ url: `${sink.url}/v1/traces` }));
    await expect(arrived).resolves.toBeUndefined();

    await expect(
      sink.waitFor(() => sink!.logRecords().length > 0, 50),
    ).rejects.toThrow(/condition not met within 50 ms.*\/v1\/traces/);
  });

  it("refuses a body it cannot decode instead of reporting nothing", async () => {
    sink = await startOtlpSink();
    const response = await fetch(`${sink.url}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/x-protobuf" },
      // field 1, length-delimited, declared longer than the body
      body: new Uint8Array([0x0a, 0x7f, 0x01]),
    });
    expect(response.status).toBe(400);
    expect(sink.requests).toHaveLength(0);
    expect(sink.undecodable).toHaveLength(1);
    expect(() => sink!.spans()).toThrow(/could not decode/);
  });

  it.each([
    [
      "a corrupt gzip body",
      "/v1/traces",
      { "content-type": "application/x-protobuf", "content-encoding": "gzip" },
      new Uint8Array([1, 2, 3]),
    ],
    [
      "a path that is not an OTLP signal path",
      "/v1/trace",
      { "content-type": "application/x-protobuf" },
      new Uint8Array([]),
    ],
    [
      // field 1 (a message) sent as a varint
      "a field with the wrong wire type",
      "/v1/traces",
      { "content-type": "application/x-protobuf" },
      new Uint8Array([0x08, 0x01]),
    ],
    [
      "a field number that cannot exist",
      "/v1/traces",
      { "content-type": "application/x-protobuf" },
      new Uint8Array([0x00, 0x01]),
    ],
    [
      "a JSON body that is not an object",
      "/v1/traces",
      { "content-type": "application/json" },
      new TextEncoder().encode("[]"),
    ],
    [
      "a JSON body whose repeated field is not an array",
      "/v1/traces",
      { "content-type": "application/json" },
      new TextEncoder().encode('{"resourceSpans":"not-an-array"}'),
    ],
    [
      "a JSON body whose repeated field holds something other than objects",
      "/v1/logs",
      { "content-type": "application/json" },
      new TextEncoder().encode('{"resourceLogs":[{"scopeLogs":[7]}]}'),
    ],
  ])("refuses %s the same way, without crashing", async (_what, path, headers, body) => {
    sink = await startOtlpSink();
    const response = await fetch(`${sink.url}${path}`, { method: "POST", headers, body });
    expect(response.status).toBe(400);
    expect(sink.requests).toHaveLength(0);
    expect(sink.undecodable).toHaveLength(1);
    expect(() => sink!.spans()).toThrow(/could not decode/);
  });

  it("answers 500 and says so when a test's responder throws", async () => {
    sink = await startOtlpSink();
    sink.respondWith(() => {
      throw new Error("responder is broken");
    });
    const exporter = new ProtoTraceExporter({ url: `${sink.url}/v1/traces` });
    closers.push(() => exporter.shutdown());
    const span = new BasicTracerProvider({ resource }).getTracer("t").startSpan("s");
    span.end();
    const result = await new Promise<{ code: ExportResultCode }>((resolve) =>
      exporter.export([span as never], resolve),
    );
    expect(result.code).toBe(ExportResultCode.FAILED);
    expect(() => sink!.spans()).toThrow(/respondWith threw/);
    expect(() => sink!.requestsTo("/v1/traces")).toThrow(/respondWith threw/);
  });

  it.each([
    ["JSON", "application/json", new TextEncoder().encode("{}")],
    ["protobuf", "application/x-protobuf", new Uint8Array([])],
    // field 99 is not in the schema: skipped, as a newer exporter's field would be
    ["protobuf with an unknown field", "application/x-protobuf", new Uint8Array([0x98, 0x06, 0x01])],
  ])("accepts an empty %s request as an export of nothing", async (_what, contentType, body) => {
    sink = await startOtlpSink();
    const response = await fetch(`${sink.url}/v1/traces`, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    });
    expect(response.status).toBe(200);
    expect(sink.undecodable).toEqual([]);
    expect(sink.requestsTo("/v1/traces")).toHaveLength(1);
    expect(sink.spans()).toEqual([]);
  });

  it.each([
    // Span.name (5, a string) sent as eight fixed bytes
    ["a string sent as fixed64", [0x29, 0, 0, 0, 0, 0, 0, 0, 0], /arrived with wire type 1/],
    // Span.attributes (9) > KeyValue.value (2) > AnyValue.double_value (4) sent as an empty length-delimited field
    ["a double sent length-delimited", [0x4a, 0x04, 0x12, 0x02, 0x22, 0x00], /arrived with wire type 2/],
  ])("tells fixed-width and length-delimited fields apart: %s", async (_what, span, error) => {
    sink = await startOtlpSink();
    const scopeSpans = [0x12, span.length, ...span];
    const resourceSpans = [0x12, scopeSpans.length, ...scopeSpans];
    const body = new Uint8Array([0x0a, resourceSpans.length, ...resourceSpans]);
    const response = await fetch(`${sink.url}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/x-protobuf" },
      body,
    });
    expect(response.status).toBe(400);
    expect(sink.undecodable[0]!.error).toMatch(error);
  });

  it("refuses a scalar field that arrives with the wrong wire type", async () => {
    sink = await startOtlpSink();
    // ResourceSpans(1) > ScopeSpans(2) > Span(2) > name(5) sent as a varint, not a string
    const span = [0x28, 0x01];
    const scopeSpans = [0x12, span.length, ...span];
    const resourceSpans = [0x12, scopeSpans.length, ...scopeSpans];
    const body = new Uint8Array([0x0a, resourceSpans.length, ...resourceSpans]);
    const response = await fetch(`${sink.url}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/x-protobuf" },
      body,
    });
    expect(response.status).toBe(400);
    expect(sink.undecodable[0]!.error).toMatch(/arrived with wire type 0/);
  });

  it("waitFor rejects, rather than throwing elsewhere, when its condition throws", async () => {
    sink = await startOtlpSink();
    // the expectation is attached before the request, so the rejection always has a handler
    const rejected = expect(
      sink.waitFor(() => sink!.spans().length > 0, 2000),
    ).rejects.toThrow(/could not decode/);
    await fetch(`${sink.url}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not otlp",
    });
    await rejected;
  });
});
