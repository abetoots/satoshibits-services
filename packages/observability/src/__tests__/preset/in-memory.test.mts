/**
 * The in-memory half of the test kit, used the way a consumer's test would.
 */

import {
  diag,
  metrics,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  DiagLogLevel,
} from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { globalErrorHandler } from "@opentelemetry/core";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { AggregationTemporality, InMemoryMetricExporter } from "@opentelemetry/sdk-metrics";
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";

import type { TestTelemetry } from "../../testing/in-memory.mjs";

import { forceFlush, getStatus, PresetConfigError, shutdown, start } from "../../preset.mjs";
import { createDiagnostics } from "../../preset/diagnostics.mjs";
import { wrapSpanExporter } from "../../preset/exporters.mjs";
import { createRedactor } from "../../preset/redaction.mjs";
import { buildPipelines, instrumentationConfigFor, resetForTesting } from "../../preset/runtime.mjs";
import { startTestTelemetry } from "../../testing/in-memory.mjs";
import type { DiagnosticsEvent } from "../../preset/diagnostics.mjs";
import type { ResolvedConfig } from "../../preset/config.mjs";
import type { RedactionPolicy } from "../../preset/redaction.mjs";
import type { ProbeCall } from "./probe-policy.mjs";
import type { Tracer } from "@opentelemetry/api";
import type { InstrumentationConfigMap } from "@opentelemetry/auto-instrumentations-node";
import type { ReadableSpan, SpanExporter, SpanProcessor } from "@opentelemetry/sdk-trace";

import { createProbePolicy } from "./probe-policy.mjs";

let telemetry: TestTelemetry | undefined;

afterEach(async () => {
  // first, so a failed assertion cannot leave the variable set for the next test
  vi.unstubAllEnvs();
  await telemetry?.stop();
  // and whatever a test started without keeping hold of it (a start it expected to be refused)
  await resetForTesting();
  telemetry = undefined;
});

const OFF: ResolvedConfig["signals"] = {
  traces: { enabled: false, reason: "no-endpoint" },
  metrics: { enabled: false, reason: "no-endpoint" },
  logs: { enabled: false, reason: "not-requested" },
};

/**
 * After a start that was refused: nothing of it is left on the diagnostics API. A logger
 * left behind would make the API warn the next one installed that it is replacing one.
 */
