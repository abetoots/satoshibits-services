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

import { resolveConfig, SIGNALS } from "./config.mjs";
import { createDiagnostics, createRateLimiter } from "./diagnostics.mjs";
import {
  createLogRecordExporter,
  createMetricExporter,
  createSpanExporter,
  FAILURE_REPORT_INTERVAL_MILLIS,
  hostOf,
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
  sampler.type.endsWith("traceidratio")
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
    let interval = config.metricExportIntervalMillis;
    let timeout = config.metricExportTimeoutMillis;
    if (interval === 0) interval = undefined;
    if (timeout === 0) timeout = undefined;
    if (interval !== undefined && timeout !== undefined && timeout > interval) {
      config.warnings.push(
        "OTEL_METRIC_EXPORT_TIMEOUT is greater than OTEL_METRIC_EXPORT_INTERVAL; using the interval as the timeout",
      );
      timeout = interval;
    }
    metricReaders.push(
      new PeriodicExportingMetricReader({
        exporter: wrapMetricExporter(
          createMetricExporter(config.signals.metrics, config.headers),
          contextFor("metrics"),
        ),
        ...defined({
          exportIntervalMillis: interval,
          exportTimeoutMillis: timeout,
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
  config: ResolvedConfig,
  signals: Record<Signal, SignalStatus>,
): void {
  for (const warning of config.warnings) {
    diagnostics.report({ level: "warn", message: warning });
  }
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
 * and then at most one per interval, so an outage does not flood the log.
 * Failed exports are also reported per signal by the exporter wrapper.
 */
function installErrorHandler(diagnostics: Diagnostics): void {
  const limit = createRateLimiter(FAILURE_REPORT_INTERVAL_MILLIS);
  setGlobalErrorHandler((error) => {
    limit((suppressed) => {
      const detail = (
        typeof error === "object" ? error : { message: String(error) }
      ) as { name?: unknown; message?: unknown; code?: unknown };
      const name = typeof detail.name === "string" ? detail.name : "Error";
      diagnostics.report({
        level: "error",
        message: "telemetry pipeline error",
        fields: {
          error: name,
          ...(typeof detail.code === "number" && { status: detail.code }),
          ...(typeof detail.code === "string" && { code: detail.code }),
          // an exporter error's message is free text from the far end; others are the SDK's own
          ...(name !== "OTLPExporterError" &&
            typeof detail.message === "string" && {
              detail: detail.message.slice(0, 200),
            }),
          ...(suppressed > 0 && { suppressed }),
        },
      });
    });
  });
}

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
    return handle.status;
  }
  const { config } = resolution;

  const diagnostics = createDiagnostics({
    logLevel: process.env.OTEL_LOG_LEVEL,
    sinkFactory: options.diagnostics,
  });
  const redactor = createRedactor(options.redaction);
  const pipelines = buildPipelines(config, options, { diagnostics, redactor });

  if (options.loaderHook !== false) installLoaderHook();

  diag.setLogger(diagnostics.diagLogger, {
    logLevel: diagnostics.diagLevel,
    suppressOverrideMessage: true,
  });
  installErrorHandler(diagnostics);

  const sdk = withoutLogLevelVariable(
    () =>
      new NodeSDK({
        resource: buildResource(config, redactor),
        // the resource above is complete; detection here would merge the environment in again, unfiltered
        autoDetectResources: false,
        sampler: buildSampler(config.sampler),
        spanProcessors: pipelines.spanProcessors,
        metricReaders: pipelines.metricReaders,
        logRecordProcessors: pipelines.logRecordProcessors,
        instrumentations: buildInstrumentations(options.instrumentations),
      }),
  );
  sdk.start();
  diagnostics.activate();
  reportStartup(diagnostics, config, pipelines.signals);

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
  return handle.status;
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
  return (
    handle?.status ?? {
      state: "not-started",
      loaderHook: loaderHookInstalled(),
      signals: allOff("not-started"),
    }
  );
}

/**
 * Test support, reached through the `/testing` entry: stop what is running and
 * forget it, so the next test can call `start()` again in the same process.
 * It clears the API's global registrations, whoever made them.
 */
export async function resetForTesting(): Promise<void> {
  const current = handle;
  handle = undefined;
  try {
    await current?.sdk?.shutdown();
  } finally {
    trace.disable();
    metrics.disable();
    logs.disable();
    context.disable();
    propagation.disable();
    diag.disable();
    setGlobalErrorHandler(loggingErrorHandler());
  }
}
