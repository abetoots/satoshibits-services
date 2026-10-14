/**
 * The preset's runtime: `start()`, `forceFlush()`, `shutdown()`, `getStatus()`.
 *
 * One module-level handle per process. `start()` resolves and validates the
 * whole configuration before any side effect, then builds every pipeline
 * explicitly and hands NodeSDK the plural processor and reader lists, so
 * NodeSDK's own environment-driven defaults (an exporter to localhost) can
 * never apply.
 */

import {
  context,
  diag,
  metrics,
  propagation,
  ProxyTracerProvider,
  trace,
} from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { loggingErrorHandler, setGlobalErrorHandler } from "@opentelemetry/core";
import {
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  AlwaysOffSampler,
  AlwaysOnSampler,
  BatchSpanProcessor,
  NoopSpanProcessor,
  ParentBasedSampler,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace";
import { createRequire, register } from "node:module";

import type {
  PresetConfigOptions,
  ResolvedConfig,
  Signal,
  SignalOffReason,
} from "./config.mjs";
import type { Diagnostics, DiagnosticsSink } from "./diagnostics.mjs";
import type { ExporterContext } from "./exporters.mjs";
import type { InstrumentationConfigMap } from "@opentelemetry/auto-instrumentations-node";
import type { Instrumentation } from "@opentelemetry/instrumentation";
import type {
  LogRecordExporter,
  LogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import type {
  MetricReader,
  PushMetricExporter,
} from "@opentelemetry/sdk-metrics";
import type {
  Sampler,
  SpanExporter,
  SpanProcessor,
} from "@opentelemetry/sdk-trace";

import {
  isRatioSampler,
  PresetConfigError,
  resolveConfig,
  SIGNALS,
} from "./config.mjs";
import { createDiagnostics, createRateLimiter, quotedKey } from "./diagnostics.mjs";
import {
  createLogRecordExporter,
  createMetricExporter,
  createSpanExporter,
  ExportFailureLog,
  exportFailure,
  FAILURE_REPORT_INTERVAL_MILLIS,
  hostOf,
  TelemetryExportError,
  wasReportedByExporter,
  wrapLogRecordExporter,
  wrapMetricExporter,
  wrapSpanExporter,
} from "./exporters.mjs";
import { createRedactor, isPlainObject } from "./redaction.mjs";
import { buildResource, deferredAttributes } from "./resource.mjs";

/**
 * Exporters a test supplies in place of the network. Each sits behind the
 * same wrapper as a real exporter, so a test sees what a backend would see.
 * A signal with a test exporter is on, whatever the environment says.
 */
export interface TestExporters {
  spanExporter?: SpanExporter;
  metricExporter?: PushMetricExporter;
  logRecordExporter?: LogRecordExporter;
}

export interface StartOptions extends PresetConfigOptions {
  /**
   * Per-instrumentation settings, merged setting by setting over the preset's defaults (the Node
   * auto-instrumentation bundle with `fs`, `net` and `dns` off; pino, winston
   * and bunyan lines are sent over OTLP when the logs signal is on, and not
   * otherwise). `false` installs no instrumentation.
   */
  instrumentations?: InstrumentationConfigMap | false;
  /**
   * Register the ESM loader hook that lets ESM imports be instrumented
   * (default true). Turn it off inside a test runner, which has loaders of
   * its own.
   */
  loaderHook?: boolean;
  /**
   * Returns where diagnostics go (default: JSON lines on stderr). Called
   * once, lazily, after instrumentation is installed, so it may import the
   * application's logger.
   */
  diagnostics?: () => DiagnosticsSink;
  testExporters?: TestExporters;
}

export type SignalStatus =
  | {
      enabled: true;
      /** `test` when a test exporter replaced the network */
      destination: "otlp" | "test";
      /** host and port only; never the path, query or credentials */
      endpoint?: string;
      protocol?: string;
    }
  | { enabled: false; reason: SignalOffReason };

export interface PresetStatus {
  state: "not-started" | "running" | "disabled" | "shut-down";
  /** whether this process has the ESM loader hook registered by the preset */
  loaderHook: boolean;
  serviceName?: string;
  /** e.g. `parentbased_traceidratio(0.1)` */
  sampler?: string;
  signals: Record<Signal, SignalStatus>;
}

/** a span or log record processor, or a metric reader: what forceFlush and shutdown act on */
interface Part {
  signal: Signal;
  forceFlush: () => Promise<void>;
  shutdown: () => Promise<void>;
}

const partsOf = (signal: Signal, parts: Omit<Part, "signal">[]): Part[] =>
  parts.map((part) => ({
    signal,
    forceFlush: () => part.forceFlush(),
    shutdown: () => part.shutdown(),
  }));

interface Handle {
  status: PresetStatus;
  sdk?: NodeSDK;
  parts: Part[];
  failures?: ExportFailureLog;
  /** the first shutdown() call's promise, which every later call returns */
  shutdown?: Promise<void>;
  /** the forceFlush() running now, which a call made meanwhile joins */
  flushing?: Promise<void>;
  /**
   * the parts' own work for the latest forceFlush(), until it settles: a call that timed out
   * has given up waiting, but its parts are still flushing, and the batch log processor
   * answers any call made meanwhile at once, before sending anything
   */
  partsFlushing?: Promise<unknown>;
}

const HOOK_FLAG = Symbol.for("@satoshibits/observability.loader-hook");
const DEFAULT_TIMEOUT_MILLIS = 10_000;
/** the longest delay a Node timer holds; a longer one fires after 1 ms */
const MAX_TIMER_MILLIS = 2 ** 31 - 1;

let handle: Handle | undefined;

/**
 * Instrumentations a test adds to those start() builds, to see what happens
 * to them when a start fails. Not part of the public entry: only this
 * package's tests reach it.
 */
let testInstrumentations: Instrumentation[] | undefined;

/**
 * Set when a failed start() could not give back everything it registered.
 * What is left (an instrumentation still patching a module, say) could
 * double up with a second start's, so none is allowed.
 */
let undoFailed = false;

/** what the API holds, by identity; the context manager and propagator have no public reader */
function registered() {
  const tracerProvider = trace.getTracerProvider();
  return {
    // the API hands out one proxy whether or not a provider is registered: what it delegates to is
    tracerProvider:
      tracerProvider instanceof ProxyTracerProvider ? tracerProvider.getDelegate() : tracerProvider,
    meterProvider: metrics.getMeterProvider(),
    loggerProvider: logs.getLoggerProvider(),
    contextManager: (context as unknown as { _getContextManager: () => unknown })._getContextManager(),
    propagator: (propagation as unknown as { _getGlobalPropagator: () => unknown })._getGlobalPropagator(),
  };
}

/**
 * Give back what a failed start registered, and only that: a registration
 * that is not what it was before the start is the preset's (the API refuses
 * to replace one that someone else made first, so theirs is unchanged and
 * left alone). Every instrumentation is disabled: they patch modules as
 * they are made, before anything is registered. Returns whether all of it
 * could be undone.
 */
function undoStart(
  before: ReturnType<typeof registered>,
  instrumentations: Instrumentation[],
): boolean {
  let complete = true;
  const attempt = (undo: () => void) => {
    try {
      undo();
    } catch {
      complete = false;
    }
  };
  for (const instrumentation of instrumentations) attempt(() => instrumentation.disable());
  const now = registered();
  const disable: Record<keyof typeof now, () => void> = {
    tracerProvider: () => trace.disable(),
    meterProvider: () => metrics.disable(),
    loggerProvider: () => logs.disable(),
    contextManager: () => context.disable(),
    propagator: () => propagation.disable(),
  };
  for (const key of Object.keys(disable) as (keyof typeof now)[]) {
    if (now[key] !== before[key]) attempt(disable[key]);
  }
  return complete;
}

/** test support: add these instrumentations to every start() until called again with undefined */
export function instrumentationsForTesting(added: Instrumentation[] | undefined): void {
  testInstrumentations = added;
}

const allOff = (reason: SignalOffReason): Record<Signal, SignalStatus> => ({
  traces: { enabled: false, reason },
  metrics: { enabled: false, reason },
  logs: { enabled: false, reason },
});

const loaderHookInstalled = (): boolean =>
  (globalThis as Record<symbol, unknown>)[HOOK_FLAG] === true;

function installLoaderHook(): void {
  if (loaderHookInstalled()) return;
  // resolved from this package, so the application need not depend on it
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
  (globalThis as Record<symbol, unknown>)[HOOK_FLAG] = true;
}

function buildSampler(sampler: ResolvedConfig["sampler"]): Sampler {
  switch (sampler.type) {
    case "always_on":
      return new AlwaysOnSampler();
    case "always_off":
      return new AlwaysOffSampler();
    case "traceidratio":
      return new TraceIdRatioBasedSampler(sampler.ratio);
    case "parentbased_always_on":
      return new ParentBasedSampler({ root: new AlwaysOnSampler() });
    case "parentbased_always_off":
      return new ParentBasedSampler({ root: new AlwaysOffSampler() });
    case "parentbased_traceidratio":
      return new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(sampler.ratio),
      });
  }
}

