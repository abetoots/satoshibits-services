/**
 * Which signals leave the process, and where they go.
 *
 * Asserted at a local OTLP sink, in a fresh process per case. A second sink
 * (the "trap") holds the specification's default address, localhost:4318, on
 * both loopback families for the whole file: nothing may ever arrive there
 * unless a test configured that address on purpose.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { OtlpSink } from "../../../testing/otlp-sink.mjs";

import {
  DEFAULT_OTLP_PORT,
  drainTrap,
  runChild,
  socketsOutside,
  useSinks,
} from "./harness.mjs";

const NAME = { OTEL_SERVICE_NAME: "signals-test" };

const sinks = useSinks();
let trap: OtlpSink;
let sink: OtlpSink;
beforeEach(() => {
  ({ trap, sink } = sinks);
});

const endpoint = () => ({ ...NAME, OTEL_EXPORTER_OTLP_ENDPOINT: sink.url });

describe("the default-address trap itself", () => {
  it("is bound on port 4318 and catches a process that does export there", async () => {
    expect(trap.port).toBe(DEFAULT_OTLP_PORT);
    const run = await runChild(
      {},
      { ...NAME, OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${DEFAULT_OTLP_PORT}` },
    );
    expect(run.result.startError).toBeNull();
    // the child's socket record does record: every other test asserts it holds nothing stray
    expect(run.result.sockets.some((socket) => socket.port === DEFAULT_OTLP_PORT)).toBe(true);
    const spans = trap.spans().map((s) => s.name);
    // this test is the one that may use the trap; leave it clean for the others
    expect(drainTrap(trap).length).toBeGreaterThan(0);
    expect(spans).toContain("child-span-0");
  });
});

describe("signals off", () => {
  it("sends nothing anywhere without an endpoint, says why, and still gives valid trace ids", async () => {
    const run = await runChild({ spans: 3 }, NAME);

    expect(run.result.startError).toBeNull();
    expect(run.result.sockets).toEqual([]);
    expect(sink.connections).toEqual([]);
    expect(run.result.status).toMatchObject({
      state: "shut-down",
      serviceName: "signals-test",
      signals: {
        traces: { enabled: false, reason: "no-endpoint" },
        metrics: { enabled: false, reason: "no-endpoint" },
        logs: { enabled: false, reason: "not-requested" },
      },
    });
    expect(run.result.spans).toHaveLength(3);
    for (const span of run.result.spans) {
      expect(span.valid).toBe(true);
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(span.traceId).not.toBe("0".repeat(32));
    }
  });

  it("warns once per signal that is off for lack of an endpoint", async () => {
    const run = await runChild({}, NAME);
    const lines = run.stderrLines.filter((l) => l.reason === "no-endpoint");
    expect(lines.map((l) => l.signal).sort()).toEqual(["metrics", "traces"]);
    expect(lines[0]).toMatchObject({ level: "warn", source: "opentelemetry" });
  });

  it("OTEL_SDK_DISABLED=true registers nothing at all, even with an endpoint", async () => {
    const run = await runChild(
      { spans: 2 },
      { ...endpoint(), OTEL_SDK_DISABLED: "true", OTEL_LOGS_EXPORTER: "otlp" },
    );

    expect(run.result.startError).toBeNull();
    expect(run.result.sockets).toEqual([]);
    expect(sink.connections).toEqual([]);
    expect(run.result.status).toMatchObject({
      state: "disabled",
      loaderHook: false,
      signals: {
        traces: { enabled: false, reason: "sdk-disabled" },
        metrics: { enabled: false, reason: "sdk-disabled" },
        logs: { enabled: false, reason: "sdk-disabled" },
      },
    });
    // no tracer provider: the API's no-op tracer hands out invalid span contexts
    expect(run.result.spans.map((s) => s.valid)).toEqual([false, false]);
    expect(run.stderr).toBe("");
  });

  it("OTEL_SDK_DISABLED=true is not stopped by a configuration that would otherwise be rejected", async () => {
    const run = await runChild(
      {},
      { OTEL_SDK_DISABLED: "true", OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" },
    );
    expect(run.result.startError).toBeNull();
    expect(run.result.status.state).toBe("disabled");
  });

  it.each([
    ["OTEL_TRACES_EXPORTER", "traces", ["/v1/logs", "/v1/metrics"]],
    ["OTEL_METRICS_EXPORTER", "metrics", ["/v1/logs", "/v1/traces"]],
    ["OTEL_LOGS_EXPORTER", "logs", ["/v1/metrics", "/v1/traces"]],
  ] as const)(
    "%s=none stops that signal and no other",
    async (variable, signal, expectedPaths) => {
      const run = await runChild(
        {},
        { ...endpoint(), OTEL_LOGS_EXPORTER: "otlp", [variable]: "none" },
      );

      expect(run.result.startError).toBeNull();
      expect([...new Set(sink.requests.map((r) => r.path))].sort()).toEqual(
        expectedPaths,
      );
      expect(run.result.status.signals[signal]).toEqual({
        enabled: false,
        reason: "exporter-none",
      });
      expect(socketsOutside(run, sink)).toEqual([]);
      // with traces off, spans are still created with valid ids
      expect(run.result.spans[0]!.valid).toBe(true);
    },
  );
});

describe("signals on", () => {
  it("sends traces and metrics as protobuf with the configured headers, and no logs unless asked", async () => {
    const run = await runChild(
      {},
      { ...endpoint(), OTEL_EXPORTER_OTLP_HEADERS: "authorization=Basic abc123,x-scope=team-a" },
    );

    expect(run.result.startError).toBeNull();
    expect(run.result.finishError).toBeNull();
    expect([...new Set(sink.requests.map((r) => r.path))].sort()).toEqual([
      "/v1/metrics",
      "/v1/traces",
    ]);
    for (const request of sink.requests) {
      expect(request.encoding).toBe("protobuf");
      expect(request.contentType).toBe("application/x-protobuf");
      expect(request.headers.authorization).toBe("Basic abc123");
      expect(request.headers["x-scope"]).toBe("team-a");
    }
    expect(sink.spans().map((s) => s.name)).toEqual(["child-span-0"]);
    expect(sink.spans()[0]!.traceId).toBe(run.result.spans[0]!.traceId);
    expect(sink.metrics().map((m) => m.name)).toContain("child_counter");
    expect(socketsOutside(run, sink)).toEqual([]);

    const host = new URL(sink.url).host;
    expect(run.result.status).toMatchObject({
      state: "shut-down",
      // the positive control for "no loader hook" in the disabled and rejected cases
      loaderHook: true,
      sampler: "parentbased_always_on",
      signals: {
        traces: { enabled: true, destination: "otlp", endpoint: host, protocol: "http/protobuf" },
        metrics: { enabled: true, destination: "otlp", endpoint: host, protocol: "http/protobuf" },
        logs: { enabled: false, reason: "not-requested" },
      },
    });
    // the status never carries a header value
    expect(JSON.stringify(run.result.status)).not.toContain("abc123");
    expect(run.stderr).not.toContain("abc123");
  });

  it("sends logs when OTEL_LOGS_EXPORTER=otlp is set", async () => {
    const run = await runChild({}, { ...endpoint(), OTEL_LOGS_EXPORTER: "otlp" });

    expect(run.result.startError).toBeNull();
    expect(sink.requestsTo("/v1/logs")).not.toHaveLength(0);
    expect(sink.logRecords().map((r) => r.body)).toEqual(["child-log-line"]);
    expect(run.result.status.signals.logs).toMatchObject({ enabled: true });
  });

  it("adds headers passed in code to those from the environment", async () => {
    await runChild(
      { options: { headers: { "x-from-code": "yes" } } },
      { ...endpoint(), OTEL_EXPORTER_OTLP_HEADERS: "x-from-env=yes" },
    );
    const request = sink.requestsTo("/v1/traces")[0]!;
    expect(request.headers["x-from-code"]).toBe("yes");
    expect(request.headers["x-from-env"]).toBe("yes");
  });

  it("sends a signal to its own endpoint, exactly as given, over the general one", async () => {
    const other = await sinks.extra();
    try {
      const run = await runChild(
        {},
        {
          ...endpoint(),
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${other.url}/custom/v1/traces`,
        },
      );
      expect(run.result.startError).toBeNull();
      expect(other.requests.map((r) => r.path)).toEqual(["/custom/v1/traces"]);
      expect(other.spans().map((s) => s.name)).toEqual(["child-span-0"]);
      expect(sink.requestsTo("/v1/traces")).toEqual([]);
      expect(sink.requestsTo("/v1/metrics")).not.toHaveLength(0);
      expect(socketsOutside(run, sink, other)).toEqual([]);
    } finally {
      await other.close();
    }
  });

  it("keeps a general endpoint's query string a query string, after the signal path", async () => {
    const run = await runChild(
      {},
      { ...NAME, OTEL_EXPORTER_OTLP_ENDPOINT: `${sink.url}/base?tenant=a` },
    );
    expect(run.result.startError).toBeNull();
    expect([...new Set(sink.requests.map((r) => r.path))].sort()).toEqual([
      "/base/v1/metrics?tenant=a",
      "/base/v1/traces?tenant=a",
    ]);
    expect(sink.spans().map((s) => s.name)).toEqual(["child-span-0"]);
  });

  it("an endpoint passed in code overrides the general variable", async () => {
    const fromCode = await sinks.extra();
    try {
      const run = await runChild({ options: { endpoint: fromCode.url } }, endpoint());
      expect(run.result.startError).toBeNull();
      expect(fromCode.spans().map((s) => s.name)).toEqual(["child-span-0"]);
      expect(sink.connections).toEqual([]);
    } finally {
      await fromCode.close();
    }
  });

  it("http/json switches the encoding, and a signal-specific protocol beats the general one", async () => {
    const run = await runChild(
      {},
      {
        ...endpoint(),
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
        OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "http/protobuf",
      },
    );
    expect(run.result.startError).toBeNull();
    const traces = sink.requestsTo("/v1/traces");
    const metrics = sink.requestsTo("/v1/metrics");
    expect(traces).not.toHaveLength(0);
    expect(metrics).not.toHaveLength(0);
    expect(traces.map((r) => r.contentType)).toEqual(traces.map(() => "application/json"));
    expect(metrics.map((r) => r.encoding)).toEqual(metrics.map(() => "protobuf"));
    expect(sink.spans().map((s) => s.name)).toEqual(["child-span-0"]);
    expect(run.result.status.signals.traces).toMatchObject({ protocol: "http/json" });
  });
});

describe("rejected configuration", () => {
  it.each([
    [
      { OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" },
      "OTEL_EXPORTER_OTLP_PROTOCOL=grpc is not supported: use http/protobuf or http/json",
    ],
    [
      { OTEL_TRACES_EXPORTER: "console" },
      'OTEL_TRACES_EXPORTER="console" is not supported: use "otlp" or "none"',
    ],
    [
      { OTEL_METRICS_EXPORTER: "prometheus" },
      'OTEL_METRICS_EXPORTER="prometheus" is not supported: use "otlp" or "none"',
    ],
    [
      { OTEL_LOGS_EXPORTER: "console" },
      'OTEL_LOGS_EXPORTER="console" is not supported: use "otlp" or "none"',
    ],
  ])("start() throws for %o and registers nothing", async (env, message) => {
    const run = await runChild({ spans: 1 }, { ...endpoint(), ...env });

    expect(run.result.startError).toContain(message);
    expect(run.result.status.state).toBe("not-started");
    expect(run.result.status.loaderHook).toBe(false);
    expect(run.result.spans[0]!.valid).toBe(false);
    expect(run.result.sockets).toEqual([]);
    expect(sink.connections).toEqual([]);
  });

  it("the register entry reports the same error on stderr and lets the process carry on", async () => {
    const run = await runChild(
      { start: "register" },
      { ...endpoint(), OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" },
    );

    expect(run.code).toBe(0);
    expect(run.result.status.state).toBe("not-started");
    expect(run.stderrLines).toHaveLength(1);
    expect(run.stderrLines[0]).toMatchObject({
      level: "error",
      msg: "telemetry was not started",
    });
    expect(String(run.stderrLines[0]!.reason)).toContain(
      "OTEL_EXPORTER_OTLP_PROTOCOL=grpc is not supported",
    );
    expect(sink.connections).toEqual([]);
  });

  it("neither start() nor register echoes a value pasted into the wrong variable", async () => {
    const pasted = "https://user:SENTINEL-PW@collector.example/v1/traces?token=SENTINEL-Q";
    const env = { ...endpoint(), OTEL_EXPORTER_OTLP_PROTOCOL: pasted };

    const started = await runChild({}, env);
    expect(started.result.startError).toContain("OTEL_EXPORTER_OTLP_PROTOCOL=");
    expect(started.result.startError).not.toContain("SENTINEL");

    const registered = await runChild({ start: "register" }, env);
    expect(registered.stderrLines).toHaveLength(1);
    expect(registered.stderr).not.toContain("SENTINEL");
    expect(registered.stderr).not.toContain("collector.example");
  });

  it.each(["start", "register"] as const)(
    "%s keeps an endpoint's password out of stderr when the SDK would have quoted the variable",
    async (start) => {
      // each is accepted by the preset (it trims, and a URL parses from these spellings), but the
      // SDK's own reading of the variable does not parse, and its warning quotes the whole value
      const env = {
        ...NAME,
        OTEL_LOGS_EXPORTER: "otlp",
        // (not in the order the preset restores them in: the check must not depend on it)
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `\u00a0http:/user:SENTINEL@127.0.0.1:${sink.port}/custom/v1/logs`,
        OTEL_EXPORTER_OTLP_ENDPOINT: `http:\\\\user:SENTINEL@127.0.0.1:${sink.port} `,
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `\u00a0http:\\\\user:SENTINEL@127.0.0.1:${sink.port}/custom/v1/metrics`,
      };
      const run = await runChild({ start, spans: 1 }, env);

      // every endpoint is in use: the general one for traces, its own for each of the others
      expect(sink.spans().map((s) => s.name)).toContain("child-span-0");
      expect(new Set(sink.requests.map((request) => request.path))).toEqual(
        new Set(["/v1/traces", "/custom/v1/metrics", "/custom/v1/logs"]),
      );
      expect(run.stderr).not.toContain("SENTINEL");
      // the SDK said nothing about a URL it was never asked to read
      expect(run.stderrLines.filter((line) => String(line.msg).startsWith("Configuration:"))).toEqual([]);
      // and the variables are the process's again, as they were set
      expect(run.result.endpointVariablesRestored).toBe(true);
    },
  );

  it("the register entry starts from the environment alone", async () => {
    const run = await runChild({ start: "register" }, endpoint());
    expect(run.result.status.state).toBe("shut-down");
    expect(sink.spans().map((s) => s.name)).toEqual(["child-span-0"]);
    expect(sink.spans()[0]!.resource["service.name"]).toBe("signals-test");
  });
});
