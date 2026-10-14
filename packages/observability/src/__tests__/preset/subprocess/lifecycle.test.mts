/**
 * forceFlush() and shutdown() against a real OTLP sink: they deliver what was
 * buffered, and reject, with the preset's own error and nothing of the far
 * end's answer, when it could not be delivered. Each case in a fresh process.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { OtlpSink } from "../../../testing/otlp-sink.mjs";

import {
  POLICY_ERROR_CODE,
  POLICY_ERROR_MESSAGE,
  POLICY_ERROR_NAME,
} from "../probe-policy.mjs";
import { runChild, useSinks } from "./harness.mjs";

const sinks = useSinks();
let sink: OtlpSink;
beforeEach(() => {
  ({ sink } = sinks);
});

const SIGNAL_PATHS = { traces: "/v1/traces", metrics: "/v1/metrics", logs: "/v1/logs" } as const;
type SignalName = keyof typeof SIGNAL_PATHS;

/** every signal on, to the sink, with batch timers far longer than a test: only a flush sends */
const allSignals = (extra: Record<string, string> = {}) => ({
  OTEL_SERVICE_NAME: "lifecycle-test",
  OTEL_EXPORTER_OTLP_ENDPOINT: sink.url,
  OTEL_LOGS_EXPORTER: "otlp",
  OTEL_BSP_SCHEDULE_DELAY: "60000",
  OTEL_BLRP_SCHEDULE_DELAY: "60000",
  OTEL_METRIC_EXPORT_INTERVAL: "60000",
  ...extra,
});

/** how soon a child must exit once it has printed its result, with nothing left to hold it */
const EXIT_BOUND_MILLIS = 3000;

// what the far end says; neither may reach the caller
const STATUS_TEXT_SENTINEL = "Status-Text-Sentinel";
const BODY_SENTINEL = "response-body-sentinel";

describe("forceFlush and shutdown deliver what was buffered", () => {
  it("shutdown delivers buffered spans", async () => {
    const run = await runChild({ spans: 3, metric: false, log: false }, allSignals());

    expect(run.result.finishError).toBeNull();
    expect(sink.spans().map((s) => s.name).sort()).toEqual([
      "child-span-0",
      "child-span-1",
      "child-span-2",
    ]);
  });

  it("forceFlush delivers spans, metric points and log records without shutting down, and exporting goes on", async () => {
    const run = await runChild(
      { finish: "forceFlush", emitAgainAfterFinish: true },
      allSignals(),
    );

    expect(run.result.finishError).toBeNull();
    expect(run.result.againError).toBeNull();
    // the first flush sent what was buffered before it, and only that
    expect(sink.requestsTo("/v1/traces")[0]!.decoded.spans.map((s) => s.name)).toEqual([
      "child-span-0",
    ]);
    expect(sink.requestsTo("/v1/logs")[0]!.decoded.logRecords.map((r) => r.body)).toEqual([
      "child-log-line",
    ]);
    expect(sink.requestsTo("/v1/metrics")[0]!.decoded.metrics.map((m) => m.name)).toContain(
      "child_counter",
    );
    // and what was emitted after it was sent by the next one: the pipelines were not shut down
    expect(sink.spans().map((s) => s.name)).toEqual(["child-span-0", "after-finish"]);
    expect(sink.logRecords().map((r) => r.body)).toEqual(["child-log-line", "after-finish-line"]);
    expect(sink.metrics().map((m) => m.name)).toContain("child_counter_after_finish");
    expect(run.result.status.state).toBe("running");
  });
});

