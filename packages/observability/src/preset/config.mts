/**
 * Resolution of the preset's configuration.
 *
 * Pure: reads the options and an environment object and returns either a
 * complete, explicit configuration or one error listing everything that is
 * wrong. Nothing is registered and nothing is constructed here, so an invalid
 * configuration has no side effect.
 *
 * Every signal is resolved to on or off, with a reason when off. Nothing is
 * left for the SDK to default.
 */

import type { Attributes } from "@opentelemetry/api";

import type { RedactionOption } from "./redaction.mjs";

import { shown } from "./diagnostics.mjs";
import { redactionProblem } from "./redaction.mjs";

export type Signal = "traces" | "metrics" | "logs";
export const SIGNALS: readonly Signal[] = ["traces", "metrics", "logs"];

export type OtlpProtocol = "http/protobuf" | "http/json";

export const SAMPLER_TYPES = [
  "always_on",
  "always_off",
  "traceidratio",
  "parentbased_always_on",
  "parentbased_always_off",
  "parentbased_traceidratio",
] as const;
export type SamplerType = (typeof SAMPLER_TYPES)[number];

/** A sampler described by name, so a preload needs no SDK import. */
export interface SamplerOption {
  type: SamplerType;
  /** for the two ratio types: a number from 0 to 1 (default 1) */
  ratio?: number;
}

export interface PresetConfigOptions {
  /** wins over `OTEL_SERVICE_NAME` */
  serviceName?: string;
  serviceNamespace?: string;
  serviceVersion?: string;
  /** exported as `deployment.environment.name` */
  deploymentEnvironment?: string;
  /** further resource attributes; `OTEL_RESOURCE_ATTRIBUTES` wins over these */
  resourceAttributes?: Attributes;
  /** overrides `OTEL_EXPORTER_OTLP_ENDPOINT` */
  endpoint?: string;
  /** added to every signal's request headers, over `OTEL_EXPORTER_OTLP_HEADERS` */
  headers?: Record<string, string>;
  /** used when `OTEL_TRACES_SAMPLER` is not set */
  sampler?: SamplerOption;
  /**
   * What decides how exported data is redacted: a policy, or `false` to
   * export everything as given. Required whenever any signal is exported;
   * there is no default.
   */
  redaction?: RedactionOption;
}

/** what configuration validation needs to know that is not a setting */
export interface ResolveContext {
  /** a test supplied an exporter, so something is exported whatever the environment says */
  testExporters?: boolean;
}

export type SignalOffReason =
  /** no OTLP endpoint is configured for the signal */
  | "no-endpoint"
  /** its `OTEL_*_EXPORTER` variable is `none` */
  | "exporter-none"
  /** logs only: `OTEL_LOGS_EXPORTER=otlp` was not set */
  | "not-requested"
  /** `OTEL_SDK_DISABLED=true` */
  | "sdk-disabled"
  /** `start()` has not been called in this process */
  | "not-started";

export type SignalConfig =
  | {
      enabled: true;
      url: string;
      protocol: OtlpProtocol;
    }
  | { enabled: false; reason: SignalOffReason };

export interface BatchTuning {
  maxQueueSize?: number;
  scheduledDelayMillis?: number;
  exportTimeoutMillis?: number;
  maxExportBatchSize?: number;
}

export interface ResolvedConfig {
  serviceName: string;
  serviceNamespace?: string;
  serviceVersion?: string;
  deploymentEnvironment?: string;
  resourceAttributes: Attributes;
  /** `OTEL_RESOURCE_ATTRIBUTES`, parsed; empty when unset or malformed */
  environmentAttributes: Record<string, string>;
  headers?: Record<string, string>;
  signals: Record<Signal, SignalConfig>;
  sampler: Required<SamplerOption> & { source: "env" | "option" | "default" };
  metricExportIntervalMillis?: number;
  metricExportTimeoutMillis?: number;
  spanBatch: BatchTuning;
  logBatch: BatchTuning;
  /** settings that were ignored, to be reported once diagnostics exist */
  warnings: string[];
}

export type Resolution =
  | { disabled: true }
  | { disabled: false; config: ResolvedConfig };

