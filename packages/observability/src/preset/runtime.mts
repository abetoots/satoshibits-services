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
import type { RedactionOptions } from "./redaction.mjs";
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

import { isRatioSampler, resolveConfig, SIGNALS } from "./config.mjs";
import { createDiagnostics, createRateLimiter } from "./diagnostics.mjs";
import {
  createLogRecordExporter,
  createMetricExporter,
  createSpanExporter,
  FAILURE_REPORT_INTERVAL_MILLIS,
  hostOf,
  wasReportedByExporter,
  wrapLogRecordExporter,
  wrapMetricExporter,
  wrapSpanExporter,
} from "./exporters.mjs";
import { createRedactor } from "./redaction.mjs";
import { buildResource } from "./resource.mjs";

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
   * Per-instrumentation settings, merged over the preset's defaults (the Node
   * auto-instrumentation bundle with `fs`, `net` and `dns` off and log sending
   * off for pino, winston and bunyan). `false` installs no instrumentation.
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
  redaction?: RedactionOptions;
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

interface Handle {
  status: PresetStatus;
  sdk?: NodeSDK;
  flushables: { forceFlush: () => Promise<void> }[];
}

const HOOK_FLAG = Symbol.for("@satoshibits/observability.loader-hook");
const DEFAULT_TIMEOUT_MILLIS = 10_000;

let handle: Handle | undefined;

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

function buildInstrumentations(
  option: StartOptions["instrumentations"],
): Instrumentation[] {
  if (option === false) return [];
  // loaded on demand: the bundle pulls in every instrumentation package, which
  // a disabled or instrumentation-free start should not pay for
  const { getNodeAutoInstrumentations } = createRequire(import.meta.url)(
    "@opentelemetry/auto-instrumentations-node",
  ) as typeof import("@opentelemetry/auto-instrumentations-node");
  return getNodeAutoInstrumentations({
    // noisy, and rarely what anyone looks at
    "@opentelemetry/instrumentation-fs": { enabled: false },
    "@opentelemetry/instrumentation-net": { enabled: false },
    "@opentelemetry/instrumentation-dns": { enabled: false },
    // keep the trace ids on log lines; do not also ship the lines over OTLP
    "@opentelemetry/instrumentation-pino": { disableLogSending: true },
    "@opentelemetry/instrumentation-winston": { disableLogSending: true },
    "@opentelemetry/instrumentation-bunyan": { disableLogSending: true },
    ...option,
  });
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

function buildPipelines(
  config: ResolvedConfig,
  options: StartOptions,
  base: Omit<ExporterContext, "endpointHost">,
): Pipelines {
  const test = options.testExporters ?? {};
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
  if (test.spanExporter) {
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
  if (test.metricExporter) {
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
  if (test.logRecordExporter) {
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
      // one limit per kind of error; the kinds are few (the SDK's own classes)
      // (a program that invents error names without end shares one limit past the first few)
      const key = limiters.has(name) || limiters.size < 32 ? name : "";
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
 * Throws `PresetConfigError` for an invalid configuration, before anything
 * is registered, and throws when called a second time.
 * With `OTEL_SDK_DISABLED=true` it registers nothing and returns.
 */
export function start(options: StartOptions = {}): PresetStatus {
  if (handle !== undefined) {
    throw new Error(
      "@satoshibits/observability: start() was already called in this process",
    );
  }

  const resolution = resolveConfig(options, process.env);
  if (resolution.disabled) {
    handle = {
      status: {
        state: "disabled",
        loaderHook: loaderHookInstalled(),
        signals: allOff("sdk-disabled"),
      },
      flushables: [],
    };
    return snapshot(handle.status);
  }
  const { config } = resolution;

  const redactor = createRedactor(options.redaction);
  const diagnostics = createDiagnostics({
    logLevel: process.env.OTEL_LOG_LEVEL,
    sinkFactory: options.diagnostics,
    redactText: redactor.text,
    environment: process.env,
  });

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
    const instrumentations = buildInstrumentations(options.instrumentations);
    pipelines = buildPipelines(config, options, { diagnostics, redactor });
    if (options.loaderHook !== false) installLoaderHook();
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
  } catch (error) {
    // give back what was registered above, and let what was held be seen
    diagnostics.activate();
    diag.disable();
    setGlobalErrorHandler(loggingErrorHandler());
    throw error;
  }
  diagnostics.activate();
  reportStartup(diagnostics, pipelines.signals);

  handle = {
    sdk,
    flushables: [
      ...pipelines.spanProcessors,
      ...pipelines.metricReaders,
      ...pipelines.logRecordProcessors,
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

/** reject when `work` has not settled within `timeoutMillis`; the timer never outlives the call */
async function within(
  work: Promise<unknown>,
  timeoutMillis: number,
  what: string,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `@satoshibits/observability: ${what} did not finish within ${timeoutMillis} ms`,
        ),
      );
    }, timeoutMillis);
  });
  try {
    await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send everything buffered, without shutting down. Rejects on failure or
 * when `timeoutMillis` passes.
 */
export async function forceFlush(
  timeoutMillis = DEFAULT_TIMEOUT_MILLIS,
): Promise<void> {
  if (handle?.status.state !== "running") return;
  await within(
    Promise.all(handle.flushables.map((flushable) => flushable.forceFlush())),
    timeoutMillis,
    "forceFlush",
  );
}

/**
 * Flush and stop telemetry. Rejects on failure or when `timeoutMillis`
 * passes. A process shuts down once; `start()` cannot be called again.
 */
export async function shutdown(
  timeoutMillis = DEFAULT_TIMEOUT_MILLIS,
): Promise<void> {
  if (handle?.status.state !== "running" || !handle.sdk) return;
  handle.status = { ...handle.status, state: "shut-down" };
  await within(handle.sdk.shutdown(), timeoutMillis, "shutdown");
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
