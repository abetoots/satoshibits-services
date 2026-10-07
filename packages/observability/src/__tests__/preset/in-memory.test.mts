/**
 * The in-memory half of the test kit, used the way a consumer's test would.
 */

import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TestTelemetry } from "../../testing/in-memory.mjs";

import { getStatus } from "../../preset.mjs";
import { startTestTelemetry } from "../../testing/in-memory.mjs";

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  await telemetry?.stop();
  telemetry = undefined;
});

describe("startTestTelemetry", () => {
  it("collects spans, metric points and log records through the real pipeline", async () => {
    telemetry = startTestTelemetry({ serviceName: "kit-test" });
    expect(telemetry.status).toMatchObject({
      state: "running",
      serviceName: "kit-test",
      loaderHook: false,
      signals: {
        traces: { enabled: true, destination: "test" },
        metrics: { enabled: true, destination: "test" },
        logs: { enabled: true, destination: "test" },
      },
    });

    const tracer = trace.getTracer("kit");
    await tracer.startActiveSpan("parent", async (parent) => {
      tracer.startSpan("child").end();
      logs.getLogger("kit").emit({ body: "inside the span" });
      await Promise.resolve();
      parent.setStatus({ code: SpanStatusCode.OK });
      parent.end();
    });
    const counter = metrics.getMeter("kit").createCounter("orders_total");
    counter.add(2, { outcome: "accepted" });
    counter.add(1, { outcome: "rejected" });

    const spans = await telemetry.spans();
    const parent = spans.find((s) => s.name === "parent")!;
    const child = spans.find((s) => s.name === "child")!;
    expect(spans).toHaveLength(2);
    // context propagation works: the child is under the parent
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
    expect(parent.resource.attributes["service.name"]).toBe("kit-test");

    expect(await telemetry.metricPoints("orders_total")).toEqual([
      { attributes: { outcome: "accepted" }, value: 2 },
      { attributes: { outcome: "rejected" }, value: 1 },
    ]);
    expect(await telemetry.metricPoints("never_recorded")).toEqual([]);

    const records = await telemetry.logRecords();
    expect(records.map((r) => r.body)).toEqual(["inside the span"]);
    expect(records[0]!.spanContext?.traceId).toBe(parent.spanContext().traceId);
  });

  it("shows records as a backend would receive them: redacted", async () => {
    telemetry = startTestTelemetry();
    trace.getTracer("scope dave.sentinel@example.com").startSpan("s").end();

    const [span] = await telemetry.spans();
    expect(span!.instrumentationScope.name).toBe("scope d***@example.com");
  });

  it("reports the latest collection, so a counter is not counted twice", async () => {
    telemetry = startTestTelemetry();
    const counter = metrics.getMeter("kit").createCounter("ticks_total");
    counter.add(1);
    expect(await telemetry.metricPoints("ticks_total")).toEqual([{ attributes: {}, value: 1 }]);
    counter.add(1);
    expect(await telemetry.metricPoints("ticks_total")).toEqual([{ attributes: {}, value: 2 }]);
  });

  it("clear() forgets collected spans and log records", async () => {
    telemetry = startTestTelemetry();
    trace.getTracer("kit").startSpan("before").end();
    logs.getLogger("kit").emit({ body: "before" });
    await telemetry.spans();

    telemetry.clear();
    trace.getTracer("kit").startSpan("after").end();

    expect((await telemetry.spans()).map((s) => s.name)).toEqual(["after"]);
    expect(await telemetry.logRecords()).toEqual([]);
  });

  it("can be stopped and started again in one process, with nothing carried over", async () => {
    telemetry = startTestTelemetry({ serviceName: "first" });
    trace.getTracer("kit").startSpan("from-first").end();
    await telemetry.stop();
    expect(getStatus().state).toBe("not-started");
    // between runs the API is back to its no-op state
    expect(trace.getTracer("kit").startSpan("orphan").isRecording()).toBe(false);

    telemetry = startTestTelemetry({ serviceName: "second" });
    trace.getTracer("kit").startSpan("from-second").end();
    const spans = await telemetry.spans();
    expect(spans.map((s) => s.name)).toEqual(["from-second"]);
    expect(spans[0]!.resource.attributes["service.name"]).toBe("second");
  });

  it("opens no socket", async () => {
    const net = await import("node:net");
    const connect = vi.spyOn(net.Socket.prototype, "connect");
    telemetry = startTestTelemetry();
    trace.getTracer("kit").startSpan("s").end();
    metrics.getMeter("kit").createCounter("c").add(1);
    logs.getLogger("kit").emit({ body: "b" });
    await telemetry.spans();
    await telemetry.metrics();
    await telemetry.logRecords();
    expect(connect).not.toHaveBeenCalled();
  });

  it("throws, instead of collecting nothing, when the SDK is disabled", () => {
    vi.stubEnv("OTEL_SDK_DISABLED", "true");
    expect(() => startTestTelemetry()).toThrow(
      /telemetry is disabled; unset OTEL_SDK_DISABLED/,
    );
    // the failed attempt does not block the next start
    vi.unstubAllEnvs();
    telemetry = startTestTelemetry();
    expect(telemetry.status.state).toBe("running");
  });

  it("refuses a second start while one is running", () => {
    telemetry = startTestTelemetry();
    expect(() => startTestTelemetry()).toThrow(/start\(\) was already called/);
  });
});
