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

function resolveEndpoint(
  signal: Signal,
  general: string | undefined,
  generalSource: string,
  env: Env,
  problems: string[],
): string | undefined {
  const specificName = `OTEL_EXPORTER_OTLP_${SIGNAL_VAR[signal]}_ENDPOINT`;
  const specific = read(env, specificName);
  // a signal-specific endpoint is used as given; the general one gets the signal path
  const candidate =
    specific ??
    (general === undefined
      ? undefined
      : `${general.replace(/\/+$/, "")}/v1/${signal}`);
  if (candidate === undefined) return undefined;
  const source = specific === undefined ? generalSource : specificName;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    problems.push(`${source} is not a valid URL`);
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    problems.push(`${source} must be an http or https URL`);
    return undefined;
  }
  return candidate;
}

function resolveProtocol(
  signal: Signal,
  env: Env,
  problems: string[],
): OtlpProtocol {
  const specificName = `OTEL_EXPORTER_OTLP_${SIGNAL_VAR[signal]}_PROTOCOL`;
  const generalName = "OTEL_EXPORTER_OTLP_PROTOCOL";
  const specific = read(env, specificName);
  const value = specific ?? read(env, generalName);
  if (value === undefined || value === "http/protobuf") return "http/protobuf";
  if (value === "http/json") return "http/json";
  const name = specific === undefined ? generalName : specificName;
  problems.push(
    value === "grpc"
      ? `${name}=grpc is not supported: use http/protobuf or http/json`
      : `${name}="${value}" is not a known protocol: use http/protobuf or http/json`,
  );
  return "http/protobuf";
}

function resolveSignal(
  signal: Signal,
  general: string | undefined,
  generalSource: string,
  env: Env,
  problems: string[],
): SignalConfig {
  const exporterName = `OTEL_${SIGNAL_VAR[signal]}_EXPORTER`;
  const exporter = read(env, exporterName)?.toLowerCase();
  // validated even when the signal ends up off: a setting is honoured or rejected, never ignored
  const protocol = resolveProtocol(signal, env, problems);
  const url = resolveEndpoint(signal, general, generalSource, env, problems);

  if (exporter !== undefined && exporter !== "otlp" && exporter !== "none") {
    problems.push(
      `${exporterName}="${exporter}" is not supported: use "otlp" or "none"`,
    );
    return { enabled: false, reason: "exporter-none" };
  }
  if (exporter === "none") return { enabled: false, reason: "exporter-none" };
  // logs are opt-in: application logs usually have a destination already
  if (signal === "logs" && exporter === undefined) {
    return { enabled: false, reason: "not-requested" };
  }
  if (url === undefined) return { enabled: false, reason: "no-endpoint" };
  return { enabled: true, url, protocol };
}

const isRatioType = (type: SamplerType): boolean => type.endsWith("traceidratio");

function resolveSampler(
  option: SamplerOption | undefined,
  env: Env,
  problems: string[],
): ResolvedConfig["sampler"] {
  const fallback = {
    type: "parentbased_always_on",
    ratio: 1,
    source: "default",
  } as const;
  const name = read(env, "OTEL_TRACES_SAMPLER");
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
        `sampler.type "${String(option.type)}" is not one of ${SAMPLER_TYPES.join(", ")}`,
      );
      return fallback;
    }
    const ratio = option.ratio ?? 1;
    if (!(ratio >= 0 && ratio <= 1)) {
      problems.push(`sampler.ratio ${String(option.ratio)} is not a number from 0 to 1`);
      return fallback;
    }
    return { type: option.type, ratio, source: "option" };
  }

  if (!SAMPLER_TYPES.includes(name as SamplerType)) {
    problems.push(
      `OTEL_TRACES_SAMPLER="${name}" is not one of ${SAMPLER_TYPES.join(", ")}`,
    );
    return fallback;
  }
  const type = name as SamplerType;
  let ratio = 1;
  if (isRatioType(type) && arg !== undefined) {
    ratio = Number(arg);
    if (!(ratio >= 0 && ratio <= 1)) {
      problems.push(
        `OTEL_TRACES_SAMPLER_ARG="${arg}" is not a number from 0 to 1`,
      );
      return fallback;
    }
  }
  return { type, ratio, source: "env" };
}

