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
    const fromEnvironment = await sinks.extra();
    const run = await runChild(
      {
        start: "facade",
        facade: { endpoint: sink.url, headers: { "x-facade-key": "facade-value" } },
      },
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: fromEnvironment.url,
        OTEL_EXPORTER_OTLP_HEADERS: "x-facade-key=from-environment",
      },
    );

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
    // the endpoint in code overrides the variable
    expect(fromEnvironment.connections).toEqual([]);
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

// rows of COMPATIBILITY.md: what the facade's config does now, as against 1.x
describe("the facade's config, as against 1.x", () => {
  it("strips a trailing /v1/traces from the endpoint, as 1.x did", async () => {
    await runChild({ start: "facade", facade: { endpoint: `${sink.url}/v1/traces` } });

    const paths = new Set(sink.requests.map((request) => request.path));
    expect([...paths].sort()).toEqual(["/v1/metrics", "/v1/traces"]);
  });

  it("exports nothing without an endpoint: the implicit localhost:4318 of 1.x is gone", async () => {
    const run = await runChild({ start: "facade" });

    expect(run.result.statusAfterFacade).toMatchObject({
      state: "running",
      signals: {
        traces: { enabled: false, reason: "no-endpoint" },
        metrics: { enabled: false, reason: "no-endpoint" },
      },
    });
    expect(run.result.sockets).toEqual([]);
    expect(run.stderrLines.filter((line) => line.reason === "no-endpoint")).toHaveLength(2);
  });

  it("exports logs only when OTEL_LOGS_EXPORTER=otlp asks for them, where 1.x always did", async () => {
    const quiet = await runChild({ start: "facade", facade: { endpoint: sink.url } });
    expect(quiet.result.statusAfterFacade?.signals.logs).toEqual({
      enabled: false,
      reason: "not-requested",
    });
    expect(sink.logRecords()).toEqual([]);

    await runChild({ start: "facade", facade: { endpoint: sink.url } }, { OTEL_LOGS_EXPORTER: "otlp" });
    expect(sink.logRecords().map((record) => record.body)).toEqual(["child-log-line"]);
  });

  it("puts the service name and version given in code on the resource, and no 1.x defaults", async () => {
    await runChild(
      { start: "facade", facade: { endpoint: sink.url, serviceName: "from-code", serviceVersion: "2.3.4" } },
      { OTEL_SERVICE_NAME: "from-environment", NODE_ENV: "production" },
    );
    const resource = sink.spans()[0]!.resource;
    expect(resource["service.name"]).toBe("from-code");
    expect(resource["service.version"]).toBe("2.3.4");
    // 1.x set deployment.environment from NODE_ENV (default "development")
    expect(resource["deployment.environment"]).toBeUndefined();
    expect(resource["deployment.environment.name"]).toBeUndefined();

    sink.requests.length = 0;
    await runChild({ start: "facade", facade: { endpoint: sink.url } });
    // 1.x set service.version to "0.0.0" when none was given
    expect(sink.spans()[0]!.resource["service.version"]).toBeUndefined();
  });

  it("drops the host, process and OS keys 1.x's detectors added, and keeps only the OS type", async () => {
    await runChild({ start: "facade", facade: { endpoint: sink.url } });

    const keys = Object.keys(sink.spans()[0]!.resource);
    expect(keys.filter((key) => /^(host|process)\./.test(key))).toEqual([]);
    expect(keys.filter((key) => key.startsWith("os."))).toEqual(["os.type"]);
  });

  it("takes deployment.environment.name from OTEL_RESOURCE_ATTRIBUTES, not NODE_ENV", async () => {
    await runChild(
      { start: "facade", facade: { endpoint: sink.url } },
      { NODE_ENV: "production", OTEL_RESOURCE_ATTRIBUTES: "deployment.environment.name=staging" },
    );

    expect(sink.spans()[0]!.resource["deployment.environment.name"]).toBe("staging");
  });

  it("refuses an empty service name with no OTEL_SERVICE_NAME, and runs without telemetry", async () => {
    const run = await runChild({ start: "facade", facade: { endpoint: sink.url, serviceName: "" } });

    expect(run.result.statusAfterFacade).toMatchObject({ state: "not-started" });
    expect(run.stderr).toContain("no service name");
    expect(sink.connections).toEqual([]);
  });

  it("takes an empty service name's place from OTEL_SERVICE_NAME when it is set", async () => {
    const run = await runChild(
      { start: "facade", facade: { endpoint: sink.url, serviceName: "" } },
      { OTEL_SERVICE_NAME: "from-environment" },
    );

    expect(run.result.statusAfterFacade).toMatchObject({ state: "running", serviceName: "from-environment" });
    expect(sink.spans()[0]!.resource["service.name"]).toBe("from-environment");
  });

  it("installs the auto-instrumentation unless disableInstrumentation or autoInstrument: false", async () => {
    const on = await runChild({ start: "facade", facade: { disableInstrumentation: false } });
    const disabled = await runChild({ start: "facade", facade: { disableInstrumentation: true } });
    const notAuto = await runChild({
      start: "facade",
      facade: { disableInstrumentation: false, autoInstrument: false },
    });

    expect(on.result.httpPatched).toBe(true);
    expect(disabled.result.httpPatched).toBe(false);
    expect(notAuto.result.httpPatched).toBe(false);
  });

  it("exports metrics every 60 s by default, where 1.x did every 10 s", async () => {
    // no flush and no shutdown: only the reader's own timer can send metrics within the 13 s,
    // 3 s past 1.x's 10 s interval and far short of 60 s
    const run = await runChild({
      start: "facade",
      facade: { endpoint: sink.url },
      lingerMillis: 13_000,
      finish: "none",
    });

    expect(run.result.statusAfterFacade?.signals.metrics).toMatchObject({ enabled: true });
    expect(sink.metrics()).toEqual([]);
  });

  it("exports metrics at the interval OTEL_METRIC_EXPORT_INTERVAL sets", async () => {
    await runChild(
      { start: "facade", facade: { endpoint: sink.url }, lingerMillis: 1_500, finish: "none" },
      { OTEL_METRIC_EXPORT_INTERVAL: "300" },
    );

    expect(sink.metrics().map((metric) => metric.name)).toContain("child_counter");
  });

  it("does not start again after a shutdown outside test mode: the second initialize attaches", async () => {
    const run = await runChild({
      start: "facade",
      facade: { endpoint: sink.url },
      facadeAgain: true,
    });

    expect(run.result.statusAfterSecondFacade).toMatchObject({ state: "shut-down" });
    expect(run.stderr).not.toContain("Failed to initialize");
  });
});