const describeSampler = (sampler: ResolvedConfig["sampler"]): string =>
  isRatioSampler(sampler.type)
    ? `${sampler.type}(${sampler.ratio})`
    : sampler.type;

/**
 * The preset's settings for the auto-instrumentation bundle, before the
 * caller's own are merged over them.
 */
export function defaultInstrumentationConfig(
  logsExported: boolean,
): InstrumentationConfigMap {
  return {
    // noisy, and rarely what anyone looks at
    "@opentelemetry/instrumentation-fs": { enabled: false },
    "@opentelemetry/instrumentation-net": { enabled: false },
    "@opentelemetry/instrumentation-dns": { enabled: false },
    // trace ids are always added to log lines. Sending the lines over OTLP follows
    // the logs signal: with it off there is nowhere for them to go
    "@opentelemetry/instrumentation-pino": { disableLogSending: !logsExported },
    "@opentelemetry/instrumentation-winston": { disableLogSending: !logsExported },
    "@opentelemetry/instrumentation-bunyan": { disableLogSending: !logsExported },
  };
}

/**
 * The caller's settings over the preset's, per setting: overriding one
 * setting of an instrumentation keeps the preset's others for it.
 */
export function mergeInstrumentationConfig(
  defaults: InstrumentationConfigMap,
  overrides: InstrumentationConfigMap,
): InstrumentationConfigMap {
  const merged: Record<string, object> = { ...defaults };
  for (const [name, settings] of Object.entries(overrides) as [string, unknown][]) {
    // an instrumentation named with no settings (`cond ? {…} : undefined`) is one not named
    if (settings === undefined) continue;
    if (!isPlainObject(settings)) {
      // `false` for "off" is a natural guess, and would otherwise be ignored without a word
      throw new PresetConfigError([
        // the name is a key the caller wrote in code, not a value from the environment
        `instrumentations: the settings for ${quotedKey(name)} must be an object, such as { enabled: false }`,
      ]);
    }
    // a setting given as undefined is one not given: the preset's stays
    merged[name] = { ...merged[name], ...defined(settings) };
  }
  return merged as InstrumentationConfigMap;
}

