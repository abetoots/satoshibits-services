/**
 * A start() that fails part of the way through gives back what it registered,
 * and only that: a provider, context manager or propagator someone else
 * registered first is left exactly as it was. A failure that cannot be fully
 * undone makes every later start() refuse.
 *
 * Failures are injected at each stage by making one of the API's own
 * registration functions throw, after it has registered (the SDK registers
 * the instrumentations first, then the context manager, the propagator and
 * the meter, tracer and logger providers), or by an instrumentation whose
 * enable() throws.
 */

import { context, diag, DiagLogLevel, metrics, propagation, ProxyTracerProvider, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { globalErrorHandler, W3CTraceContextPropagator } from "@opentelemetry/core";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { AggregationTemporality, InMemoryMetricExporter } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiagnosticsEvent } from "../../preset/diagnostics.mjs";
import type { Instrumentation, InstrumentationConfig } from "@opentelemetry/instrumentation";

import { getStatus, start } from "../../preset.mjs";
import { instrumentationsForTesting, resetForTesting } from "../../preset/runtime.mjs";
import { startTestTelemetry } from "../../testing/in-memory.mjs";

afterEach(async () => {
  instrumentationsForTesting(undefined);
  await resetForTesting();
});

/** an instrumentation that says whether it is enabled; enabled when made, as the bundle's are */
class ProbeInstrumentation implements Instrumentation {
  readonly instrumentationName = "probe";
  readonly instrumentationVersion = "1.0.0";
  enabled = true;
  constructor(
    private readonly faults: { enable?: boolean; disable?: boolean } = {},
  ) {}
  enable(): void {
    if (this.faults.enable) throw new Error("enable failed");
    this.enabled = true;
  }
  disable(): void {
    if (this.faults.disable) throw new Error("disable failed");
    this.enabled = false;
  }
  // the providers and settings are of no interest to the probe
  setTracerProvider(): void {
    return undefined;
  }
  setMeterProvider(): void {
    return undefined;
  }
  setConfig(): void {
    return undefined;
  }
  getConfig(): InstrumentationConfig {
    // `enabled: false` makes registerInstrumentations call enable(), which is how a fault there is reached
    return { enabled: !this.faults.enable };
  }
}

/** the logs API's own proxy (not exported by name), which it hands out while no provider is registered */
const unregisteredLogs = (provider: object): boolean =>
  provider.constructor.name === "ProxyLoggerProvider";

/** what the API holds: providers, context manager and propagator, by identity */
function registrations() {
  const tracerProvider = trace.getTracerProvider();
  return {
    // one proxy is handed out whether or not a provider is registered: what it delegates to is
    tracerProvider:
      tracerProvider instanceof ProxyTracerProvider ? tracerProvider.getDelegate() : tracerProvider,
    meterProvider: metrics.getMeterProvider(),
    // with none registered the logs API hands out a proxy of its own, a new one after each disable()
    loggerProvider: unregisteredLogs(logs.getLoggerProvider()) ? "none registered" : logs.getLoggerProvider(),
    // the API has no public reader for these two
    contextManager: (context as unknown as { _getContextManager: () => unknown })._getContextManager(),
    propagator: (propagation as unknown as { _getGlobalPropagator: () => unknown })._getGlobalPropagator(),
  };
}

const startOptions = (events: DiagnosticsEvent[] = []) => ({
  serviceName: "rollback",
  instrumentations: false as const,
  loaderHook: false,
  redaction: false as const,
  diagnostics: () => (event: DiagnosticsEvent) => events.push(event),
  // all three, so that every provider is registered
  testExporters: {
    spanExporter: new InMemorySpanExporter(),
    metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    logRecordExporter: new InMemoryLogRecordExporter(),
  },
});

const INJECTED = "injected failure";

/** make one registration function register, then throw */
function failAfter<T extends object, K extends keyof T>(api: T, name: K) {
  const original = (api[name] as (...args: unknown[]) => unknown).bind(api);
  return vi.spyOn(api, name as never).mockImplementation(((...args: unknown[]) => {
    const registered = original(...args);
    void registered;
    throw new Error(INJECTED);
  }) as never);
}

/** nothing of the preset's left on the diagnostics API or the error handler */
function expectDiagnosticsGivenBack(events: DiagnosticsEvent[]): void {
  const said: string[] = [];
  const note = (...parts: unknown[]) => said.push(parts.map(String).join(" "));
  // installing a logger over one left behind makes the API warn the new one of it
  diag.setLogger({ error: note, warn: note, info: note, debug: note, verbose: note }, DiagLogLevel.WARN);
  expect(said).toEqual([]);
  diag.disable();
  const before = events.length;
  globalErrorHandler(new Error("after the failed start"));
  expect(events).toHaveLength(before);
}

