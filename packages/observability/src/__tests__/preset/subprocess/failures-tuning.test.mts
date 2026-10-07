/**
 * What an operator sees when telemetry cannot be delivered, and that the
 * standard tuning variables change what happens on the wire.
 * Asserted in a fresh process per case, against a local OTLP sink.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { ChildRun } from "./harness.mjs";
import type { OtlpSink } from "../../../testing/otlp-sink.mjs";

import { startOtlpSink } from "../../../testing/otlp-sink.mjs";
import { drainTrap, runChild, startDefaultAddressTrap } from "./harness.mjs";

let trap: OtlpSink;
let sink: OtlpSink;

beforeAll(async () => {
  trap = await startDefaultAddressTrap();
});
afterAll(async () => {
  await trap.close();
});
beforeEach(async () => {
  sink = await startOtlpSink();
});
afterEach(async () => {
  await sink.close();
  expect(drainTrap(trap), "connections to localhost:4318").toEqual([]);
});

const NAME = { OTEL_SERVICE_NAME: "failure-test" };
const tracesOnly = (extra: Record<string, string> = {}) => ({
  ...NAME,
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${sink.url}/v1/traces`,
  OTEL_METRICS_EXPORTER: "none",
  ...extra,
});

const linesWith = (run: ChildRun, message: string) =>
  run.stderrLines.filter((line) => line.msg === message);

describe("failure visibility", () => {
  it("reports an unreachable endpoint, naming the signal, the error code and the host", async () => {
    const closed = await startOtlpSink();
    const url = closed.url;
    await closed.close();

    const run = await runChild(
      {},
      { ...NAME, OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${url}/v1/traces`, OTEL_METRICS_EXPORTER: "none" },
    );

    expect(run.result.startError).toBeNull();
    const lines = linesWith(run, "traces export failed");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      source: "opentelemetry",
      signal: "traces",
      code: "ECONNREFUSED",
      endpoint: new URL(url).host,
    });
  });

  it("reports a 401 once, with the signal and status and no header value, however many batches fail", async () => {
    sink.respondWith({ status: 401 });

    const run = await runChild(
      { spans: 10 },
      tracesOnly({
        OTEL_EXPORTER_OTLP_HEADERS: "authorization=Basic SENTINEL-HEADER-VALUE",
        // one span per request, so the outage is ten failed batches
        OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "1",
      }),
    );

    // the positive control: ten requests really were made and rejected
    expect(sink.requestsTo("/v1/traces")).toHaveLength(10);
    expect(sink.requests[0]!.headers.authorization).toBe("Basic SENTINEL-HEADER-VALUE");

    const lines = linesWith(run, "traces export failed");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "error", signal: "traces", status: 401 });
    // the SDK's own error path is limited too: one line, not one per batch
    expect(linesWith(run, "telemetry pipeline error")).toHaveLength(1);
    expect(run.stderrLines).toHaveLength(2);
    expect(run.stderr).not.toContain("SENTINEL-HEADER-VALUE");
    expect(JSON.stringify(run.result)).not.toContain("SENTINEL-HEADER-VALUE");
  });

  it("names the failing signal when only one of them is rejected", async () => {
    sink.respondWith((request) => ({
      status: request.path.endsWith("/v1/metrics") ? 403 : 200,
    }));

    const run = await runChild({}, { ...NAME, OTEL_EXPORTER_OTLP_ENDPOINT: sink.url });

    expect(sink.spans()).toHaveLength(1);
    expect(linesWith(run, "traces export failed")).toEqual([]);
    expect(linesWith(run, "metrics export failed")).toHaveLength(1);
    expect(linesWith(run, "metrics export failed")[0]).toMatchObject({
      signal: "metrics",
      status: 403,
    });
  });

  it("reports how many spans were dropped once the queue has overflowed, drained and accepted one more", async () => {
    const run = await runChild(
      // 20 spans, created in one synchronous burst, into a queue of 5. The upstream
      // processor reports drops on the next span it accepts, so drain and add one more.
      { spans: 20, afterDrainSpans: 1 },
      tracesOnly({
        OTEL_BSP_MAX_QUEUE_SIZE: "5",
        OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "5",
        OTEL_BSP_SCHEDULE_DELAY: "60000",
      }),
    );

    expect(run.result.startError).toBeNull();
    const reports = run.stderrLines.filter((line) =>
      /^Dropped \d+ spans because maxQueueSize reached$/.test(String(line.msg)),
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ level: "warn" });
    const dropped = Number(/\d+/.exec(String(reports[0]!.msg))![0]);
    expect(dropped).toBeGreaterThan(0);
    // every span was either delivered or counted as dropped
    expect(sink.spans()).toHaveLength(21 - dropped);
    expect(sink.spans().map((s) => s.name)).toContain("after-drain-0");
  });

  it("keeps exporting when the diagnostics sink throws", async () => {
    const run = await runChild(
      { collectDiagnostics: "throwing" },
      // metrics have no endpoint here, so start() raises a warning into the broken sink
      { ...NAME, OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${sink.url}/v1/traces` },
    );

    expect(run.result.startError).toBeNull();
    expect(run.result.finishError).toBeNull();
    expect(run.result.diagnostics.map((event) => event.fields?.reason)).toContain("no-endpoint");
    expect(sink.spans().map((s) => s.name)).toEqual(["child-span-0"]);
  });

  it("calls an injected diagnostics sink factory only after the SDK has started", async () => {
    const run = await runChild({ collectDiagnostics: true }, NAME);

    // the no-endpoint warnings are raised inside start(); the factory must still run late
    expect(run.result.diagnostics.length).toBeGreaterThan(0);
    expect(run.result.sinkFactoryCalledAfterSdkStarted).toBe(true);
    // and the injected sink replaced stderr
    expect(run.stderr).toBe("");
  });

  it("with OTEL_LOG_LEVEL set, lines still go to the preset's sink, at the new level", async () => {
    const run = await runChild(
      { collectDiagnostics: true },
      { ...NAME, OTEL_LOG_LEVEL: "debug" },
    );

    expect(run.result.diagnostics.some((event) => event.level === "debug")).toBe(true);
    // NodeSDK's console logger would have written plain text here
    expect(run.stderr).toBe("");
    expect(run.stdout.split("\n").filter((line) => line !== "")).toHaveLength(1);
  });

  it("writes JSON lines on stderr by default, and nothing below warning level", async () => {
    const run = await runChild({}, NAME);
    const lines = run.stderr.split("\n").filter((line) => line !== "");
    expect(lines.length).toBeGreaterThan(0);
    expect(run.stderrLines).toHaveLength(lines.length);
    expect(run.stderrLines.map((line) => line.level)).toEqual(lines.map(() => "warn"));
  });

  it("an unparseable endpoint makes start() throw, and register report it without stopping the process", async () => {
    const env = { ...NAME, OTEL_EXPORTER_OTLP_ENDPOINT: "http://[not-a-host" };

    const started = await runChild({}, env);
    expect(started.result.startError).toContain("OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL");
    expect(started.result.status.state).toBe("not-started");

    const registered = await runChild({ start: "register" }, env);
    expect(registered.code).toBe(0);
    expect(String(registered.stderrLines[0]?.reason)).toContain(
      "OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL",
    );
    expect(registered.result.status.state).toBe("not-started");
  });
});

describe("tuning variables", () => {
  // these children do not shut down or flush: only the timers can send anything

  it("the span batch delay and size decide when and how spans are sent", async () => {
    const quiet = await runChild(
      { spans: 5, lingerMillis: 600, finish: "none" },
      tracesOnly(),
    );
    expect(quiet.result.startError).toBeNull();
    // the default delay is five seconds: nothing has left yet
    expect(sink.requestsTo("/v1/traces")).toEqual([]);

    await runChild(
      { spans: 5, lingerMillis: 600, finish: "none" },
      tracesOnly({
        OTEL_BSP_SCHEDULE_DELAY: "50",
        OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "2",
      }),
    );
    const batches = sink.requestsTo("/v1/traces").map((r) => r.decoded.spans.length);
    expect(batches.reduce((sum, size) => sum + size, 0)).toBe(5);
    expect(Math.max(...batches)).toBe(2);
    expect(batches.length).toBeGreaterThanOrEqual(3);
  });

  it("the metric export interval decides how often metrics are sent", async () => {
    const env = {
      ...NAME,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${sink.url}/v1/metrics`,
      OTEL_TRACES_EXPORTER: "none",
    };
    await runChild({ lingerMillis: 700, finish: "none" }, env);
    // the default interval is a minute
    expect(sink.requestsTo("/v1/metrics")).toEqual([]);

    await runChild(
      { lingerMillis: 700, finish: "none" },
      { ...env, OTEL_METRIC_EXPORT_INTERVAL: "150" },
    );
    expect(sink.requestsTo("/v1/metrics").length).toBeGreaterThanOrEqual(2);
    expect(sink.metrics().map((m) => m.name)).toContain("child_counter");
  });

  it("the metric export timeout decides when a hung export is given up", async () => {
    sink.respondWith({ hang: true });
    const env = {
      ...NAME,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${sink.url}/v1/metrics`,
      OTEL_TRACES_EXPORTER: "none",
      OTEL_METRIC_EXPORT_INTERVAL: "400",
    };

    // without the variable the timeout is clamped to the interval (400 ms): not yet reached at 300 ms
    const patient = await runChild({ lingerMillis: 300, finish: "none" }, env);
    expect(patient.stderrLines).toEqual([]);

    const impatient = await runChild(
      { lingerMillis: 900, finish: "none" },
      { ...env, OTEL_METRIC_EXPORT_TIMEOUT: "100" },
    );
    expect(sink.requestsTo("/v1/metrics").length).toBeGreaterThan(0);
    const timeouts = impatient.stderrLines.filter((line) =>
      /timeout|timed out/i.test(JSON.stringify(line)),
    );
    expect(timeouts.length).toBeGreaterThan(0);
  });

  it("reports an unusable tuning value instead of failing or ignoring it silently", async () => {
    const run = await runChild({}, tracesOnly({ OTEL_BSP_SCHEDULE_DELAY: "soon" }));
    expect(run.result.startError).toBeNull();
    expect(run.stderrLines.map((line) => line.msg)).toContain(
      'OTEL_BSP_SCHEDULE_DELAY="soon" is not a non-negative number; using the default',
    );
    expect(sink.spans()).toHaveLength(1);
  });
});