/** what the auto-instrumentation bundle is given: the preset's settings for this start, then the caller's */
export function instrumentationConfigFor(
  config: Pick<ResolvedConfig, "signals">,
  test: TestExporters,
  overrides: InstrumentationConfigMap = {},
): InstrumentationConfigMap {
  const logsExported =
    config.signals.logs.enabled || test.logRecordExporter !== undefined;
  return mergeInstrumentationConfig(
    defaultInstrumentationConfig(logsExported),
    overrides,
  );
}

function buildInstrumentations(
  option: StartOptions["instrumentations"],
  config: ResolvedConfig,
  test: TestExporters,
): Instrumentation[] {
  if (option === false) return [];
  if (option !== undefined && !isPlainObject(option)) {
    throw new PresetConfigError([
      "instrumentations must be an object of settings by instrumentation name, or false for none",
    ]);
  }
  // loaded on demand: the bundle pulls in every instrumentation package, which
  // a disabled or instrumentation-free start should not pay for
  const { getNodeAutoInstrumentations } = createRequire(import.meta.url)(
    "@opentelemetry/auto-instrumentations-node",
  ) as typeof import("@opentelemetry/auto-instrumentations-node");
  return getNodeAutoInstrumentations(
    instrumentationConfigFor(config, test, option),
  );
}

/** drop undefined members: the upstream constructors tell "unset" from "set to undefined" */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, member]) => member !== undefined),
  ) as T;
}