describe("a failed export of what was buffered", () => {
  const cases: SignalName[][] = [["traces"], ["metrics"], ["logs"], ["traces", "metrics", "logs"]];

  describe.each(["forceFlush", "shutdown"] as const)("%s", (finish) => {
    it.each(cases.map((failing) => ({ failing, label: failing.join(" + ") })))(
      "rejects with the preset's error, naming the failed signal(s) and the status, and nothing the far end said ($label)",
      async ({ failing }) => {
        const failingPaths = failing.map((signal) => SIGNAL_PATHS[signal]);
        sink.respondWith((request) =>
          failingPaths.some((path) => request.path.endsWith(path))
            ? { status: 500, statusText: STATUS_TEXT_SENTINEL, body: BODY_SENTINEL }
            : {},
        );

        const run = await runChild({ finish }, allSignals());

        // the failing signals did reach the sink, and were answered with the sentinels
        for (const path of failingPaths) expect(sink.requestsTo(path)).not.toHaveLength(0);
        expect(run.result.finishErrorName).toBe("TelemetryExportError");
        const message = run.result.finishError!;
        for (const signal of Object.keys(SIGNAL_PATHS) as SignalName[]) {
          if (failing.includes(signal)) expect(message).toContain(signal);
          else expect(message).not.toContain(signal);
        }
        expect(message).toMatch(/\b500\b/);
        expect(message).toContain("OTLPExporterError");
        // message, String(), JSON and every own property (the stack among them)
        const text = run.result.finishErrorText!;
        expect(text).not.toContain(STATUS_TEXT_SENTINEL);
        expect(text).not.toContain(BODY_SENTINEL);
      },
    );
  });

  it("a redaction policy that throws during the export a flush triggered: the rejection names it and carries nothing of its error but its name", async () => {
    const run = await runChild(
      { finish: "forceFlush", redaction: "throwing", metric: false, log: false },
      allSignals({ OTEL_METRICS_EXPORTER: "none", OTEL_LOGS_EXPORTER: "none" }),
    );

    expect(run.result.startError).toBeNull();
    expect(sink.requestsTo("/v1/traces")).toHaveLength(0);
    expect(run.result.finishErrorName).toBe("TelemetryExportError");
    expect(run.result.finishError).toContain("traces");
    expect(run.result.finishError).toContain(POLICY_ERROR_NAME);
    const text = run.result.finishErrorText!;
    expect(text).not.toContain(POLICY_ERROR_MESSAGE);
    expect(text).not.toContain(POLICY_ERROR_CODE);
  });
});

describe("no timer outlives a call", () => {
  it("after a shutdown with a long timeout succeeds, the process exits by itself at once", async () => {
    const run = await runChild({ finish: "shutdown", timeoutMillis: 60_000, exit: "natural" }, allSignals());

    expect(run.result.finishError).toBeNull();
    expect(sink.spans().map((s) => s.name)).toEqual(["child-span-0"]);
    // a call's own deadline timer, left running, would hold the process for a minute
    expect(run.exitMillisAfterResult).toBeLessThan(EXIT_BOUND_MILLIS);
    expect(run.code).toBe(0);
  });
});

describe("a sink that never answers", () => {
  it("shutdown rejects at its timeout, and the process then exits by itself", async () => {
    sink.respondWith({ hang: true });

    const run = await runChild(
      { finish: "shutdown", timeoutMillis: 500, exit: "natural", metric: false, log: false },
      allSignals({
        OTEL_METRICS_EXPORTER: "none",
        OTEL_LOGS_EXPORTER: "none",
        // the exporter's own deadline for one request, retries included
        OTEL_EXPORTER_OTLP_TIMEOUT: "2000",
      }),
    );

    expect(sink.requestsTo("/v1/traces")).not.toHaveLength(0);
    expect(run.result.finishError).toMatch(/shutdown did not finish within 500 ms/);
    expect(run.result.finishMillis).toBeGreaterThanOrEqual(450);
    expect(run.result.finishMillis).toBeLessThan(3000);
    // nothing outlives the exporter's own deadline (2 s): no timer, no socket (the sink is still hung)
    expect(run.exitMillisAfterResult).toBeLessThan(2000 + EXIT_BOUND_MILLIS);
    expect(run.code).toBe(0);
  });
});
