/**
 * A start() that fails part of the way through gives back what it registered,
 * and only that: a provider, context manager or propagator someone else
 * registered first is left exactly as it was. A failure that cannot be fully
 * undone makes every later start() refuse.
 *
 * Failures are injected at each stage by making one of the API's own
 * registration functions throw, after it has registered (the SDK registers
 * the instrumentations first, then the context manager, the propagator and
 * the meter, tracer and logger providers; the preset installs the loader
 * hook last), or by an instrumentation whose enable() throws.
 */

import { context, diag, DiagLogLevel, metrics, propagation, ProxyTracerProvider, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { globalErrorHandler, W3CTraceContextPropagator } from "@opentelemetry/core";
import { InMemoryLogRecordExporter, LoggerProvider } from "@opentelemetry/sdk-logs";
import { AggregationTemporality, InMemoryMetricExporter, MeterProvider } from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire, syncBuiltinESMExports } from "node:module";

import type { DiagnosticsEvent } from "../../preset/diagnostics.mjs";
import type { Instrumentation, InstrumentationConfig } from "@opentelemetry/instrumentation";

import { getStatus, start } from "../../preset.mjs";
import { instrumentationsForTesting, resetForTesting } from "../../preset/runtime.mjs";
import { startTestTelemetry } from "../../testing/in-memory.mjs";
import { startOtlpSink } from "../../testing/otlp-sink.mjs";

afterEach(async () => {
  vi.unstubAllEnvs();
  instrumentationsForTesting(undefined);
  await resetForTesting();
});

const sleep = (millis: number) => new Promise((resolve) => setTimeout(resolve, millis));