interface Pipelines {
  spanProcessors: SpanProcessor[];
  metricReaders: MetricReader[];
  logRecordProcessors: LogRecordProcessor[];
  signals: Record<Signal, SignalStatus>;
}

/**
 * The exporters a test supplied, each read once. Everything that asks
 * "is there a test exporter" asks this object, so the answer that passed
 * validation is the one the pipelines are built from, wherever on the
 * caller's object (itself, its prototype, an accessor) the exporter was.
 */
function readTestExporters(given: TestExporters | undefined): TestExporters {
  return defined({
    spanExporter: given?.spanExporter,
    metricExporter: given?.metricExporter,
    logRecordExporter: given?.logRecordExporter,
  });
}

/** exported for its test: the rule it asks a second time cannot be reached through start() */
export function buildPipelines(
  config: ResolvedConfig,
  test: TestExporters,
  base: Omit<ExporterContext, "endpointHost">,
  redactionNamed: boolean,
): Pipelines {
  // Validation already refused a start that exports with no `redaction` named. This is the
  // same rule asked a second time, at the one place exporters are made, so that a change to
  // either side that let them disagree would stop here and not export as given.
  const exporting =
    Object.keys(test).length > 0 ||
    SIGNALS.some((signal) => config.signals[signal].enabled);
  if (exporting && !redactionNamed) {
    throw new Error(
      "@satoshibits/observability: an exporter would be built with no redaction named",
    );
  }
  const signals = {} as Record<Signal, SignalStatus>;
  const spanProcessors: SpanProcessor[] = [];
  const metricReaders: MetricReader[] = [];
  const logRecordProcessors: LogRecordProcessor[] = [];

  const statusOf = (signal: Signal, hasTestExporter: boolean): SignalStatus => {
    const resolved = config.signals[signal];
    if (hasTestExporter) return { enabled: true, destination: "test" };
    if (!resolved.enabled) return resolved;
    return {
      enabled: true,
      destination: "otlp",
      endpoint: hostOf(resolved.url),
      protocol: resolved.protocol,
    };
  };
  const contextFor = (signal: Signal): ExporterContext => {
    const resolved = config.signals[signal];
    return {
      ...base,
      endpointHost: resolved.enabled ? hostOf(resolved.url) : undefined,
    };
  };

  // traces
  signals.traces = statusOf("traces", test.spanExporter !== undefined);
  if (test.spanExporter !== undefined) {
    spanProcessors.push(
      new SimpleSpanProcessor({
        exporter: wrapSpanExporter(test.spanExporter, base),
      }),
    );
  } else if (config.signals.traces.enabled) {
    spanProcessors.push(
      new BatchSpanProcessor({
        exporter: wrapSpanExporter(
          createSpanExporter(config.signals.traces, config.headers),
          contextFor("traces"),
        ),
        ...defined(config.spanBatch),
      }),
    );
  } else {
    // NodeSDK registers a tracer provider only when it has a span processor.
    // One that exports nothing keeps spans, context and trace ids working.
    spanProcessors.push(new NoopSpanProcessor());
  }

  // metrics
  signals.metrics = statusOf("metrics", test.metricExporter !== undefined);
  if (test.metricExporter !== undefined) {
    metricReaders.push(
      new PeriodicExportingMetricReader({
        exporter: wrapMetricExporter(test.metricExporter, base),
        // a test collects with forceFlush(); the timer should never fire first
        exportIntervalMillis: 2 ** 31 - 1,
      }),
    );
  } else if (config.signals.metrics.enabled) {
    metricReaders.push(
      new PeriodicExportingMetricReader({
        exporter: wrapMetricExporter(
          createMetricExporter(config.signals.metrics, config.headers),
          contextFor("metrics"),
        ),
        ...defined({
          exportIntervalMillis: config.metricExportIntervalMillis,
          exportTimeoutMillis: config.metricExportTimeoutMillis,
        }),
      }),
    );
  }

  // logs
  signals.logs = statusOf("logs", test.logRecordExporter !== undefined);
  if (test.logRecordExporter !== undefined) {
    logRecordProcessors.push(
      new SimpleLogRecordProcessor({
        exporter: wrapLogRecordExporter(test.logRecordExporter, base),
      }),
    );
  } else if (config.signals.logs.enabled) {
    logRecordProcessors.push(
      new BatchLogRecordProcessor({
        exporter: wrapLogRecordExporter(
          createLogRecordExporter(config.signals.logs, config.headers),
          contextFor("logs"),
        ),
        ...defined(config.logBatch),
      }),
    );
  }

  return { spanProcessors, metricReaders, logRecordProcessors, signals };
}

