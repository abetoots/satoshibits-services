/**
 * The deprecated 1.x facade (`SmartClient.initialize`) over the preset: what
 * leaves the process, and where it goes. Asserted at local OTLP sinks, in a
 * fresh process per case, with the trap on localhost:4318 for the whole file.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { OtlpSink } from "../../../testing/otlp-sink.mjs";

import { runChild, useSinks } from "./harness.mjs";

const sinks = useSinks();
let sink: OtlpSink;
beforeEach(() => {
  ({ sink } = sinks);
});

/** a span that carries something the standard policy changes on every surface read */
const SENSITIVE_SPAN = {
  spans: 1,
  spanName: "lookup for jane.doe@example.com",
  spanNameAsGiven: true,
  spanAttributes: { password: "SENTINEL-hunter2", "order.kind": "subscription" },
} as const;

describe("the facade starting the runtime", () => {
  it("exports to the endpoint and with the headers given in code", async () => {
    const run = await runChild({
      start: "facade",
      facade: { endpoint: sink.url, headers: { "x-facade-key": "facade-value" } },
    });

    expect(run.result.statusAfterFacade).toMatchObject({
      state: "running",
      serviceName: "facade-child",
      signals: { traces: { enabled: true }, metrics: { enabled: true } },
    });
    expect(sink.spans().map((span) => span.name)).toEqual(["child-span-0"]);
    expect(sink.metrics().map((metric) => metric.name)).toContain("child_counter");
    const paths = sink.requests.map((request) => request.path);
    expect(paths).toEqual(expect.arrayContaining(["/v1/traces", "/v1/metrics"]));
    for (const request of sink.requests) {
      expect(request.headers["x-facade-key"]).toBe("facade-value");
    }
  });

  it("exports under the standard redaction policy", async () => {
    const run = await runChild({ start: "facade", facade: { endpoint: sink.url }, ...SENSITIVE_SPAN });

    expect(run.result.statusAfterFacade).toMatchObject({ state: "running" });
    const spans = sink.spans();
    expect(spans.map((span) => span.name)).toEqual(["lookup for [EMAIL]"]);
    expect(spans[0]!.attributes).toEqual({ password: "[REDACTED]", "order.kind": "subscription" });
    const sent = sink.requests.map((request) => request.bodyText).join("\n");
    expect(sent).not.toContain("SENTINEL");
    expect(sent).not.toContain("jane.doe");
  });

  it("sends nothing anywhere with the old no-export flag, whatever the variables say", async () => {
    const run = await runChild(
      { start: "facade", facade: { endpoint: sink.url } },
      {
        OBS_TEST_NO_EXPORT: "1",
        OTEL_EXPORTER_OTLP_ENDPOINT: sink.url,
        OTEL_LOGS_EXPORTER: "otlp",
      },
    );

    expect(run.result.statusAfterFacade).toMatchObject({
      state: "running",
      signals: {
        traces: { enabled: false, reason: "test-hooks" },
        metrics: { enabled: false, reason: "test-hooks" },
        logs: { enabled: false, reason: "test-hooks" },
      },
    });
    expect(run.result.spans[0]?.valid).toBe(true);
    expect(run.result.sockets).toEqual([]);
    expect(sink.connections).toEqual([]);
  });

  it("delivers spans to an injected test span processor and sends nothing over the network", async () => {
    const run = await runChild(
      { start: "facade", facade: { endpoint: sink.url, testSpanProcessor: true }, spans: 2 },
      { OTEL_EXPORTER_OTLP_ENDPOINT: sink.url, OTEL_LOGS_EXPORTER: "otlp" },
    );

    expect(run.result.facadeSpans).toEqual(["child-span-0", "child-span-1"]);
    expect(run.result.statusAfterFacade).toMatchObject({
      signals: {
        traces: { enabled: true, destination: "test" },
        metrics: { enabled: false, reason: "test-hooks" },
        logs: { enabled: false, reason: "test-hooks" },
      },
    });
    expect(run.result.sockets).toEqual([]);
    expect(sink.connections).toEqual([]);
  });
});

describe("the facade after a preload", () => {
  it("attaches to the runtime already there and builds nothing", async () => {
    const elsewhere = await sinks.extra();
    const run = await runChild(
      {
        start: "start-then-facade",
        options: { serviceName: "preloaded" },
        collectDiagnostics: true,
        facade: { endpoint: elsewhere.url, testSpanProcessor: true },
      },
      { OTEL_EXPORTER_OTLP_ENDPOINT: sink.url },
    );

    expect(run.result.startError).toBeNull();
    expect(run.result.statusBeforeFacade).toMatchObject({ state: "running", serviceName: "preloaded" });
    expect(run.result.statusAfterFacade).toEqual(run.result.statusBeforeFacade);
    // a second SDK would have been told it could not register its providers
    expect(run.result.diagnostics.filter((event) => event.level !== "warn")).toEqual([]);
    expect(run.result.facadeSpans).toEqual([]);
    expect(sink.spans().map((span) => span.name)).toEqual(["child-span-0"]);
    expect(elsewhere.connections).toEqual([]);
    // the facade's shutdown is the runtime's: it was flushed and stopped
    expect(run.result.status.state).toBe("shut-down");
  });
});