/** an instrumentation that says whether it is enabled; enabled when made, as the bundle's are */
class ProbeInstrumentation implements Instrumentation {
  readonly instrumentationName = "probe";
  readonly instrumentationVersion = "1.0.0";
  enabled = true;
  readonly enableError = new Error("enable failed");
  constructor(private readonly faults: { enable?: boolean; disable?: boolean } = {}) {}
  enable(): void {
    if (this.faults.enable) throw this.enableError;
    this.enabled = true;
  }
  disable(): void {
    if (this.faults.disable) throw new Error("disable failed SENTINEL");
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

const startOptions = (events: DiagnosticsEvent[] = [], loaderHook = false) => ({
  serviceName: "rollback",
  instrumentations: false as const,
  loaderHook,
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

/** make one registration function register, then throw `error` */
function failAfter<T extends object, K extends keyof T>(api: T, name: K, error = new Error(INJECTED)) {
  const original = (api[name] as (...args: unknown[]) => unknown).bind(api);
  return vi.spyOn(api, name as never).mockImplementation(((...args: unknown[]) => {
    original(...args);
    throw error;
  }) as never);
}

/** make Node's loader-hook registration throw `error` until the returned function is called */
function failLoaderHook(error: Error): () => void {
  const nodeModule = createRequire(import.meta.url)("node:module") as { register: unknown };
  const original = nodeModule.register;
  nodeModule.register = () => {
    throw error;
  };
  // the ESM bindings of a built-in follow its CommonJS exports only when told to
  syncBuiltinESMExports();
  return () => {
    nodeModule.register = original;
    syncBuiltinESMExports();
  };
}

/** a stage, and how to make the start fail just after it with `error`; returns the error start() throws */
type Stage = [string, (error: Error, probes: ProbeInstrumentation[]) => { thrown: Error; loaderHook?: boolean }];
const stages: Stage[] = [
  [
    "the instrumentations (one fails to enable)",
    (_error, probes) => {
      const failing = new ProbeInstrumentation({ enable: true });
      probes.push(failing);
      return { thrown: failing.enableError };
    },
  ],
  ["the context manager", (error) => (failAfter(context, "setGlobalContextManager", error), { thrown: error })],
  ["the propagator", (error) => (failAfter(propagation, "setGlobalPropagator", error), { thrown: error })],
  ["the meter provider", (error) => (failAfter(metrics, "setGlobalMeterProvider", error), { thrown: error })],
  ["the tracer provider", (error) => (failAfter(trace, "setGlobalTracerProvider", error), { thrown: error })],
  ["the logger provider", (error) => (failAfter(logs, "setGlobalLoggerProvider", error), { thrown: error })],
  [
    "the loader hook, the last",
    (error) => {
      restoreLoaderHook = failLoaderHook(error);
      return { thrown: error, loaderHook: true };
    },
  ],
];
let restoreLoaderHook: (() => void) | undefined;
afterEach(() => {
  restoreLoaderHook?.();
  restoreLoaderHook = undefined;
});

/** start, failing just after `stage`; returns the probes */
function failAt(stage: Stage, events: DiagnosticsEvent[] = []): ProbeInstrumentation[] {
  const probes = [new ProbeInstrumentation()];
  const { thrown, loaderHook } = stage[1](new Error(INJECTED), probes);
  instrumentationsForTesting(probes);
  let caught: unknown;
  try {
    start(startOptions(events, loaderHook));
  } catch (error) {
    caught = error;
  }
  // the caller gets the very error the stage failed with
  expect(caught).toBe(thrown);
  vi.restoreAllMocks();
  restoreLoaderHook?.();
  restoreLoaderHook = undefined;
  instrumentationsForTesting(undefined);
  return probes;
}

/** someone else's tracer, meter and logger providers, context manager and propagator */
function registerForeign() {
  const foreign = {
    tracerProvider: new TracerProvider({
      spanProcessors: [new SimpleSpanProcessor({ exporter: new InMemorySpanExporter() })],
    }),
    meterProvider: new MeterProvider(),
    loggerProvider: new LoggerProvider(),
    contextManager: new AsyncLocalStorageContextManager().enable(),
    propagator: new W3CTraceContextPropagator(),
  };
  trace.setGlobalTracerProvider(foreign.tracerProvider);
  metrics.setGlobalMeterProvider(foreign.meterProvider);
  logs.setGlobalLoggerProvider(foreign.loggerProvider);
  context.setGlobalContextManager(foreign.contextManager);
  propagation.setGlobalPropagator(foreign.propagator);
  return foreign;
}

/** the undo's own reports: what it said about itself */
const undoReports = (events: DiagnosticsEvent[]) =>
  events.filter((event) => event.message.includes("failed start"));

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
  it.each(stages)("after %s: leaves nothing of its own registered, and can be started again", async (...stage) => {
    const before = registrations();
    const events: DiagnosticsEvent[] = [];

    const probes = failAt(stage, events);

    for (const [key, value] of Object.entries(registrations())) {
      expect(value, key).toBe(before[key as keyof typeof before]);
    }
    // every one built, the one that failed to enable included
    expect(probes.map((probe) => probe.enabled)).toEqual(probes.map(() => false));
    expect(trace.getTracer("t").startSpan("s").isRecording()).toBe(false);
    expectDiagnosticsGivenBack(events);
    expect(undoReports(events)).toEqual([]);
    expect(getStatus().state).toBe("not-started");
    expect(getStatus().loaderHook).toBe(false);

    // and it can be started again
    const telemetry = startTestTelemetry();
    trace.getTracer("t").startSpan("after").end();
    expect((await telemetry.spans()).map((s) => s.name)).toEqual(["after"]);
  });

  it.each(stages)(
    "after %s: leaves providers, a context manager and a propagator registered by someone else exactly as they were",
    (...stage) => {
      const foreign = registerForeign();

      const probes = failAt(stage);

      for (const [key, value] of Object.entries(registrations())) {
        expect(value, key).toBe(foreign[key as keyof typeof foreign]);
      }
      expect(probes.map((probe) => probe.enabled)).toEqual(probes.map(() => false));
    },
  );

  it("when an instrumentation cannot be disabled, says so once, without the error's text, and every later start() refuses", () => {
    const events: DiagnosticsEvent[] = [];
    const stuck = new ProbeInstrumentation({ disable: true });
    instrumentationsForTesting([stuck]);
    failAfter(logs, "setGlobalLoggerProvider");

    expect(() => start(startOptions(events))).toThrow(INJECTED);
    vi.restoreAllMocks();
    instrumentationsForTesting(undefined);

    expect(undoReports(events).map((event) => event.message)).toEqual([
      expect.stringContaining("could not be fully undone"),
    ]);
    // each message, and each field as it would print (JSON shows an error in a field as {})
    for (const event of events) {
      expect(event.message).not.toContain("SENTINEL");
      for (const value of Object.values(event.fields ?? {})) expect(String(value)).not.toContain("SENTINEL");
    }
    expect(() => start(startOptions())).toThrow(/an earlier start\(\) failed and could not be fully undone/);
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

describe("what a failed start built", () => {
  it("is stopped as well as deregistered: its metric reader exports no more", async () => {
    const sink = await startOtlpSink();
    try {
      vi.stubEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", `${sink.url}/v1/metrics`);
      vi.stubEnv("OTEL_METRIC_EXPORT_INTERVAL", "100");
      vi.stubEnv("OTEL_METRIC_EXPORT_TIMEOUT", "100");
      // after the meter provider is registered: a counter on it, so the reader has something to send
      const original = trace.setGlobalTracerProvider.bind(trace);
      vi.spyOn(trace, "setGlobalTracerProvider").mockImplementation((provider) => {
        original(provider);
        metrics.getMeter("m").createCounter("c").add(1);
        throw new Error(INJECTED);
      });

      expect(() =>
        start({
          serviceName: "rollback",
          instrumentations: false,
          loaderHook: false,
          redaction: false,
          diagnostics: () => () => undefined,
        }),
      ).toThrow(INJECTED);
      vi.restoreAllMocks();

      // the positive control: the reader did export (its final collection, as the undo stops it)
      await sink.waitFor(() => sink.requestsTo("/v1/metrics").length > 0, 5000);
      // then the count settles: read it until it stops changing, over several export intervals
      let count = -1;
      for (let round = 0; round < 10 && count !== sink.requestsTo("/v1/metrics").length; round++) {
        count = sink.requestsTo("/v1/metrics").length;
        await sleep(350);
      }
      expect(sink.requestsTo("/v1/metrics").length).toBe(count);
      await sleep(350);
      expect(sink.requestsTo("/v1/metrics").length).toBe(count);
    } finally {
      await sink.close();
    }
  });
});

describe("the API's readers for the context manager and the propagator", () => {
  it("exist on the installed API and return what was set (the undo relies on them)", () => {
    const contextManager = new AsyncLocalStorageContextManager().enable();
    const propagator = new W3CTraceContextPropagator();
    context.setGlobalContextManager(contextManager);
    propagation.setGlobalPropagator(propagator);

    const api = { context, propagation } as unknown as {
      context: { _getContextManager?: unknown };
      propagation: { _getGlobalPropagator?: unknown };
    };
    expect(typeof api.context._getContextManager).toBe("function");
    expect(typeof api.propagation._getGlobalPropagator).toBe("function");
    expect(registrations().contextManager).toBe(contextManager);
    expect(registrations().propagator).toBe(propagator);
  });

  it.each([
    ["context manager", context, "_getContextManager"],
    ["propagator", propagation, "_getGlobalPropagator"],
  ] as const)(
    "when the %s reader is missing: start() throws its own failure, leaves that one alone and says so",
    (what, api, reader) => {
      const before = registrations();
      // as an API version without the reader would be
      Object.defineProperty(api, reader, { value: undefined, configurable: true });
      const events: DiagnosticsEvent[] = [];
      try {
        failAfter(logs, "setGlobalLoggerProvider");
        expect(() => start(startOptions(events))).toThrow(INJECTED);
        vi.restoreAllMocks();
      } finally {
        delete (api as unknown as Record<string, unknown>)[reader];
      }
      const key = what === "context manager" ? "contextManager" : "propagator";
      // the SDK's is still registered: it could not be told from someone else's
      expect(registrations()[key]).not.toBe(before[key]);
      // what could be checked was undone
      expect(registrations().meterProvider).toBe(before.meterProvider);
      expect(undoReports(events).map((event) => event.message)).toEqual([
        expect.stringContaining(`could not check the ${what}`),
      ]);
    },
  );
});