function reportStartup(
  diagnostics: Diagnostics,
  signals: Record<Signal, SignalStatus>,
): void {
  for (const signal of SIGNALS) {
    const status = signals[signal];
    if (!status.enabled && status.reason === "no-endpoint") {
      diagnostics.report({
        level: "warn",
        message: `${signal} are not exported: no OTLP endpoint is configured`,
        fields: { signal, reason: status.reason },
      });
    }
  }
}

/**
 * NodeSDK's constructor replaces the diagnostics logger with a console logger
 * whenever `OTEL_LOG_LEVEL` is set, and has no option to prevent it. The level
 * has already been read into the preset's own logger, so the variable is
 * hidden for the duration of the (synchronous) constructor call.
 */
function withoutLogLevelVariable<T>(construct: () => T): T {
  const level = process.env.OTEL_LOG_LEVEL;
  if (level === undefined) return construct();
  delete process.env.OTEL_LOG_LEVEL;
  try {
    return construct();
  } finally {
    process.env.OTEL_LOG_LEVEL = level;
  }
}

/**
 * The SDK sends every internal error (each failed batch among them) to one
 * global handler, whose default logs all of them. This one reports the first
 * error of each kind and then at most one of that kind per interval, so an
 * outage neither floods the log nor hides an unrelated error behind it.
 *
 * A rejected or undeliverable export also arrives here; the exporter wrapper
 * has already reported it, by signal, and marked the error, so it is not
 * reported again. Nothing else is skipped: an error with a code that the
 * wrapper never saw (a file error from an instrumentation, say) is reported.
 */
function installErrorHandler(diagnostics: Diagnostics): void {
  const limiters = new Map<string, ReturnType<typeof createRateLimiter>>();
  setGlobalErrorHandler((error) => {
    try {
      const detail = (
        typeof error === "object" && error !== null
          ? error
          : { message: String(error) }
      ) as { name?: unknown; message?: unknown; code?: unknown };
      const name = typeof detail.name === "string" ? detail.name : "Error";
      const message = typeof detail.message === "string" ? detail.message : "";
      // already reported, per signal, by the exporter wrapper: that exact error object, or the
      // metric reader's rewrapping of one (the reader's own timeout goes through the diag logger)
      if (
        wasReportedByExporter(error) ||
        message.startsWith("PeriodicExportingMetricReader: metrics export failed")
      ) {
        return;
      }
      // one limit per kind of error: its name and the shape of its message (numbers aside), since
      // most SDK errors are plain `Error`s and a repeating one must not hide a different one.
      // Past the first few kinds, the rest share one limit.
      const kind = `${name}:${message.replace(/\d+/g, "#").slice(0, 80)}`;
      const key = limiters.has(kind) || limiters.size < 32 ? kind : "";
      let limit = limiters.get(key);
      if (limit === undefined) {
        limit = createRateLimiter(FAILURE_REPORT_INTERVAL_MILLIS);
        limiters.set(key, limit);
      }
      limit((suppressed) => {
        diagnostics.report({
          level: "error",
          message: "telemetry pipeline error",
          fields: {
            error: name,
            // some SDK errors quote the exporter's error, whose text comes from the far end
            ...(message !== "" &&
              !message.includes("OTLPExporterError") && {
                // whole: diagnostics sanitizes it and only then cuts it to length
                detail: message,
              }),
            ...(suppressed > 0 && { suppressed }),
          },
        });
      });
    } catch {
      // the handler is called from inside the SDK's promise chains; it must never throw
    }
  });
}

/** an independent copy: callers cannot change, and do not see changes to, the runtime's own state */
const snapshot = (status: PresetStatus): PresetStatus => structuredClone(status);

/**
 * Start telemetry for this process. Call it once, from a module loaded with
 * `node --import`, before any application module is imported.
 *
 * Throws `PresetConfigError` for an invalid configuration and throws when
 * called a second time, after `shutdown()` included. A start that fails
 * leaves nothing of its own registered: most configuration errors are found
 * before anything is, and any later failure gives back the providers,
 * context manager, propagator and instrumentations it set up, leaving alone
 * any registered by someone else first. When that cannot be fully done, it
 * says so through diagnostics and every later call throws. With
 * `OTEL_SDK_DISABLED=true` it registers nothing and returns.
 */
