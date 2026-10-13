/**
 * The in-memory half of the test kit, used the way a consumer's test would.
 */

import {
  diag,
  metrics,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { globalErrorHandler } from "@opentelemetry/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TestTelemetry } from "../../testing/in-memory.mjs";

import { getStatus, shutdown } from "../../preset.mjs";
import { startTestTelemetry } from "../../testing/in-memory.mjs";

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  // first, so a failed assertion cannot leave the variable set for the next test
  vi.unstubAllEnvs();
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

  it("throws, instead of collecting nothing, when the SDK is disabled, and leaves nothing behind", async () => {
    vi.stubEnv("OTEL_SDK_DISABLED", "true");
    expect(() => startTestTelemetry()).toThrow(
      /telemetry is disabled; unset OTEL_SDK_DISABLED/,
    );
    expect(getStatus().state).toBe("not-started");
    vi.unstubAllEnvs();

    // a start that follows at once must stay started
    telemetry = startTestTelemetry();
    // let every pending microtask and timer of the refused start run before emitting
    await new Promise((resolve) => setImmediate(resolve));
    trace.getTracer("kit").startSpan("after-restart").end();
    expect((await telemetry.spans()).map((s) => s.name)).toEqual(["after-restart"]);
  });

  it("a stop that is not awaited does not undo the start that follows it", async () => {
    telemetry = startTestTelemetry({ serviceName: "first" });
    const stopping = telemetry.stop();
    telemetry = startTestTelemetry({ serviceName: "second" });
    // wait for the first one's shutdown itself, however long it takes, not for a guessed delay
    await stopping;
    trace.getTracer("kit").startSpan("kept").end();
    expect((await telemetry.spans()).map((s) => s.name)).toEqual(["kept"]);
  });

  it("hands out status as a copy the caller cannot use to change the runtime", async () => {
    telemetry = startTestTelemetry();
    const status = getStatus();
    status.state = "shut-down";
    status.signals.traces = { enabled: false, reason: "no-endpoint" };
    telemetry.status.state = "disabled";

    expect(getStatus()).toMatchObject({
      state: "running",
      signals: { traces: { enabled: true } },
    });
    // forceFlush still works: the runtime did not see the edits
    trace.getTracer("kit").startSpan("s").end();
    expect(await telemetry.spans()).toHaveLength(1);
  });

  it("keeps the default service name when the option is present but undefined", async () => {
    telemetry = startTestTelemetry({ serviceName: undefined });
    trace.getTracer("kit").startSpan("s").end();
    const [span] = await telemetry.spans();
    expect(span!.resource.attributes["service.name"]).toBe("test");
  });

  it("never masks the service name or the instance id, whatever the redaction options", async () => {
    telemetry = startTestTelemetry({
      serviceName: "billing 0f8fad5b-d9cb-469f-a165-70867728950e",
      redaction: { sanitizer: { maskUUIDs: true } },
      resourceAttributes: { "other.id": "0f8fad5b-d9cb-469f-a165-70867728950e" },
    });
    trace.getTracer("kit").startSpan("s").end();
    const [span] = await telemetry.spans();
    const attributes = span!.resource.attributes;
    expect(attributes["service.name"]).toBe("billing 0f8fad5b-d9cb-469f-a165-70867728950e");
    expect(attributes["service.instance.id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    // the positive control: the option does mask other values
    expect(attributes["other.id"]).toBe("********-****-****-****-************");
  });

  it("honours parent-based sampling: an unsampled remote parent is followed, a sampled one too", async () => {
    telemetry = startTestTelemetry({ sampler: { type: "parentbased_always_off" } });
    const tracer = trace.getTracer("kit");
    const remote = (flags: number) =>
      trace.setSpanContext(ROOT_CONTEXT, {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        traceFlags: flags,
        isRemote: true,
      });
    tracer.startSpan("root").end();
    tracer.startSpan("under-unsampled", {}, remote(0)).end();
    tracer.startSpan("under-sampled", {}, remote(1)).end();

    // the root sampler says no; only the child of a sampled parent is kept
    expect((await telemetry.spans()).map((s) => s.name)).toEqual(["under-sampled"]);
  });

  it("gives diagnostics the same redaction as exported data, and scrubs URLs", () => {
    const events: { message: string }[] = [];
    telemetry = startTestTelemetry({
      diagnostics: () => (event) => events.push(event),
    });
    // any SDK component may log through the API's diagnostics logger
    diag.warn(
      "export failed for frank.sentinel@example.com at https://u:SENTINEL-PW@h.example/p?t=SENTINEL-Q",
    );
    expect(events.map((e) => e.message)).toEqual([
      "export failed for f***@example.com at https://h.example",
    ]);
  });

  it("refuses to answer after stop(), instead of reporting that nothing was emitted", async () => {
    const stopped = startTestTelemetry();
    trace.getTracer("kit").startSpan("s").end();
    await stopped.stop();

    await expect(stopped.spans()).rejects.toThrow(/was stopped/);
    await expect(stopped.metrics()).rejects.toThrow(/was stopped/);
    await expect(stopped.metricPoints("x")).rejects.toThrow(/was stopped/);
    await expect(stopped.logRecords()).rejects.toThrow(/was stopped/);
  });

  it("gives the diagnostics logger and the error handler back when stopped", async () => {
    const events: { message: string }[] = [];
    const stopped = startTestTelemetry({ diagnostics: () => (event) => events.push(event) });
    diag.warn("while running");
    await stopped.stop();

    diag.warn("after the stop");
    globalErrorHandler(new Error("after the stop"));
    // (the handler the SDK is given back logs through the logger, which is gone too)
    expect(events.map((e) => e.message)).toEqual(["while running"]);
  });

  it("refuses to answer after the preset's own shutdown() too", async () => {
    telemetry = startTestTelemetry();
    trace.getTracer("kit").startSpan("s").end();
    await shutdown();

    await expect(telemetry.spans()).rejects.toThrow(/was stopped/);
    await expect(telemetry.metrics()).rejects.toThrow(/was stopped/);
    await expect(telemetry.logRecords()).rejects.toThrow(/was stopped/);
  });

  it("a second stop() of an old kit leaves a newer kit running", async () => {
    const old = startTestTelemetry();
    await old.stop();
    telemetry = startTestTelemetry();
    await old.stop();

    trace.getTracer("kit").startSpan("seen by the newer kit").end();
    expect((await telemetry.spans()).map((s) => s.name)).toEqual(["seen by the newer kit"]);
  });

  it("refuses a second start while one is running", () => {
    telemetry = startTestTelemetry();
    expect(() => startTestTelemetry()).toThrow(/start\(\) was already called/);
  });
});