/** Thrown by `start()` for an invalid configuration. Lists every problem. */
export class PresetConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(
      `@satoshibits/observability: invalid configuration:\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
    this.name = "PresetConfigError";
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

const SIGNAL_VAR: Record<Signal, string> = {
  traces: "TRACES",
  metrics: "METRICS",
  logs: "LOGS",
};

const nonBlank = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

/** a variable that is unset or blank counts as unset, as the specification says */
const read = (env: Env, name: string): string | undefined => nonBlank(env[name]);

/** parse an endpoint; push a problem (naming the source, never the value) when unusable */
function parseEndpoint(
  value: string,
  source: string,
  problems: string[],
): URL | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push(`${source} is not a valid URL`);
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    problems.push(`${source} must be an http or https URL`);
    return undefined;
  }
  if (url.hash !== "") {
    problems.push(`${source} must not contain a fragment (#...)`);
    return undefined;
  }
  return url;
}

function resolveEndpoint(
  signal: Signal,
  general: URL | undefined,
  env: Env,
  problems: string[],
): string | undefined {
  const specificName = `OTEL_EXPORTER_OTLP_${SIGNAL_VAR[signal]}_ENDPOINT`;
  const specific = read(env, specificName);
  // a signal-specific endpoint is used as given, in its canonical spelling: a URL parses
  // from other spellings too (`http:\\host`), which nothing downstream would know for a URL
  if (specific !== undefined) {
    return parseEndpoint(specific, specificName, problems)?.href;
  }
  if (general === undefined) return undefined;
  // the general one gets the signal path, appended to its path (a query string stays a query string)
  const url = new URL(general.href);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/${signal}`;
  return url.href;
}

function resolveProtocol(
  signal: Signal,
  env: Env,
  problems: string[],
): OtlpProtocol {
  const specificName = `OTEL_EXPORTER_OTLP_${SIGNAL_VAR[signal]}_PROTOCOL`;
  const generalName = "OTEL_EXPORTER_OTLP_PROTOCOL";
  const specific = read(env, specificName);
  // enum values are case-insensitive, as the specification recommends
  const value = (specific ?? read(env, generalName))?.toLowerCase();
  if (value === undefined || value === "http/protobuf") return "http/protobuf";
  if (value === "http/json") return "http/json";
  const name = specific === undefined ? generalName : specificName;
  problems.push(
    value === "grpc"
      ? `${name}=grpc is not supported: use http/protobuf or http/json`
      : `${name}=${shown(value)} is not a known protocol: use http/protobuf or http/json`,
  );
  return "http/protobuf";
}

function resolveSignal(
  signal: Signal,
  general: URL | undefined,
  env: Env,
  problems: string[],
  warnings: string[],
): SignalConfig {
  const exporterName = `OTEL_${SIGNAL_VAR[signal]}_EXPORTER`;
  const exporter = read(env, exporterName)?.toLowerCase();
  // validated even when the signal ends up off: a setting is honoured or rejected, never ignored
  const protocol = resolveProtocol(signal, env, problems);
  const url = resolveEndpoint(signal, general, env, problems);

  if (exporter !== undefined && exporter !== "otlp" && exporter !== "none") {
    problems.push(
      `${exporterName}=${shown(exporter)} is not supported: use "otlp" or "none"`,
    );
    return { enabled: false, reason: "exporter-none" };
  }
  if (exporter === "none") return { enabled: false, reason: "exporter-none" };
  // logs are opt-in: application logs usually have a destination already
  if (signal === "logs" && exporter === undefined) {
    const configured = Object.keys(env).filter(
      (name) => name.startsWith("OTEL_EXPORTER_OTLP_LOGS_") && read(env, name),
    );
    if (configured.length > 0) {
      warnings.push(
        `${configured.sort().join(", ")} is set but logs are not exported: set OTEL_LOGS_EXPORTER=otlp to turn them on`,
      );
    }
    return { enabled: false, reason: "not-requested" };
  }
  if (url === undefined) return { enabled: false, reason: "no-endpoint" };
  return { enabled: true, url, protocol };
}

export const isRatioSampler = (type: SamplerType): boolean =>
  type.endsWith("traceidratio");

function resolveSampler(
  option: SamplerOption | undefined,
  env: Env,
  problems: string[],
  warnings: string[],
): ResolvedConfig["sampler"] {
  const fallback = {
    type: "parentbased_always_on",
    ratio: 1,
    source: "default",
  } as const;
  const name = read(env, "OTEL_TRACES_SAMPLER")?.toLowerCase();
  const arg = read(env, "OTEL_TRACES_SAMPLER_ARG");

  if (name === undefined) {
    if (arg !== undefined) {
      problems.push(
        "OTEL_TRACES_SAMPLER_ARG is set without OTEL_TRACES_SAMPLER, so it would have no effect",
      );
    }
    if (option === undefined) return fallback;
    if (!SAMPLER_TYPES.includes(option.type)) {
      problems.push(
        `sampler.type ${shown(option.type)} is not one of ${SAMPLER_TYPES.join(", ")}`,
      );
      return fallback;
    }
    const ratio = option.ratio ?? 1;
    if (!(ratio >= 0 && ratio <= 1)) {
      problems.push(`sampler.ratio ${shown(option.ratio)} is not a number from 0 to 1`);
      return fallback;
    }
    return { type: option.type, ratio, source: "option" };
  }

  if (!SAMPLER_TYPES.includes(name as SamplerType)) {
    problems.push(
      `OTEL_TRACES_SAMPLER=${shown(name)} is not one of ${SAMPLER_TYPES.join(", ")}`,
    );
    return fallback;
  }
  const type = name as SamplerType;
  let ratio = 1;
  if (!isRatioSampler(type) && arg !== undefined) {
    warnings.push(
      `OTEL_TRACES_SAMPLER_ARG is ignored: the ${type} sampler takes no argument`,
    );
  }
  if (isRatioSampler(type) && arg !== undefined) {
    ratio = Number(arg);
    if (!(ratio >= 0 && ratio <= 1)) {
      problems.push(
        `OTEL_TRACES_SAMPLER_ARG=${shown(arg)} is not a number from 0 to 1`,
      );
      return fallback;
    }
  }
  return { type, ratio, source: "env" };
}

/** the largest delay a node timer accepts */
const MAX_TIMER_MILLIS = 2 ** 31 - 1;

/**
 * A tuning value the SDK cannot use is ignored with a warning, as the
 * specification says. Zero is such a value: a zero batch size makes the
 * upstream processor export empty batches forever, and a zero queue drops
 * every record.
 */
function tuning(
  env: Env,
  name: string,
  kind: "count" | "millis",
  warnings: string[],
): number | undefined {
  const raw = read(env, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  const usable =
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_TIMER_MILLIS &&
    (kind === "millis" || Number.isInteger(value));
  if (!usable) {
    warnings.push(
      `${name}=${shown(raw)} is not a positive ${kind === "count" ? "whole number" : "number"}; using the default`,
    );
    return undefined;
  }
  return value;
}

const batchTuning = (env: Env, prefix: string, warnings: string[]): BatchTuning => ({
  maxQueueSize: tuning(env, `${prefix}_MAX_QUEUE_SIZE`, "count", warnings),
  scheduledDelayMillis: tuning(env, `${prefix}_SCHEDULE_DELAY`, "millis", warnings),
  exportTimeoutMillis: tuning(env, `${prefix}_EXPORT_TIMEOUT`, "millis", warnings),
  maxExportBatchSize: tuning(env, `${prefix}_MAX_EXPORT_BATCH_SIZE`, "count", warnings),
});

/**
 * `OTEL_RESOURCE_ATTRIBUTES`, parsed once, here, for both the service name and
 * the resource. The specification says a value with any malformed entry is
 * discarded whole; that is reported, where the upstream detector stays silent.
 */
function environmentAttributes(
  env: Env,
  warnings: string[],
): Record<string, string> {
  const raw = read(env, "OTEL_RESOURCE_ATTRIBUTES");
  if (raw === undefined) return {};
  const attributes: Record<string, string> = {};
  try {
    for (const entry of raw.split(",")) {
      if (entry.trim() === "") continue;
      const at = entry.indexOf("=");
      const key = at > 0 ? decodeURIComponent(entry.slice(0, at).trim()) : "";
      if (key === "") throw new Error("entry without a key");
      attributes[key] = decodeURIComponent(entry.slice(at + 1).trim());
    }
  } catch {
    warnings.push(
      "OTEL_RESOURCE_ATTRIBUTES is malformed (expected key=value pairs separated by commas, percent-encoded); all of it is ignored",
    );
    return {};
  }
  return attributes;
}

/**
 * Resolve options and environment into an explicit configuration.
 * Throws {@link PresetConfigError} listing every problem found.
 * `OTEL_SDK_DISABLED=true` returns before any validation.
 */
export function resolveConfig(
  options: PresetConfigOptions,
  env: Env,
  context: ResolveContext = {},
): Resolution {
  if (read(env, "OTEL_SDK_DISABLED")?.toLowerCase() === "true") {
    return { disabled: true };
  }

  const problems: string[] = [];
  const warnings: string[] = [];

  const fromEnvironment = environmentAttributes(env, warnings);
  const serviceName =
    nonBlank(options.serviceName) ??
    read(env, "OTEL_SERVICE_NAME") ??
    nonBlank(fromEnvironment["service.name"]);
  if (!serviceName) {
    problems.push(
      "no service name: pass serviceName to start() or set OTEL_SERVICE_NAME",
    );
  }

  // the variable is validated even when the option overrides it: a setting is
  // honoured or rejected, never left wrong and ignored
  const envEndpointValue = read(env, "OTEL_EXPORTER_OTLP_ENDPOINT");
  const envEndpoint =
    envEndpointValue === undefined
      ? undefined
      : parseEndpoint(envEndpointValue, "OTEL_EXPORTER_OTLP_ENDPOINT", problems);
  const optionEndpointValue = nonBlank(options.endpoint);
  const general =
    optionEndpointValue === undefined
      ? envEndpoint
      : parseEndpoint(optionEndpointValue, "the endpoint option", problems);

  const signals = {} as Record<Signal, SignalConfig>;
  for (const signal of SIGNALS) {
    signals[signal] = resolveSignal(signal, general, env, problems, warnings);
  }

  const sampler = resolveSampler(options.sampler, env, problems, warnings);

  const metricExportIntervalMillis = tuning(env, "OTEL_METRIC_EXPORT_INTERVAL", "millis", warnings);
  let metricExportTimeoutMillis = tuning(env, "OTEL_METRIC_EXPORT_TIMEOUT", "millis", warnings);
  if (
    metricExportIntervalMillis !== undefined &&
    metricExportTimeoutMillis !== undefined &&
    metricExportTimeoutMillis > metricExportIntervalMillis
  ) {
    // the reader refuses to be constructed with a timeout above its interval
    warnings.push(
      "OTEL_METRIC_EXPORT_TIMEOUT is greater than OTEL_METRIC_EXPORT_INTERVAL; using the interval as the timeout",
    );
    metricExportTimeoutMillis = metricExportIntervalMillis;
  }

  const config: ResolvedConfig = {
    serviceName: serviceName ?? "",
    serviceNamespace: options.serviceNamespace,
    serviceVersion: options.serviceVersion,
    deploymentEnvironment: options.deploymentEnvironment,
    resourceAttributes: options.resourceAttributes ?? {},
    environmentAttributes: fromEnvironment,
    headers: options.headers,
    signals,
    sampler,
    metricExportIntervalMillis,
    metricExportTimeoutMillis,
    spanBatch: batchTuning(env, "OTEL_BSP", warnings),
    logBatch: batchTuning(env, "OTEL_BLRP", warnings),
    warnings,
  };

  // no policy, no export: checked here, with everything else, so nothing has been registered
  const exporting =
    context.testExporters === true ||
    SIGNALS.some((signal) => config.signals[signal].enabled);
  if (options.redaction === undefined) {
    if (exporting) {
      problems.push(
        "no redaction policy: pass `redaction` to start() (a policy, or false to export everything as given)",
      );
    }
  } else {
    const problem = redactionProblem(options.redaction);
    if (problem !== undefined) problems.push(problem);
  }

  if (problems.length > 0) throw new PresetConfigError(problems);
  return { disabled: false, config };
}