export function start(options: StartOptions = {}): PresetStatus {
  // first of all, whatever else this start comes to (a second call included): a promise
  // passed as a resource attribute is given a handler here, before anything can throw
  const deferredResourceAttributes = deferredAttributes(options.resourceAttributes);

  if (undoFailed) {
    throw new Error(
      "@satoshibits/observability: an earlier start() failed and could not be fully undone; " +
        "telemetry cannot be started again in this process",
    );
  }
  if (handle !== undefined) {
    throw new Error(
      "@satoshibits/observability: start() was already called in this process",
    );
  }
  const testExporters = readTestExporters(options.testExporters);
  const resolution = resolveConfig(options, process.env, {
    testExporters: Object.keys(testExporters).length > 0,
    deferredResourceAttributes,
  });
  if (resolution.disabled) {
    handle = {
      status: {
        state: "disabled",
        loaderHook: loaderHookInstalled(),
        signals: allOff("sdk-disabled"),
      },
      parts: [],
    };
    return snapshot(handle.status);
  }
  const { config } = resolution;

  // validation has passed: `redaction` is absent only when nothing is exported
  const redactor = createRedactor(options.redaction ?? false);
  const failures = new ExportFailureLog();
  const diagnostics = createDiagnostics({
    logLevel: process.env.OTEL_LOG_LEVEL,
    sinkFactory: options.diagnostics,
    redactText: (text) => {
      try {
        return redactor.text("diagnostics", text);
      } catch {
        // a policy that throws must neither silence diagnostics nor let the text out as it was
        return "(text withheld: the redaction policy threw)";
      }
    },
  });

  // what was registered before this start, so a failure gives back only what it added
  const before = registered();
  let instrumentations: Instrumentation[] = [];

  // from here on things are registered. The diagnostics logger goes first: the
  // upstream constructors below report unusable settings through it, and it
  // holds what it is given until the sink may be created.
  diag.setLogger(diagnostics.diagLogger, {
    logLevel: diagnostics.diagLevel,
    suppressOverrideMessage: true,
  });
  installErrorHandler(diagnostics);
  // held with everything else, so a start that fails below still shows them
  for (const warning of config.warnings) {
    diagnostics.report({ level: "warn", message: warning });
  }

  let sdk: NodeSDK;
  let pipelines: Pipelines;
  try {
    const resource = buildResource(config, redactor);
    const sampler = buildSampler(config.sampler);
    instrumentations = [
      ...buildInstrumentations(options.instrumentations, config, testExporters),
      ...(testInstrumentations ?? []),
    ];
    pipelines = buildPipelines(
      config,
      testExporters,
      { diagnostics, redactor, failures },
      options.redaction !== undefined,
    );
    const built = pipelines;
    sdk = withoutLogLevelVariable(
      () =>
        new NodeSDK({
          resource,
          // the resource is complete; detection here would merge the environment in again, unfiltered
          autoDetectResources: false,
          sampler,
          spanProcessors: built.spanProcessors,
          metricReaders: built.metricReaders,
          logRecordProcessors: built.logRecordProcessors,
          instrumentations,
        }),
    );
    sdk.start();
    // last, once nothing can fail: a loader hook cannot be unregistered
    if (options.loaderHook !== false) installLoaderHook();
  } catch (error) {
    // give back what was registered above, and let what was held be seen
    if (!undoStart(before, instrumentations)) {
      undoFailed = true;
      diagnostics.report({
        level: "error",
        message:
          "a failed start could not be fully undone; start() will refuse to run again in this process",
      });
    }
    diagnostics.activate();
    diag.disable();
    setGlobalErrorHandler(loggingErrorHandler());
    throw error;
  }
  diagnostics.activate();
  reportStartup(diagnostics, pipelines.signals);

  // the processors shut themselves down once; the reader is made to as well (see shutdownOnce)
  pipelines.metricReaders.forEach(shutdownOnce);
  handle = {
    sdk,
    failures,
    parts: [
      ...partsOf("traces", pipelines.spanProcessors),
      ...partsOf("metrics", pipelines.metricReaders),
      ...partsOf("logs", pipelines.logRecordProcessors),
    ],
    status: {
      state: "running",
      loaderHook: loaderHookInstalled(),
      serviceName: config.serviceName,
      sampler: describeSampler(config.sampler),
      signals: pipelines.signals,
    },
  };
  return snapshot(handle.status);
}