describe("a start() that fails part of the way", () => {
  const stages: [string, () => void][] = [
    ["the instrumentations (one fails to enable)", () => undefined],
    ["the context manager", () => failAfter(context, "setGlobalContextManager")],
    ["the propagator", () => failAfter(propagation, "setGlobalPropagator")],
    ["the meter provider", () => failAfter(metrics, "setGlobalMeterProvider")],
    ["the tracer provider", () => failAfter(trace, "setGlobalTracerProvider")],
    ["the logger provider, the last", () => failAfter(logs, "setGlobalLoggerProvider")],
  ];

  it.each(stages)("after %s: leaves nothing of its own registered, and can be started again", (stage, inject) => {
    const enabledBefore = new ProbeInstrumentation();
    const failing = stage.startsWith("the instrumentations")
      ? [enabledBefore, new ProbeInstrumentation({ enable: true })]
      : [enabledBefore];
    instrumentationsForTesting(failing);
    inject();
    const before = registrations();
    const events: DiagnosticsEvent[] = [];

    expect(() => start(startOptions(events))).toThrow(
      stage.startsWith("the instrumentations") ? "enable failed" : INJECTED,
    );
    vi.restoreAllMocks();

    expect(registrations()).toEqual(before);
    for (const [key, value] of Object.entries(registrations())) {
      expect(value, key).toBe(before[key as keyof typeof before]);
    }
    expect(enabledBefore.enabled).toBe(false);
    expect(trace.getTracer("t").startSpan("s").isRecording()).toBe(false);
    expectDiagnosticsGivenBack(events);
    expect(getStatus().state).toBe("not-started");

    // and it can be started again
    instrumentationsForTesting(undefined);
    const telemetry = startTestTelemetry();
    trace.getTracer("t").startSpan("after").end();
    return telemetry.spans().then((spans) => {
      expect(spans.map((s) => s.name)).toEqual(["after"]);
    });
  });

  it("leaves a tracer provider, context manager and propagator registered by someone else exactly as they were", () => {
    const foreignTracerProvider = new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter: new InMemorySpanExporter() })],
    });
    const foreignContextManager = new AsyncLocalStorageContextManager().enable();
    const foreignPropagator = new W3CTraceContextPropagator();
    trace.setGlobalTracerProvider(foreignTracerProvider);
    context.setGlobalContextManager(foreignContextManager);
    propagation.setGlobalPropagator(foreignPropagator);
    const before = registrations();
    const probe = new ProbeInstrumentation();
    instrumentationsForTesting([probe]);
    // watched, called through: what the API answered the SDK
    const tracerRegistration = vi.spyOn(trace, "setGlobalTracerProvider");
    failAfter(logs, "setGlobalLoggerProvider");

    expect(() => start(startOptions())).toThrow(INJECTED);

    // the API refused the SDK's tracer provider: the foreign one was never displaced
    expect(tracerRegistration.mock.results.map((result): unknown => result.value)).toEqual([false]);
    vi.restoreAllMocks();
    expect(registrations().tracerProvider).toBe(foreignTracerProvider);
    expect(registrations().contextManager).toBe(foreignContextManager);
    expect(registrations().propagator).toBe(foreignPropagator);
    // and what the preset did register is gone
    expect(metrics.getMeterProvider()).toBe(before.meterProvider);
    expect(registrations().loggerProvider).toBe(before.loggerProvider);
    expect(probe.enabled).toBe(false);
  });

  it("when it cannot be fully undone, says so, and every later start() refuses", () => {
    instrumentationsForTesting([new ProbeInstrumentation({ disable: true })]);
    failAfter(logs, "setGlobalLoggerProvider");
    const events: DiagnosticsEvent[] = [];

    expect(() => start(startOptions(events))).toThrow(INJECTED);
    vi.restoreAllMocks();
    expect(events.map((event) => event.message)).toContainEqual(
      expect.stringContaining("could not be fully undone"),
    );

    instrumentationsForTesting(undefined);
    expect(() => start(startOptions())).toThrow(
      /an earlier start\(\) failed and could not be fully undone/,
    );
    expect(() => startTestTelemetry()).toThrow(/could not be fully undone/);
  });
});

describe("the test kit's stop()", () => {
  it("leaves the API free: anyone can register providers, a context manager and a propagator after it", async () => {
    const telemetry = startTestTelemetry();
    await telemetry.stop();

    const tracerProvider = new TracerProvider();
    const contextManager = new AsyncLocalStorageContextManager().enable();
    const propagator = new W3CTraceContextPropagator();
    expect(trace.setGlobalTracerProvider(tracerProvider)).toBe(true);
    expect(context.setGlobalContextManager(contextManager)).toBe(true);
    expect(propagation.setGlobalPropagator(propagator)).toBe(true);
    expect(registrations().tracerProvider).toBe(tracerProvider);
    expect(registrations().contextManager).toBe(contextManager);
    expect(registrations().propagator).toBe(propagator);
  });
});
