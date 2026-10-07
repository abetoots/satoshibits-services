/**
 * What an operator sees when telemetry cannot be delivered, and that the
 * standard tuning variables change what happens on the wire.
 * Asserted in a fresh process per case, against a local OTLP sink.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { ChildRun } from "./harness.mjs";
import type { OtlpSink } from "../../../testing/otlp-sink.mjs";

import { runChild, useSinks } from "./harness.mjs";

const sinks = useSinks();
let sink: OtlpSink;
beforeEach(() => {
  ({ sink } = sinks);
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
    const closed = await sinks.extra();
    const url = closed.url;
    await closed.close();

    const run = await runChild(
      {},
      {
        ...NAME,
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${url}/v1/traces`,
        OTEL_METRICS_EXPORTER: "none",
        // a refused connection is retried with backoff until this runs out; keep it
        // well inside shutdown's own deadline so the report is written before exit
        OTEL_EXPORTER_OTLP_TIMEOUT: "1500",
      },
    );

    expect(run.result.startError).toBeNull();
    // shutdown tells its caller the last export failed, and did so before its own deadline
    expect(run.result.finishError).toContain("ECONNREFUSED");
    expect(run.result.finishMillis).toBeLessThan(8000);
    const lines = linesWith(run, "traces export failed");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      source: "opentelemetry",
      signal: "traces",
      code: "ECONNREFUSED",
      endpoint: new URL(url).host,
    });
    // reported once, by signal; the SDK's own error path does not repeat it
    expect(run.stderrLines).toHaveLength(1);
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
    // ...and the SDK's own error path, which would log each failed batch, adds nothing
    expect(run.stderrLines).toHaveLength(1);
    expect(run.stderr).not.toContain("SENTINEL-HEADER-VALUE");
    expect(JSON.stringify(run.result)).not.toContain("SENTINEL-HEADER-VALUE");
  });

  it.each([
    ["rejected with a 401", "401"],
    ["unreachable", "unreachable"],
  ])("never prints credentials carried in an endpoint URL (%s)", async (_what, mode) => {
    let port = sink.port;
    if (mode === "unreachable") {
      const closed = await sinks.extra();
      port = closed.port;
      await closed.close();
    } else {
      sink.respondWith({ status: 401 });
    }

    const run = await runChild(
      { collectDiagnostics: false },
      {
        ...NAME,
        OTEL_EXPORTER_OTLP_ENDPOINT: `http://user:SENTINEL-PW@127.0.0.1:${port}/SENTINEL-PATH?token=SENTINEL-Q`,
        OTEL_EXPORTER_OTLP_TIMEOUT: "1500",
        // debug: everything the SDK has to say about the request is on stderr
        OTEL_LOG_LEVEL: "debug",
      },
    );

    expect(run.result.startError).toBeNull();
    // positive controls: failures were reported, and (for the 401) the request really carried the URL
    expect(linesWith(run, "traces export failed")).toHaveLength(1);
    if (mode === "401") {
      expect(sink.requests[0]!.path).toContain("SENTINEL-PATH");
    }
    expect(run.result.status.signals.traces).toMatchObject({ endpoint: `127.0.0.1:${port}` });
    expect(run.stderr).not.toContain("SENTINEL");
    expect(JSON.stringify(run.result)).not.toContain("SENTINEL");
  });

  it("at debug level, prints neither resource secrets nor exported values", async () => {
    const run = await runChild(
      { scopeAttributes: { api_key: "SENTINEL-SCOPE" } },
      {
        ...NAME,
        OTEL_EXPORTER_OTLP_ENDPOINT: sink.url,
        OTEL_LOGS_EXPORTER: "otlp",
        OTEL_LOG_LEVEL: "debug",
        OTEL_RESOURCE_ATTRIBUTES: "api_key=SENTINEL-RESOURCE,contact=erin.sentinel@example.com",
      },
    );

    expect(run.result.startError).toBeNull();
    // positive controls: debug lines were written, and the data did go out
    expect(run.stderrLines.some((line) => line.level === "debug")).toBe(true);
    expect(sink.spans()).toHaveLength(1);
    expect(sink.logRecords()).toHaveLength(1);
    expect(run.stderr).not.toContain("SENTINEL");
    expect(run.stderr).not.toContain("erin.sentinel");
  });

  it("reports a setting the upstream exporter refuses at construction", async () => {
    const run = await runChild(
      {},
      tracesOnly({ OTEL_EXPORTER_OTLP_TIMEOUT: "soon" }),
    );
    expect(run.result.startError).toBeNull();
    const lines = run.stderrLines.filter((line) => /OTEL_EXPORTER_OTLP\w*TIMEOUT/.test(String(line.msg)));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn" });
    // and the export still works, on the default
    expect(sink.spans()).toHaveLength(1);
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
    // the variable is hidden from NodeSDK's constructor only; the application still sees it
    expect(run.result.logLevelAfterStart).toBe("debug");
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
  // These children neither shut down nor flush: only the timers can send anything.
  // A control lingers briefly (the default it relies on is seconds or a minute away);
  // a positive run lingers long, so a slow machine has time for the timers and requests.
  const CONTROL_LINGER = 600;
  const POSITIVE_LINGER = 2500;

  it("the span batch delay and size decide when and how spans are sent", async () => {
    const quiet = await runChild(
      { spans: 5, lingerMillis: CONTROL_LINGER, finish: "none" },
      tracesOnly(),
    );
    expect(quiet.result.startError).toBeNull();
    // the default delay is five seconds: nothing has left yet
    expect(sink.requestsTo("/v1/traces")).toEqual([]);

    await runChild(
      { spans: 5, lingerMillis: POSITIVE_LINGER, finish: "none" },
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

  it("the log batch delay decides when log records are sent", async () => {
    const env = {
      ...NAME,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${sink.url}/v1/logs`,
      OTEL_LOGS_EXPORTER: "otlp",
      OTEL_TRACES_EXPORTER: "none",
      OTEL_METRICS_EXPORTER: "none",
    };
    await runChild({ lingerMillis: CONTROL_LINGER, finish: "none" }, env);
    // the default delay is a second (five on older lines): nothing has left yet
    expect(sink.requestsTo("/v1/logs")).toEqual([]);

    await runChild(
      { lingerMillis: POSITIVE_LINGER, finish: "none" },
      { ...env, OTEL_BLRP_SCHEDULE_DELAY: "50" },
    );
    expect(sink.logRecords().map((r) => r.body)).toEqual(["child-log-line"]);
  });

  it("the metric export interval decides how often metrics are sent", async () => {
    const env = {
      ...NAME,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${sink.url}/v1/metrics`,
      OTEL_TRACES_EXPORTER: "none",
    };
    await runChild({ lingerMillis: CONTROL_LINGER, finish: "none" }, env);
    // the default interval is a minute
    expect(sink.requestsTo("/v1/metrics")).toEqual([]);

    await runChild(
      { lingerMillis: POSITIVE_LINGER, finish: "none" },
      { ...env, OTEL_METRIC_EXPORT_INTERVAL: "150" },
    );
    expect(sink.requestsTo("/v1/metrics").length).toBeGreaterThanOrEqual(1);
    expect(sink.metrics().map((m) => m.name)).toContain("child_counter");
  });

  it("the metric export timeout decides when a hung export is given up", async () => {
    sink.respondWith({ hang: true });
    const env = {
      ...NAME,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${sink.url}/v1/metrics`,
      OTEL_TRACES_EXPORTER: "none",
      OTEL_METRIC_EXPORT_INTERVAL: "1000",
    };
    const timeoutLines = (run: ChildRun) =>
      run.stderrLines
        .map((line) => JSON.stringify(line))
        .filter((line) => /timed out|timeout/i.test(line));

    // without the variable the reader's timeout equals the interval: the export that
    // starts at 1000 ms would be given up at 2000 ms, which this run does not reach
    const patient = await runChild({ lingerMillis: 1600, finish: "none" }, env);
    expect(sink.requestsTo("/v1/metrics").length).toBeGreaterThan(0);
    expect(timeoutLines(patient)).toEqual([]);

    const impatient = await runChild(
      { lingerMillis: 1600, finish: "none" },
      { ...env, OTEL_METRIC_EXPORT_TIMEOUT: "100" },
    );
    // given up 100 ms after the export began, well inside the same window
    expect(timeoutLines(impatient)).toHaveLength(1);
    expect(timeoutLines(impatient)[0]).toContain("100");
  });

  it("a metric timeout above the interval is replaced by the interval, with a warning, and metrics still flow", async () => {
    const run = await runChild(
      {},
      {
        ...NAME,
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `${sink.url}/v1/metrics`,
        OTEL_TRACES_EXPORTER: "none",
        OTEL_METRIC_EXPORT_INTERVAL: "200",
        OTEL_METRIC_EXPORT_TIMEOUT: "500",
      },
    );
    expect(run.result.startError).toBeNull();
    expect(run.stderrLines.map((line) => line.msg)).toContain(
      "OTEL_METRIC_EXPORT_TIMEOUT is greater than OTEL_METRIC_EXPORT_INTERVAL; using the interval as the timeout",
    );
    expect(sink.metrics().map((m) => m.name)).toContain("child_counter");
  });

  it("a zero batch size is refused with a warning instead of spinning the process", async () => {
    const run = await runChild(
      { spans: 3 },
      tracesOnly({ OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "0", OTEL_BSP_MAX_QUEUE_SIZE: "0" }),
    );
    expect(run.result.startError).toBeNull();
    expect(run.result.finishError).toBeNull();
    expect(run.stderrLines.map((line) => line.msg)).toEqual([
      'OTEL_BSP_MAX_QUEUE_SIZE="0" is not a positive whole number; using the default',
      'OTEL_BSP_MAX_EXPORT_BATCH_SIZE="0" is not a positive whole number; using the default',
    ]);
    expect(sink.spans()).toHaveLength(3);
  });

  it("reports an unusable tuning value instead of failing or ignoring it silently", async () => {
    const run = await runChild({}, tracesOnly({ OTEL_BSP_SCHEDULE_DELAY: "soon" }));
    expect(run.result.startError).toBeNull();
    expect(run.stderrLines.map((line) => line.msg)).toContain(
      'OTEL_BSP_SCHEDULE_DELAY="soon" is not a positive number; using the default',
    );
    expect(sink.spans()).toHaveLength(1);
  });
});