/**
 * The processors shut themselves down once and hand a second caller the
 * first call's promise; the metric reader runs its shutdown again instead.
 * `shutdown()` awaits each part beside the SDK's own call to it, so the
 * reader is given the processors' behaviour.
 */
function shutdownOnce(reader: MetricReader): void {
  const shutdown = reader.shutdown.bind(reader);
  let once: Promise<void> | undefined;
  // a later caller's options are ignored: the first call's shutdown is the one there is
  reader.shutdown = (options) => (once ??= shutdown(options));
}

/** a timeout as given, or the default for NaN, within what a timer can hold */
const timeoutOf = (given: number): number =>
  Number.isNaN(given) ? DEFAULT_TIMEOUT_MILLIS : Math.min(Math.max(0, given), MAX_TIMER_MILLIS);

/**
 * Reject when `work` has not settled within `timeoutMillis`; the timer never outlives the call.
 * A delay longer than a timer holds is cut to the longest it does hold: Node would fire it at once.
 */
async function within<T>(
  work: Promise<T>,
  timeoutMillis: number,
  what: string,
  shownMillis = timeoutMillis,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        reject(
          new Error(
            `@satoshibits/observability: ${what} did not finish within ${shownMillis} ms`,
          ),
        );
      },
      timeoutOf(timeoutMillis),
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run `act` on every part and wait for all of them, so one signal's failure
 * neither stops nor hides another's; then reject with the preset's own error
 * when any export this call began failed. A part's rejection is not passed on
 * as it is: the batch span processor rejects with the exporter's error, whose
 * message is the far end's status text.
 */
async function settleAll(
  current: Handle,
  what: string,
  timeoutMillis: number,
  act: (part: Part) => Promise<void>,
  alongside: Promise<unknown>[] = [],
  /** the timeout the caller gave, for the message, when less than it is left */
  shownMillis = timeoutMillis,
  /** handed the parts' own work as it starts, which outlasts this call when it times out */
  started?: (parts: Promise<unknown>) => void,
): Promise<void> {
  const call = current.failures?.open();
  let outcomes: PromiseSettledResult<void>[];
  try {
    // async: a part that throws instead of rejecting is still one outcome among the others
    const parts = Promise.allSettled(current.parts.map(async (part) => act(part)));
    started?.(parts);
    // the SDK's shutdown is awaited for timing only; its rejection is dropped, since the
    // parts reject with the same failures
    await within(Promise.allSettled([parts, ...alongside]), timeoutMillis, what, shownMillis);
    outcomes = await parts;
  } finally {
    call?.close();
  }
  // a limit: the batch log processor and the metric reader also swallow their own export
  // timeout (`exportTimeoutMillis`, 30 s by default). An exporter whose request deadline is
  // longer than that (the OTLP default is 10 s) is abandoned with no result reaching the
  // wrapper, and the call resolves with nothing sent
  const recorded = [...(call?.failures ?? [])];
  const failures = recorded.map(([, failure]) => failure);
  // which error each failure came from, so one is not counted twice for its signal
  const seen = recorded.map(([reason, failure]) => [failure.signal, reason] as const);
  outcomes.forEach((outcome, index) => {
    // a part that rejects says this call failed, whatever its error: the batch span processor
    // for a batch it sent, a simple processor for an export it was still waiting on, or a
    // processor's own timeout. Stated by identifiers, once per signal and error (two signals
    // can reject with the same value)
    if (outcome.status !== "rejected") return;
    const { signal } = current.parts[index]!;
    if (seen.some(([s, reason]) => s === signal && reason === outcome.reason)) return;
    seen.push([signal, outcome.reason]);
    failures.push(exportFailure(signal, outcome.reason));
  });
  if (failures.length > 0) throw new TelemetryExportError(failures);
}