function expectNoDiagLoggerLeftBehind(): void {
  const said: string[] = [];
  const note = (...parts: unknown[]) => said.push(parts.map(String).join(" "));
  diag.setLogger({ error: note, warn: note, info: note, debug: note, verbose: note }, DiagLogLevel.WARN);
  expect(said).toEqual([]);
  diag.disable();
}

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

  it("exports as given unless the test names a policy, and then shows what a backend would receive", async () => {
    telemetry = startTestTelemetry();
    trace.getTracer("scope dave.sentinel@example.com").startSpan("s").end();
    expect((await telemetry.spans())[0]!.instrumentationScope.name).toBe(
      "scope dave.sentinel@example.com",
    );
    await telemetry.stop();

    telemetry = startTestTelemetry({ redaction: createProbePolicy() });
    trace.getTracer("scope dave.sentinel@example.com").startSpan("s").end();
    expect((await telemetry.spans())[0]!.instrumentationScope.name).toBe(
      "[probe:scope.name] scope dave.sentinel@example.com",
    );
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

  it("hands the policy every resource attribute but the two identity keys, wherever they came from", async () => {
    // the two keys set every way an operator can set them; the policy must be handed neither
    vi.stubEnv("OTEL_RESOURCE_ATTRIBUTES", "service.name=from-env,service.instance.id=pinned,team=a");
    const calls: ProbeCall[] = [];
    telemetry = startTestTelemetry({
      serviceName: "billing",
      redaction: createProbePolicy(calls),
      resourceAttributes: {
        "service.name": "from-option",
        "service.instance.id": "from-option",
        "other.id": "0f8fad5b",
      },
    });
    trace.getTracer("kit").startSpan("s").end();
    const [span] = await telemetry.spans();
    const attributes = span!.resource.attributes;

    const handed = calls.filter((call) => call.fn === "attributes" && call.surface === "resource");
    expect(handed).toHaveLength(1);
    expect(handed[0]!.given).not.toContain("service.name");
    expect(handed[0]!.given).not.toContain("service.instance.id");
    // what it was handed is everything else that is exported, the SDK's own attributes included
    expect([...(handed[0]!.given as string[])].sort()).toEqual(
      Object.keys(attributes)
        .filter((key) => key !== "service.name" && key !== "service.instance.id")
        .sort(),
    );
    expect(handed[0]!.given).toEqual(
      expect.arrayContaining(["other.id", "team", "os.type", "telemetry.sdk.name"]),
    );
    expect(attributes["other.id"]).toBe("[probe:resource] 0f8fad5b");
    expect(attributes["telemetry.sdk.language"]).toBe("[probe:resource] nodejs");
    // and every value exported is the one the policy returned: nothing is put back after it
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "service.name" || key === "service.instance.id") continue;
      expect(String(value), key).toMatch(/^\[probe:resource\] /);
    }

    // and what is exported for the two is the preset's, not the operator's and not the policy's
    expect(attributes["service.name"]).toBe("billing");
    expect(attributes["service.instance.id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  });

  it("does not let a policy set, or drop, the two identity keys", async () => {
    telemetry = startTestTelemetry({
      serviceName: "billing",
      redaction: {
        ...createProbePolicy(),
        attributes: () => ({ "service.name": "MASKED", "service.instance.id": "MASKED" }),
      },
    });
    trace.getTracer("kit").startSpan("s").end();
    const attributes = (await telemetry.spans())[0]!.resource.attributes;
    // the policy returned nothing else: nothing else is exported, the SDK's own attributes included
    expect(Object.keys(attributes).sort()).toEqual(["service.instance.id", "service.name"]);
    expect(attributes["service.name"]).toBe("billing");
    expect(attributes["service.instance.id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  });

  describe("the policy on a span", () => {
    const LINKED = {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: 1,
    };

    /** one span with something on every surface of a span a policy is handed */
    function emitOnEverySurface(tracer: Tracer = trace.getTracer("kit")): void {
      const span = tracer.startSpan("checkout", {
        attributes: { customer: "erin", attempt: 2 },
        links: [{ context: LINKED, attributes: { reason: "retry of" } }],
      });
      span.addEvent("cache miss", { key: "cart" });
      span.recordException(new Error("card declined"));
      span.setStatus({ code: SpanStatusCode.ERROR, message: "payment failed" });
      span.end();
    }

    // one row per surface, so that a surface the policy is no longer applied to fails its own row
    const SURFACES: [string, (span: ReadableSpan) => unknown, unknown, unknown][] = [
      ["its name, as span.name", (span) => span.name, "[probe:span.name] checkout", "checkout"],
      [
        "its attributes, as span",
        (span) => span.attributes,
        { customer: "[probe:span] erin", attempt: 2 },
        { customer: "erin", attempt: 2 },
      ],
      [
        "its status text, as span.status",
        (span) => span.status,
        { code: SpanStatusCode.ERROR, message: "[probe:span.status] payment failed" },
        { code: SpanStatusCode.ERROR, message: "payment failed" },
      ],
      [
        "an event's name and attributes, as span.event",
        (span) => ({ name: span.events[0]?.name, attributes: span.events[0]?.attributes }),
        { name: "[probe:span.event] cache miss", attributes: { key: "[probe:span.event] cart" } },
        { name: "cache miss", attributes: { key: "cart" } },
      ],
      [
        // an event like any other: the probe marks its message, as it would any attribute
        "a recorded exception, as span.event",
        (span) => ({
          name: span.events[1]?.name,
          type: span.events[1]?.attributes?.["exception.type"],
          message: span.events[1]?.attributes?.["exception.message"],
        }),
        {
          name: "[probe:span.event] exception",
          type: "[probe:span.event] Error",
          message: "[probe:span.event] card declined",
        },
        { name: "exception", type: "Error", message: "card declined" },
      ],
      [
        "a link's attributes, as link",
        (span) => span.links[0]?.attributes,
        { reason: "[probe:link] retry of" },
        { reason: "retry of" },
      ],
    ];

    it.each(SURFACES)("is applied to %s", async (_surface, read, marked) => {
      telemetry = startTestTelemetry({ redaction: createProbePolicy() });
      emitOnEverySurface();
      const spans = await telemetry.spans();
      expect(spans).toHaveLength(1);
      expect(read(spans[0]!)).toEqual(marked);
    });

    it.each(SURFACES)("redaction: false exports %s as given", async (_surface, read, _marked, given) => {
      telemetry = startTestTelemetry({ redaction: false });
      emitOnEverySurface();
      const spans = await telemetry.spans();
      expect(spans).toHaveLength(1);
      expect(read(spans[0]!)).toEqual(given);
    });

    it("is not handed a status that has no message", async () => {
      const calls: ProbeCall[] = [];
      telemetry = startTestTelemetry({ redaction: createProbePolicy(calls) });
      const tracer = trace.getTracer("kit");
      tracer.startSpan("unset").end();
      const ok = tracer.startSpan("ok");
      ok.setStatus({ code: SpanStatusCode.OK });
      ok.end();
      const failed = tracer.startSpan("failed");
      failed.setStatus({ code: SpanStatusCode.ERROR });
      failed.end();

      const spans = await telemetry.spans();
      expect(spans.map((span) => span.status)).toEqual([
        { code: SpanStatusCode.UNSET },
        { code: SpanStatusCode.OK },
        { code: SpanStatusCode.ERROR },
      ]);
      expect(calls.filter((call) => call.fn === "spanStatus")).toEqual([]);

      // and the recording would have shown a call: one with a message is handed over
      const withMessage = tracer.startSpan("with a message");
      withMessage.setStatus({ code: SpanStatusCode.ERROR, message: "payment failed" });
      withMessage.end();
      await telemetry.spans();
      expect(calls.filter((call) => call.fn === "spanStatus")).toEqual([
        { fn: "spanStatus", given: "payment failed" },
      ]);
    });

    it("drops the status message and keeps the code when the policy returns undefined for it", async () => {
      telemetry = startTestTelemetry({
        redaction: { ...createProbePolicy(), spanStatus: () => undefined },
      });
      emitOnEverySurface();
      const [span] = await telemetry.spans();
      expect(span!.status).toEqual({ code: SpanStatusCode.ERROR });
      expect("message" in span!.status).toBe(false);
    });

    // The kit's start() takes one span exporter and puts it behind the simple processor; the batch
    // processor is reached only with a real endpoint (the subprocess tests), and no public API adds
    // a processor to a provider that is already built. So the next tests build a provider of their
    // own from the SDK's parts and put the preset's wrapper in it themselves.
    function providerWith(...spanProcessors: SpanProcessor[]): TracerProvider {
      return new TracerProvider({ spanProcessors });
    }
    const wrapped = (exporter: SpanExporter): SpanExporter =>
      wrapSpanExporter(exporter, {
        diagnostics: createDiagnostics(),
        redactor: createRedactor(createProbePolicy()),
      });

    it("leaves the span itself as it was: an exporter beside the wrapped one receives the original", async () => {
      const behindThePolicy = new InMemorySpanExporter();
      const beside = new InMemorySpanExporter();
      // the wrapped one first: were the span changed for it, the one after it would see the change
      const provider = providerWith(
        new SimpleSpanProcessor({ exporter: wrapped(behindThePolicy) }),
        new SimpleSpanProcessor({ exporter: beside }),
      );
      try {
        emitOnEverySurface(provider.getTracer("kit"));
        await provider.forceFlush();

        const [marked] = behindThePolicy.getFinishedSpans();
        const [original] = beside.getFinishedSpans();
        for (const [surface, read, whenMarked, given] of SURFACES) {
          expect(read(marked!), surface).toEqual(whenMarked);
          expect(read(original!), surface).toEqual(given);
        }
        // what the policy has no say in is read through to the same span
        expect(marked!.spanContext()).toEqual(original!.spanContext());
        expect(marked!.events.map((event) => event.time)).toEqual(original!.events.map((event) => event.time));
        expect(marked!.links.map((link) => link.context)).toEqual([LINKED]);
        expect(marked!.startTime).toBe(original!.startTime);
      } finally {
        await provider.shutdown();
      }
    });

    it.each<[string, (exporter: SpanExporter) => SpanProcessor]>([
      ["simple", (exporter) => new SimpleSpanProcessor({ exporter })],
      ["batch", (exporter) => new BatchSpanProcessor({ exporter })],
    ])("is applied the same under the %s span processor", async (_which, processorFor) => {
      const exporter = new InMemorySpanExporter();
      const provider = providerWith(processorFor(wrapped(exporter)));
      try {
        emitOnEverySurface(provider.getTracer("kit"));
        await provider.forceFlush();
        const spans = exporter.getFinishedSpans();
        expect(spans).toHaveLength(1);
        for (const [surface, read, marked] of SURFACES) {
          expect(read(spans[0]!), surface).toEqual(marked);
        }
      } finally {
        await provider.shutdown();
      }
    });
  });

  describe("a policy that misbehaves", () => {
    const broken = (
      how: Partial<Record<"text" | "attributes", () => unknown>>,
    ): RedactionPolicy => ({ ...createProbePolicy(), ...(how as Partial<RedactionPolicy>) });
    const failing = (): never => {
      throw new Error("the policy is broken SENTINEL");
    };

    const WRONG_KIND = /did not return an attribute set for resource/;
    /** what a promise library hands out: a plain object whose then() is another promise's */
    const adapterOf = (promise: Promise<unknown>) => ({ then: promise.then.bind(promise) });
    /** a thenable written by hand that calls its first argument, later, without checking it is one */
    const laterUnchecked = () => ({
      then: (resolve: () => void) => {
        setImmediate(() => {
          resolve();
        });
      },
    });
    // a policy written `async` that then fails: the promise it returns rejects
    const rejecting = () => Promise.reject(new Error("the policy is broken SENTINEL"));

    /** run `act` and report any rejection nobody handled, by the time the event loop has turned */
    async function unhandledDuring(act: () => void | Promise<void>): Promise<unknown[]> {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        await act();
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      return unhandled;
    }

    it.each([
      ["throws", failing, /the policy is broken/],
      ["returns nothing", () => undefined, WRONG_KIND],
      ["returns a promise", () => Promise.resolve({}), WRONG_KIND],
      ["returns a promise that rejects", rejecting, WRONG_KIND],
      ["returns a string", () => "abc", WRONG_KIND],
      ["returns an array", () => [], WRONG_KIND],
      ["returns a Map", () => new Map(), WRONG_KIND],
      // a promise in all but name: an object literal with a then(), here one that passes a rejection on
      ["returns an object with a then() that rejects", () => adapterOf(rejecting()), WRONG_KIND],
      ["returns an object with a then() that settles later, calling back unchecked", laterUnchecked, WRONG_KIND],
    ])("on the resource (%s): start() fails and gives back what it had registered", async (_how, attributes, message) => {
      // an ignored setting, so that diagnostics hold something when the start fails
      vi.stubEnv("OTEL_BSP_SCHEDULE_DELAY", "not-a-number");
      const events: DiagnosticsEvent[] = [];
      let sinkCreated = false;
      const unhandled = await unhandledDuring(() => {
        expect(() =>
          startTestTelemetry({
            redaction: broken({ attributes }),
            diagnostics: () => {
              sinkCreated = true;
              return (event) => events.push(event);
            },
          }),
        ).toThrow(message);
      });
      expect(unhandled).toEqual([]);

      expect(getStatus().state).toBe("not-started");
      expect(trace.getTracer("t").startSpan("s").isRecording()).toBe(false);
      // the failure was inside the part of start() that undoes itself: what diagnostics held was
      // delivered (the sink was created), and the logger and error handler are no longer the preset's
      expect(sinkCreated).toBe(true);
      expect(events.map((event) => event.message)).toEqual([
        expect.stringContaining("OTEL_BSP_SCHEDULE_DELAY"),
      ]);
      vi.unstubAllEnvs();
      const before = events.length;
      diag.warn("after the failed start");
      globalErrorHandler(new Error("after the failed start"));
      expect(events).toHaveLength(before);
      const said: string[] = [];
      const note = (...parts: unknown[]) => said.push(parts.map(String).join(" "));
      // installing a logger over one that was left behind makes the API warn the new one of it
      diag.setLogger({ error: note, warn: note, info: note, debug: note, verbose: note }, DiagLogLevel.WARN);
      expect(said).toEqual([]);
      diag.disable();

      telemetry = startTestTelemetry();
      trace.getTracer("t").startSpan("works").end();
      expect((await telemetry.spans()).map((s) => s.name)).toEqual(["works"]);
    });

    describe("a promise for a resource attribute's value", () => {
      const failingLater = () => Promise.reject(new Error("SENTINEL"));

      it("is refused from the caller as a configuration problem, every one named, before anything is registered", async () => {
        // an ignored setting too: were anything registered before the refusal, this would be held and then delivered
        vi.stubEnv("OTEL_BSP_SCHEDULE_DELAY", "not-a-number");
        let sinkCreated = false;
        let problems: readonly string[] = [];
        const unhandled = await unhandledDuring(() => {
          try {
            startTestTelemetry({
              diagnostics: () => {
                sinkCreated = true;
                return () => undefined;
              },
              // several at once: one under a key the preset drops, one under a long standard key,
              // and one written by hand as a thenable
              resourceAttributes: {
                first: failingLater() as never,
                second: failingLater() as never,
                "host.name": failingLater() as never,
                "deployment.environment.name": failingLater() as never,
                handWritten: laterUnchecked() as never,
              },
            });
          } catch (error) {
            if (!(error instanceof PresetConfigError)) throw error;
            problems = error.problems;
          }
        });
        expect(problems).toEqual(
          ["first", "second", "host.name", "deployment.environment.name", "handWritten"].map(
            (key) => `a resource attribute is a promise, not a value: "${key}"`,
          ),
        );
        expect(unhandled).toEqual([]);
        expect(sinkCreated).toBe(false);
        expectNoDiagLoggerLeftBehind();
        expect(getStatus().state).toBe("not-started");
      });

      it("is heard on a second start(), which is refused for being a second one", async () => {
        telemetry = startTestTelemetry();
        const unhandled = await unhandledDuring(() => {
          expect(() =>
            startTestTelemetry({ resourceAttributes: { later: failingLater() as never } }),
          ).toThrow(/start\(\) was already called/);
        });
        expect(unhandled).toEqual([]);
        expect(getStatus().state).toBe("running");
        // and what was running is as it was: it still exports
        trace.getTracer("t").startSpan("after the refused second start").end();
        expect((await telemetry.spans()).map((span) => span.name)).toEqual([
          "after the refused second start",
        ]);
      });

      class Attributes {
        a = "b";
      }
      it.each([
        ["a promise for the set", () => Promise.resolve({ a: "b" })],
        ["an array", () => ["a"]],
        ["a Map", () => new Map([["a", "b"]])],
        ["a string", () => "a=b"],
        ["null", () => null],
        // these two are objects of values, read only in part before: their inherited members were not exported
        ["a class instance", () => new Attributes()],
        ["an object made from another", () => Object.create({ a: "b" }) as object],
      ])("refuses resourceAttributes that is %s, in validation", (_what, given) => {
        vi.stubEnv("OTEL_BSP_SCHEDULE_DELAY", "not-a-number");
        let sinkCreated = false;
        const problems = (() => {
          try {
            startTestTelemetry({
              resourceAttributes: given() as never,
              diagnostics: () => {
                sinkCreated = true;
                return () => undefined;
              },
            });
          } catch (error) {
            if (!(error instanceof PresetConfigError)) throw error;
            return error.problems;
          }
          return [];
        })();
        expect(problems).toEqual([
          "resourceAttributes must be a plain object of attribute values, such as an object literal",
        ]);
        expect(sinkCreated).toBe(false);
        expectNoDiagLoggerLeftBehind();
        expect(getStatus().state).toBe("not-started");
      });

      it.each([
        ["an object literal", () => ({ kept: "v" })],
        ["a null-prototype object", () => Object.assign(Object.create(null) as object, { kept: "v" })],
        ["a plain object from another realm", () => runInNewContext('({ kept: "v" })') as object],
        ["a frozen object", () => Object.freeze({ kept: "v" })],
      ])("accepts resourceAttributes that is %s", async (_what, given) => {
        telemetry = startTestTelemetry({ resourceAttributes: given() as never });
        trace.getTracer("t").startSpan("s").end();
        expect((await telemetry.spans())[0]!.resource.attributes.kept).toBe("v");
      });

      it("names a refused key so that it cannot pass for another line, and marks one it had to cut", () => {
        const long = "k".repeat(81);
        const exact = "e".repeat(80);
        // the cut falls inside a pair: the half that is left is escaped, not printed as half a character
        const split = `${"s".repeat(79)}\u{1f600}`;
        const problems = (() => {
          try {
            startTestTelemetry({
              resourceAttributes: {
                'line one\n  - forged: all is well "quoted"': Promise.resolve("a") as never,
                "with space: and colon": Promise.resolve("b") as never,
                [long]: Promise.resolve("c") as never,
                [exact]: Promise.resolve("d") as never,
                "back\\slash": Promise.resolve("e") as never,
                [split]: Promise.resolve("f") as never,
              },
            });
          } catch (error) {
            return error instanceof PresetConfigError ? error.problems : [];
          }
          return [];
        })();
        expect(problems).toEqual([
          'a resource attribute is a promise, not a value: "line one\\n  - forged: all is well \\"quoted\\""',
          'a resource attribute is a promise, not a value: "with space: and colon"',
          `a resource attribute is a promise, not a value: "${"k".repeat(80)}…"`,
          `a resource attribute is a promise, not a value: "${exact}"`,
          'a resource attribute is a promise, not a value: "back\\\\slash"',
          `a resource attribute is a promise, not a value: "${"s".repeat(79)}\\ud83d…"`,
        ]);
        // each problem is one line of the message, whatever the key held
        expect(problems.every((problem) => !problem.includes("\n"))).toBe(true);
      });

      it("names each of them in the problems", () => {
        const problems = (() => {
          try {
            startTestTelemetry({
              resourceAttributes: { first: Promise.resolve("a") as never, second: Promise.resolve("b") as never },
            });
          } catch (error) {
            return error instanceof PresetConfigError ? error.problems : [];
          }
          return [];
        })();
        expect(problems).toEqual([
          'a resource attribute is a promise, not a value: "first"',
          'a resource attribute is a promise, not a value: "second"',
        ]);
      });

      it.each([
        [
          "the environment sets the same key",
          () => vi.stubEnv("OTEL_RESOURCE_ATTRIBUTES", "team=from-env"),
          // (built when the test runs: a promise made while the table is read would reject unheard)
          () => ({ resourceAttributes: { team: failingLater() as never } }),
        ],
        [
          "a dedicated option sets the same key",
          () => undefined,
          () => ({ serviceVersion: "1.2.3", resourceAttributes: { "service.version": failingLater() as never } }),
        ],
      ])("is refused, and heard, even when %s and would have replaced it", async (_when, arrange, options) => {
        arrange();
        const unhandled = await unhandledDuring(() => {
          const attempt = () => startTestTelemetry(options());
          expect(attempt).toThrow(PresetConfigError);
          expect(attempt).toThrow("a resource attribute is a promise, not a value");
        });
        expect(unhandled).toEqual([]);
        expect(getStatus().state).toBe("not-started");
      });

      it("is heard when the SDK is disabled and start() returns without validating anything", async () => {
        vi.stubEnv("OTEL_SDK_DISABLED", "true");
        const unhandled = await unhandledDuring(() => {
          expect(
            start({
              serviceName: "disabled",
              instrumentations: false,
              loaderHook: false,
              resourceAttributes: { later: failingLater() as never },
            }).state,
          ).toBe("disabled");
        });
        expect(unhandled).toEqual([]);
      });

      it("is heard when the configuration is refused for something else as well", async () => {
        vi.stubEnv("OTEL_TRACES_SAMPLER", "nonsense");
        const unhandled = await unhandledDuring(() => {
          const problems = (() => {
            try {
              startTestTelemetry({ resourceAttributes: { later: failingLater() as never } });
            } catch (error) {
              return error instanceof PresetConfigError ? error.problems : [];
            }
            return [];
          })();
          expect(problems).toEqual([
            expect.stringContaining("OTEL_TRACES_SAMPLER"),
            'a resource attribute is a promise, not a value: "later"',
          ]);
        });
        expect(unhandled).toEqual([]);
      });

      it("is refused when the policy returns one, every one of them heard", async () => {
        const unhandled = await unhandledDuring(() => {
          expect(() =>
            startTestTelemetry({
              redaction: broken({
                // the first key has a line break and a quote in it: it is named escaped, as the caller's are
                attributes: () => ({ 'first\n"key"': failingLater(), second: failingLater(), kept: "a value" }),
              }),
            }),
          ).toThrow(
            new TypeError(
              'a resource attribute the redaction policy returned is a promise, not a value: "first\\n\\"key\\""',
            ),
          );
        });
        expect(unhandled).toEqual([]);
        expect(getStatus().state).toBe("not-started");
      });
    });

    it("on the resource: an attribute whose value merely has a `then` that is not a function is a value", async () => {
      telemetry = startTestTelemetry({ resourceAttributes: { odd: { then: "not a function" } as never } });
      trace.getTracer("t").startSpan("s").end();
      expect((await telemetry.spans())[0]!.resource.attributes.odd).toEqual({ then: "not a function" });
    });

    it.each([
      ["a null-prototype object", () => Object.assign(Object.create(null) as object, { kept: "v" })],
      ["a plain object from another realm", () => runInNewContext('({ kept: "v" })') as object],
      ["a frozen object", () => Object.freeze({ kept: "v" })],
    ])("accepts %s as an attribute set", (_what, result) => {
      const redactor = createRedactor({ ...createProbePolicy(), attributes: result as never });
      expect({ ...redactor.attributes("resource", { given: "x" }) }).toEqual({ kept: "v" });
    });

    it("lets go of a promise by giving it two functions, since a thenable written by hand may call either unchecked", () => {
      const given: string[] = [];
      const redactor = createRedactor({
        ...createProbePolicy(),
        attributes: () =>
          ({
            then: (onFulfilled: unknown, onRejected: unknown) => {
              given.push(typeof onFulfilled, typeof onRejected);
            },
          }) as never,
      });
      expect(() => redactor.attributes("resource", {})).toThrow(WRONG_KIND);
      expect(given).toEqual(["function", "function"]);
    });

    it.each([
      ["returns nothing", () => undefined],
      ["returns a promise that rejects", rejecting],
      ["returns an object with a then()", () => adapterOf(rejecting())],
    ])("on a scope's attributes (%s): the log record is not exported, and that is reported", async (_how, attributes) => {
      const events: DiagnosticsEvent[] = [];
      telemetry = startTestTelemetry({
        diagnostics: () => (event) => events.push(event),
        // the resource is an attribute set too: let that through, break only the scope's
        // (and leave diagnostics text as it is, so the report can be read back below)
        redaction: {
          ...createProbePolicy(),
          text: (_surface, value) => value,
          attributes: (surface, given) =>
            surface === "scope" ? (attributes() as never) : given,
        },
      });
      const running = telemetry;
      const unhandled = await unhandledDuring(async () => {
        // only a logger's scope can carry attributes in this version of the API
        logs.getLogger("a scope", undefined, { attributes: { k: "v" } }).emit({ body: "a line" });
        await expect(running.logRecords()).resolves.toEqual([]);
      });
      expect(unhandled).toEqual([]);
      expect(events.map((event) => [event.message, event.fields?.signal])).toContainEqual([
        "logs export failed",
        "logs",
      ]);
    });

    it("hands the policy a copy of an attribute set, so one that changes its argument changes nothing", () => {
      const given = Object.freeze({ kept: "as it was" });
      const redactor = createRedactor({
        ...createProbePolicy(),
        attributes: (_surface, attributes) => {
          attributes.kept = "changed by the policy";
          attributes.added = "by the policy";
          return { returned: true };
        },
      });
      // a frozen input would make the assignment throw if the policy were handed the original
      expect(redactor.attributes("scope", given)).toEqual({ returned: true });
      expect(given).toEqual({ kept: "as it was" });
    });

    const NOT_A_STRING = /did not return a string for scope.name/;
    it.each([
      ["throws", failing, /the policy is broken/],
      ["returns nothing", () => undefined, NOT_A_STRING],
      ["returns a promise", () => Promise.resolve("text"), NOT_A_STRING],
      ["returns a promise that rejects", rejecting, NOT_A_STRING],
      ["returns a number", () => 7, NOT_A_STRING],
    ])("on a scope name (%s): the export fails closed and is reported", async (_how, text, message) => {
      const events: DiagnosticsEvent[] = [];
      telemetry = startTestTelemetry({
        diagnostics: () => (event) => events.push(event),
        // diagnostics text passes the same function: let that through, break only the scope name
        redaction: {
          ...createProbePolicy(),
          text: (surface, value) =>
            surface === "scope.name" ? (text() as unknown as string) : value,
        },
      });
      const pending = telemetry;
      const unhandled = await unhandledDuring(async () => {
        trace.getTracer("a scope").startSpan("s").end();
        // asked for at once, while the export is still pending: the flush that would have
        // delivered the span rejects, so the record did not go out as it was
        await expect(pending.spans()).rejects.toThrow(message);
      });
      expect(unhandled).toEqual([]);
      expect(events.map((event) => [event.message, event.fields?.signal])).toContainEqual([
        "traces export failed",
        "traces",
      ]);
      expect(JSON.stringify(events)).not.toContain("SENTINEL");
    });

    it.each([
      ["throws", failing],
      ["returns nothing", () => undefined],
      ["returns a promise that rejects", rejecting],
    ])("on a scope name (%s): metrics and log records fail closed too, each reported for its signal", async (_how, text) => {
      const events: DiagnosticsEvent[] = [];
      telemetry = startTestTelemetry({
        diagnostics: () => (event) => events.push(event),
        redaction: {
          ...createProbePolicy(),
          text: (surface, value) =>
            surface === "scope.name" ? (text() as unknown as string) : value,
        },
      });
      const running = telemetry;
      const unhandled = await unhandledDuring(async () => {
        metrics.getMeter("a scope").createCounter("c").add(1);
        logs.getLogger("a scope").emit({ body: "a line" });
        // for these two signals the SDK swallows the failed export: the read resolves, with nothing in it
        await expect(running.metrics()).resolves.toEqual([]);
        await expect(running.logRecords()).resolves.toEqual([]);
      });
      expect(unhandled).toEqual([]);
      expect(events.map((event) => event.message)).toEqual(
        expect.arrayContaining(["metrics export failed", "logs export failed"]),
      );
      expect(JSON.stringify(events)).not.toContain("SENTINEL");
    });

    it.each([
      ["throws", failing],
      ["returns nothing", () => undefined],
      ["returns a promise", () => Promise.resolve("text")],
      ["returns a promise that rejects", rejecting],
    ])("on a diagnostics text (%s): the text is withheld and diagnostics keep reporting", async (_how, text) => {
      const events: DiagnosticsEvent[] = [];
      telemetry = startTestTelemetry({
        diagnostics: () => (event) => events.push(event),
        redaction: broken({ text }),
      });
      const unhandled = await unhandledDuring(() => {
        diag.warn("first SENTINEL");
        diag.warn("second SENTINEL");
      });
      expect(unhandled).toEqual([]);
      expect(events.map((event) => event.message)).toEqual([
        "(text withheld: the redaction policy threw)",
        "(text withheld: the redaction policy threw)",
      ]);
    });

    // everything but the one function under test passes through, so the span reaches that function
    // (the resource and the scope are attribute sets and texts too) and the report can be read back
    const passing: RedactionPolicy = {
      ...createProbePolicy(),
      text: (_surface, value) => value,
      attributes: (_surface, given) => given,
    };
    const textFor = (surface: string, result: () => unknown): Partial<RedactionPolicy> => ({
      text: (given, value) => (given === surface ? (result() as string) : value),
    });
    const attributesFor = (surface: string, result: () => unknown): Partial<RedactionPolicy> => ({
      attributes: (given, attributes) => (given === surface ? (result() as never) : attributes),
    });
    const status = (result: () => unknown): Partial<RedactionPolicy> => ({ spanStatus: result as never });
    const event = (result: () => unknown): Partial<RedactionPolicy> => ({ spanEvent: result as never });

    const NO_NAME = /did not return a string for span.name/;
    const NO_SPAN_SET = /did not return an attribute set for span/;
    const NO_LINK_SET = /did not return an attribute set for link/;
    const NO_STATUS = /spanStatus\(\) did not return a string or undefined/;
    const NO_EVENT = /spanEvent\(\) did not return an event/;
    it.each<[string, Partial<RedactionPolicy>, RegExp]>([
      ["a span's name is a number", textFor("span.name", () => 7), NO_NAME],
      ["a span's name is nothing", textFor("span.name", () => undefined), NO_NAME],
      ["a span's name is a promise that rejects", textFor("span.name", rejecting), NO_NAME],
      ["a span's attributes are nothing", attributesFor("span", () => undefined), NO_SPAN_SET],
      ["a span's attributes are an array", attributesFor("span", () => []), NO_SPAN_SET],
      ["a span's attributes are a promise that rejects", attributesFor("span", rejecting), NO_SPAN_SET],
      ["a link's attributes are a string", attributesFor("link", () => "abc"), NO_LINK_SET],
      ["a link's attributes are an object with a then()", attributesFor("link", () => adapterOf(rejecting())), NO_LINK_SET],
      ["the status text is a number", status(() => 7), NO_STATUS],
      ["the status text is null", status(() => null), NO_STATUS],
      ["the status text is a promise", status(() => Promise.resolve("text")), NO_STATUS],
      ["the status text is a promise that rejects", status(rejecting), NO_STATUS],
      ["an event is nothing", event(() => undefined), NO_EVENT],
      ["an event is a string", event(() => "cache miss"), NO_EVENT],
      ["an event is a promise that rejects", event(rejecting), NO_EVENT],
      [
        "an event is an object with a then()",
        event(() => Object.assign(adapterOf(rejecting()), { name: "n", attributes: {} })),
        NO_EVENT,
      ],
      ["an event's name is a number", event(() => ({ name: 7, attributes: {} })), NO_EVENT],
      ["an event's name is a promise that rejects", event(() => ({ name: rejecting(), attributes: {} })), NO_EVENT],
      ["an event has no attributes", event(() => ({ name: "n" })), NO_EVENT],
      ["an event's attributes are an array", event(() => ({ name: "n", attributes: [] })), NO_EVENT],
      ["an event's attributes are a promise that rejects", event(() => ({ name: "n", attributes: rejecting() })), NO_EVENT],
      ["the policy throws for an event", event(failing), /the policy is broken/],
    ])("on a span (%s): the export fails closed and is reported once", async (_how, how, message) => {
      const events: DiagnosticsEvent[] = [];
      telemetry = startTestTelemetry({
        diagnostics: () => (reported) => events.push(reported),
        redaction: { ...passing, ...how },
      });
      const pending = telemetry;
      const unhandled = await unhandledDuring(async () => {
        const span = trace.getTracer("kit").startSpan("checkout", {
          attributes: { customer: "erin" },
          links: [
            {
              context: { traceId: "0af7651916cd43dd8448eb211c80319c", spanId: "b7ad6b7169203331", traceFlags: 1 },
              attributes: { reason: "retry of" },
            },
          ],
        });
        span.addEvent("cache miss", { key: "cart" });
        span.setStatus({ code: SpanStatusCode.ERROR, message: "payment failed" });
        span.end();
        // the flush that would have delivered the span rejects: it did not go out as it was
        await expect(pending.spans()).rejects.toThrow(message);
      });
      expect(unhandled).toEqual([]);
      expect(events.map((reported) => [reported.message, reported.fields?.signal])).toEqual([
        ["traces export failed", "traces"],
      ]);
      expect(JSON.stringify(events)).not.toContain("SENTINEL");
    });
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

  const SDK_SAID =
    "export failed for frank.sentinel@example.com at https://u:SENTINEL-PW@h.example/p?t=SENTINEL-Q";

  it("passes diagnostics text to the named policy as its own surface, after cutting URLs", () => {
    const events: { message: string }[] = [];
    telemetry = startTestTelemetry({
      diagnostics: () => (event) => events.push(event),
      redaction: createProbePolicy(),
    });
    // any SDK component may log through the API's diagnostics logger
    diag.warn(SDK_SAID);
    expect(events.map((e) => e.message)).toEqual([
      "[probe:diagnostics] export failed for frank.sentinel@example.com at https://h.example",
    ]);
  });

  it("still cuts URLs in diagnostics under redaction: false, and changes nothing else", () => {
    const events: { message: string }[] = [];
    telemetry = startTestTelemetry({ diagnostics: () => (event) => events.push(event) });
    diag.warn(SDK_SAID);
    expect(events.map((e) => e.message)).toEqual([
      "export failed for frank.sentinel@example.com at https://h.example",
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

  // every way a test's exporter can sit on the object it is handed in: the rule has no way round it
  const HOLDERS: [string, (key: string, exporter: unknown) => object][] = [
    ["an own property", (key, exporter) => ({ [key]: exporter })],
    ["a property of its prototype", (key, exporter) => Object.create({ [key]: exporter }) as object],
    [
      "an accessor on its class",
      (key, exporter) => {
        class Kit {}
        Object.defineProperty(Kit.prototype, key, { get: () => exporter });
        return new Kit();
      },
    ],
    [
      "a property that is not enumerable",
      (key, exporter) => Object.defineProperty({}, key, { value: exporter, enumerable: false }),
    ],
  ];
  const EXPORTERS: [string, () => unknown][] = [
    ["spanExporter", () => new InMemorySpanExporter()],
    ["metricExporter", () => new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE)],
    ["logRecordExporter", () => new InMemoryLogRecordExporter()],
  ];

  describe.each(EXPORTERS)("a test's %s with no redaction named", (key, create) => {
    it.each(HOLDERS)("is refused when it is %s, and nothing is registered", async (_where, hold) => {
      // an ignored setting: were anything registered before the refusal, it would be held and then delivered
      vi.stubEnv("OTEL_BSP_SCHEDULE_DELAY", "not-a-number");
      let sinkCreated = false;
      expect(() =>
        start({
          serviceName: "no-policy",
          instrumentations: false,
          loaderHook: false,
          diagnostics: () => {
            sinkCreated = true;
            return () => undefined;
          },
          testExporters: hold(key, create()),
        }),
      ).toThrow(/no redaction policy: pass `redaction` to start\(\)/);

      expect(getStatus().state).toBe("not-started");
      expect(trace.getTracer("t").startSpan("s").isRecording()).toBe(false);
      // refused in validation: diagnostics were never set up, so nothing could be reported through them
      expect(sinkCreated).toBe(false);
      expectNoDiagLoggerLeftBehind();
      vi.unstubAllEnvs();
      // and the next start is not blocked by it
      telemetry = startTestTelemetry();
      trace.getTracer("t").startSpan("works").end();
      expect((await telemetry.spans()).map((s) => s.name)).toEqual(["works"]);
    });
  });

  it("asks for no policy when every test exporter is undefined and nothing is exported", async () => {
    try {
      expect(
        start({
          serviceName: "nothing-exported",
          instrumentations: false,
          loaderHook: false,
          diagnostics: () => () => undefined,
          testExporters: { spanExporter: undefined, metricExporter: undefined, logRecordExporter: undefined },
        }).signals,
      ).toMatchObject({
        traces: { enabled: false, reason: "no-endpoint" },
        metrics: { enabled: false, reason: "no-endpoint" },
        logs: { enabled: false, reason: "not-requested" },
      });
    } finally {
      await resetForTesting();
    }
  });

  describe("the settings handed to the auto-instrumentation bundle", () => {
    const logsOn: Pick<ResolvedConfig, "signals"> = {
      signals: { ...OFF, logs: { enabled: true, url: "http://c:4318/v1/logs", protocol: "http/protobuf" } },
    };
    const logsOff: Pick<ResolvedConfig, "signals"> = { signals: OFF };
    const of = (settings: InstrumentationConfigMap, name: string): unknown =>
      settings[`@opentelemetry/instrumentation-${name}` as keyof InstrumentationConfigMap];

    it.each([
      ["the logs signal is on", logsOn, {}, true],
      ["a test supplies a log exporter", logsOff, { logRecordExporter: new InMemoryLogRecordExporter() }, true],
      ["logs are off and no test log exporter", logsOff, {}, false],
      // another signal's test exporter does not turn log sending on
      ["logs are off and a test supplies a span exporter", logsOff, { spanExporter: new InMemorySpanExporter() }, false],
    ])("send log lines over OTLP exactly when logs are exported: %s", (_when, config, test, sent) => {
      const settings = instrumentationConfigFor(config, test);
      // the setting is always written, in one direction or the other: left out, the logger's own default is to send
      for (const logger of ["pino", "winston", "bunyan"]) {
        expect(of(settings, logger), logger).toEqual({ disableLogSending: !sent });
      }
    });

    it("turn the three noisy instrumentations off", () => {
      const settings = instrumentationConfigFor(logsOff, {});
      for (const noisy of ["fs", "net", "dns"]) {
        expect(of(settings, noisy), noisy).toEqual({ enabled: false });
      }
    });

    it("keep the preset's other settings for an instrumentation the caller overrides in part", () => {
      const settings = instrumentationConfigFor(logsOff, {}, {
        "@opentelemetry/instrumentation-pino": { logKeys: { traceId: "tid", spanId: "sid", traceFlags: "tf" } },
        "@opentelemetry/instrumentation-fs": { enabled: true },
        "@opentelemetry/instrumentation-http": { enabled: false },
        // a setting given as undefined is one not given
        "@opentelemetry/instrumentation-winston": { disableLogSending: undefined },
        // and so is an instrumentation named with no settings at all (`cond ? {…} : undefined`)
        "@opentelemetry/instrumentation-bunyan": undefined,
        "@opentelemetry/instrumentation-dns": undefined,
      });
      expect(of(settings, "pino")).toEqual({
        disableLogSending: true,
        logKeys: { traceId: "tid", spanId: "sid", traceFlags: "tf" },
      });
      // a setting the caller names wins; an instrumentation the preset has no settings for is taken as given
      expect(of(settings, "fs")).toEqual({ enabled: true });
      expect(of(settings, "http")).toEqual({ enabled: false });
      expect(of(settings, "net")).toEqual({ enabled: false });
      expect(of(settings, "winston")).toEqual({ disableLogSending: true });
      expect(of(settings, "bunyan")).toEqual({ disableLogSending: true });
      expect(of(settings, "dns")).toEqual({ enabled: false });
    });

    it.each([
      ["off while logs are exported", logsOn, true],
      ["on while logs are not exported", logsOff, false],
    ])("let the caller turn log sending %s, for one logger alone", (_which, config, disableLogSending) => {
      const settings = instrumentationConfigFor(config, {}, {
        "@opentelemetry/instrumentation-pino": { disableLogSending },
      });
      expect(of(settings, "pino")).toEqual({ disableLogSending });
      expect(of(settings, "winston")).toEqual({ disableLogSending: !disableLogSending });
    });

    it.each([
      ["false", false],
      ["a string", "off"],
      ["an array", [1]],
      ["null", null],
    ])("refuse settings for an instrumentation that are %s, where they would otherwise be ignored", (_what, settings) => {
      const attempt = () =>
        instrumentationConfigFor(logsOff, {}, {
          "@opentelemetry/instrumentation-http": settings as never,
        });
      expect(attempt).toThrow(PresetConfigError);
      expect(attempt).toThrow(
        'instrumentations: the settings for "@opentelemetry/instrumentation-http" must be an object, such as { enabled: false }',
      );
    });

    it("names the instrumentation so that a line break in the name cannot pass for another problem", () => {
      const attempt = () =>
        instrumentationConfigFor(logsOff, {}, { 'a\n  - forged "problem"': false } as never);
      expect(attempt).toThrow(
        'instrumentations: the settings for "a\\n  - forged \\"problem\\"" must be an object, such as { enabled: false }',
      );
    });

    it.each([
      ["null", null],
      ["true", true],
      ["a string", "off"],
      ["an array", []],
    ])("start() refuses an instrumentations option that is %s, as a configuration error, and registers nothing", async (_what, instrumentations) => {
      const events: DiagnosticsEvent[] = [];
      const attempt = () =>
        startTestTelemetry({
          instrumentations: instrumentations as never,
          diagnostics: () => (event) => events.push(event),
        });
      expect(attempt).toThrow(PresetConfigError);
      expect(attempt).toThrow("instrumentations must be an object of settings by instrumentation name, or false for none");

      expect(getStatus().state).toBe("not-started");
      // found after diagnostics were installed, and undone: neither the logger nor the handler is the preset's
      const before = events.length;
      diag.warn("after the refused start");
      globalErrorHandler(new Error("after the refused start"));
      expect(events).toHaveLength(before);
      const said: string[] = [];
      const note = (...parts: unknown[]) => said.push(parts.map(String).join(" "));
      diag.setLogger({ error: note, warn: note, info: note, debug: note, verbose: note }, DiagLogLevel.WARN);
      expect(said).toEqual([]);
      diag.disable();
      telemetry = startTestTelemetry();
      trace.getTracer("t").startSpan("works").end();
      expect((await telemetry.spans()).map((s) => s.name)).toEqual(["works"]);
    });

    // batch G4a, with the instrumentation fixture. Nothing in this batch observes the settings a real
    // start() hands to the bundle, so that fixture has to show all of: start() passes these settings
    // (built from the resolved configuration and the test exporters it read) to the bundle; a pino
    // line arrives at /v1/logs when logs are exported and does not when they are not; and a caller's
    // override of one pino setting leaves that unchanged.
    it.todo("a real start() hands these settings to the bundle: a pino line is sent over OTLP exactly when logs are exported");
  });

  describe("where exporters are made, the no-policy rule is asked a second time", () => {
    const context = () => ({
      diagnostics: createDiagnostics(),
      redactor: createRedactor(false),
    });
    const NO_POLICY = "an exporter would be built with no redaction named";

    it.each(EXPORTERS)("refuses to build around a test's %s when none was named", (key, create) => {
      expect(() => buildPipelines({ signals: OFF } as never, { [key]: create() }, context(), false)).toThrow(NO_POLICY);
    });

    it.each(["traces", "metrics", "logs"] as const)("refuses to build for %s enabled alone when none was named", (signal) => {
      const signals = {
        ...OFF,
        [signal]: { enabled: true, url: `http://127.0.0.1:9/v1/${signal}`, protocol: "http/protobuf" },
      };
      // refused before any exporter is made: nothing is opened towards that address
      expect(() => buildPipelines({ signals } as never, {}, context(), false)).toThrow(NO_POLICY);
    });

    it("builds when one was named, and when there is nothing to export", () => {
      const built = buildPipelines({ signals: OFF } as never, { spanExporter: new InMemorySpanExporter() }, context(), true);
      expect(built.signals.traces).toEqual({ enabled: true, destination: "test" });
      expect(buildPipelines({ signals: OFF } as never, {}, context(), false).signals).toEqual(OFF);
    });
  });

  it.each([
    ["spanExporter", "traces"],
    ["metricExporter", "metrics"],
    ["logRecordExporter", "logs"],
  ] as const)("reads a test's %s once, from wherever the test held it, and uses that one", (key, signal) => {
    const create = EXPORTERS.find(([name]) => name === key)![1];
    const first = create();
    let reads = 0;
    class Kit {}
    Object.defineProperty(Kit.prototype, key, {
      // the one it is given first is the one used: a different one on any later read
      get: () => (reads++ === 0 ? first : create()),
    });
    const status = start({
      serviceName: "held-on-a-class",
      instrumentations: false,
      loaderHook: false,
      redaction: false,
      testExporters: new Kit(),
    });
    expect(reads).toBe(1);
    expect(status.signals[signal]).toEqual({ enabled: true, destination: "test" });
  });

  it("exports through the exporter it read from an accessor", async () => {
    const exporter = new InMemorySpanExporter();
    class Kit {
      get spanExporter() {
        return exporter;
      }
    }
    start({
      serviceName: "held-on-a-class",
      instrumentations: false,
      loaderHook: false,
      redaction: false,
      testExporters: new Kit(),
    });
    trace.getTracer("t").startSpan("through the accessor").end();
    await forceFlush();
    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual(["through the accessor"]);
  });

  it("the kit refuses a redaction that is null, as start() does, and does not read it as false", () => {
    expect(() => startTestTelemetry({ redaction: null as never })).toThrow("redaction must be a policy or false");
  });

  it("refuses a second start while one is running", () => {
    telemetry = startTestTelemetry();
    expect(() => startTestTelemetry()).toThrow(/start\(\) was already called/);
  });
});