/** an unusable tuning value is ignored with a warning, as the specification says */
function tuning(env: Env, name: string, warnings: string[]): number | undefined {
  const raw = read(env, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    warnings.push(`${name}="${raw}" is not a non-negative number; using the default`);
    return undefined;
  }
  return value;
}

const batchTuning = (env: Env, prefix: string, warnings: string[]): BatchTuning => ({
  maxQueueSize: tuning(env, `${prefix}_MAX_QUEUE_SIZE`, warnings),
  scheduledDelayMillis: tuning(env, `${prefix}_SCHEDULE_DELAY`, warnings),
  exportTimeoutMillis: tuning(env, `${prefix}_EXPORT_TIMEOUT`, warnings),
  maxExportBatchSize: tuning(env, `${prefix}_MAX_EXPORT_BATCH_SIZE`, warnings),
});

/** `service.name` given through `OTEL_RESOURCE_ATTRIBUTES`, if any */
function serviceNameFromResourceAttributes(env: Env): string | undefined {
  for (const pair of (read(env, "OTEL_RESOURCE_ATTRIBUTES") ?? "").split(",")) {
    const at = pair.indexOf("=");
    if (at > 0 && pair.slice(0, at).trim() === "service.name") {
      try {
        return nonBlank(decodeURIComponent(pair.slice(at + 1)));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Resolve options and environment into an explicit configuration.
 * Throws {@link PresetConfigError} listing every problem found.
 * `OTEL_SDK_DISABLED=true` returns before any validation.
 */
export function resolveConfig(
  options: PresetConfigOptions,
  env: Env,
): Resolution {
  if (read(env, "OTEL_SDK_DISABLED")?.toLowerCase() === "true") {
    return { disabled: true };
  }

  const problems: string[] = [];
  const warnings: string[] = [];

  const serviceName =
    nonBlank(options.serviceName) ??
    read(env, "OTEL_SERVICE_NAME") ??
    serviceNameFromResourceAttributes(env);
  if (!serviceName) {
    problems.push(
      "no service name: pass serviceName to start() or set OTEL_SERVICE_NAME",
    );
  }

  const optionEndpoint = nonBlank(options.endpoint);
  const general = optionEndpoint ?? read(env, "OTEL_EXPORTER_OTLP_ENDPOINT");
  const generalSource =
    optionEndpoint === undefined ? "OTEL_EXPORTER_OTLP_ENDPOINT" : "the endpoint option";

  const signals = {} as Record<Signal, SignalConfig>;
  for (const signal of SIGNALS) {
    signals[signal] = resolveSignal(signal, general, generalSource, env, problems);
  }

  const sampler = resolveSampler(options.sampler, env, problems);

  const config: ResolvedConfig = {
    serviceName: serviceName ?? "",
    serviceNamespace: options.serviceNamespace,
    serviceVersion: options.serviceVersion,
    deploymentEnvironment: options.deploymentEnvironment,
    resourceAttributes: options.resourceAttributes ?? {},
    headers: options.headers,
    signals,
    sampler,
    metricExportIntervalMillis: tuning(env, "OTEL_METRIC_EXPORT_INTERVAL", warnings),
    metricExportTimeoutMillis: tuning(env, "OTEL_METRIC_EXPORT_TIMEOUT", warnings),
    spanBatch: batchTuning(env, "OTEL_BSP", warnings),
    logBatch: batchTuning(env, "OTEL_BLRP", warnings),
    warnings,
  };

  if (problems.length > 0) throw new PresetConfigError(problems);
  return { disabled: false, config };
}