/**
 * Send everything buffered, without shutting down. Rejects with a
 * `TelemetryExportError` when something buffered could not be sent, and
 * when `timeoutMillis` passes.
 *
 * A call made while another runs returns that one's promise (and its
 * timeout): the batch log processor answers a second flush at once, before
 * anything is sent, so a flush of its own would resolve early. What was
 * emitted after the running flush began is left for the next one. A call
 * made after one timed out, while its parts are still flushing, waits for
 * them (within its own timeout) and then flushes.
 */
export function forceFlush(timeoutMillis = DEFAULT_TIMEOUT_MILLIS): Promise<void> {
  const current = handle;
  if (current?.status.state !== "running") return Promise.resolve();
  if (current.flushing) return current.flushing;
  const timeout = timeoutOf(timeoutMillis);
  const flushing = afterPartsFlushed(current, timeout, "forceFlush", (left) =>
    settleAll(
      current,
      "forceFlush",
      left,
      (part) => part.forceFlush(),
      [],
      timeout,
      (parts) => {
        current.partsFlushing = parts;
        void parts.then(() => {
          if (current.partsFlushing === parts) current.partsFlushing = undefined;
        });
      },
    ),
  ).finally(() => {
    if (current.flushing === flushing) current.flushing = undefined;
  });
  current.flushing = flushing;
  return flushing;
}

/**
 * Flush and stop telemetry. Rejects with a `TelemetryExportError` when
 * something buffered could not be sent, and when `timeoutMillis` passes;
 * every signal is shut down either way. A flush whose parts are still
 * running (one whose caller is waiting, or one that timed out) is waited for
 * first, within the same timeout; its outcome is its own caller's. A second
 * call, during the first or after it, returns the first call's promise. A
 * process shuts down once; `start()` cannot be called again.
 */
export function shutdown(timeoutMillis = DEFAULT_TIMEOUT_MILLIS): Promise<void> {
  const current = handle;
  if (current?.shutdown) return current.shutdown;
  if (current?.status.state !== "running" || !current.sdk) return Promise.resolve();
  current.status = { ...current.status, state: "shut-down" };
  const { sdk } = current;
  const timeout = timeoutOf(timeoutMillis);
  current.shutdown = afterPartsFlushed(current, timeout, "shutdown", (left) => {
    // the SDK's call goes first: the providers mark themselves shut down and shut down their
    // parts, and each part, asked again below, hands back that same shutdown's promise
    const sdkShutdown = sdk.shutdown();
    return settleAll(current, "shutdown", left, (part) => part.shutdown(), [sdkShutdown], timeout);
  });
  return current.shutdown;
}

/**
 * Run `then` once the parts have finished the last flush, with what is left
 * of `timeoutMillis`. The batch log processor answers a flush or shutdown
 * made while it is flushing at once, without sending what was emitted since,
 * so nothing is asked of the parts until they are done.
 */
async function afterPartsFlushed(
  current: Handle,
  timeoutMillis: number,
  what: string,
  then: (left: number) => Promise<void>,
): Promise<void> {
  const started = Date.now();
  if (current.partsFlushing) {
    try {
      await within(current.partsFlushing, timeoutMillis, what);
    } catch {
      // out of time: `then` still runs, and rejects at once with the timeout
    }
  }
  await then(Math.max(0, timeoutMillis - (Date.now() - started)));
}

/** What is running: per signal on or off and why, and where data goes. Never header values. */
export function getStatus(): PresetStatus {
  return handle
    ? snapshot(handle.status)
    : {
        state: "not-started",
        loaderHook: loaderHookInstalled(),
        signals: allOff("not-started"),
      };
}

/**
 * Test support, used by the `/testing` kit's `stop()` (it is not exported
 * itself): stop what is running and forget it, so the next test can start
 * telemetry again in the same process.
 * It clears the API's global registrations, whoever made them.
 *
 * Everything global is undone synchronously, before the first await, so a
 * `start()` that follows at once (without awaiting this) is not undone by it.
 */
export async function resetForTesting(): Promise<void> {
  const current = handle;
  handle = undefined;
  undoFailed = false;
  trace.disable();
  metrics.disable();
  logs.disable();
  context.disable();
  propagation.disable();
  diag.disable();
  setGlobalErrorHandler(loggingErrorHandler());
  // the SDK holds its own references to the providers, so this still flushes and stops them
  await current?.sdk?.shutdown();
}
