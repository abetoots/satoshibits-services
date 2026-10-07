import { describe, expect, it } from "vitest";

import type {
  PresetConfigOptions,
  ResolvedConfig,
} from "../../preset/config.mjs";

import { PresetConfigError, resolveConfig } from "../../preset/config.mjs";

type Env = Record<string, string | undefined>;

const NAME = { OTEL_SERVICE_NAME: "svc" };
const ENDPOINT = { ...NAME, OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" };

function resolved(env: Env, options: PresetConfigOptions = {}): ResolvedConfig {
  const result = resolveConfig(options, env);
  if (result.disabled) throw new Error("expected an enabled configuration");
  return result.config;
}

function problems(env: Env, options: PresetConfigOptions = {}): readonly string[] {
  try {
    resolveConfig(options, env);
  } catch (error) {
    if (error instanceof PresetConfigError) return error.problems;
    throw error;
  }
  throw new Error("expected resolveConfig to throw");
}

describe("signals", () => {
  it("turns every signal off, with the reason, when no endpoint is configured", () => {
    expect(resolved(NAME).signals).toEqual({
      traces: { enabled: false, reason: "no-endpoint" },
      metrics: { enabled: false, reason: "no-endpoint" },
      logs: { enabled: false, reason: "not-requested" },
    });
  });

  it("turns traces and metrics on for a general endpoint, and leaves logs off until asked", () => {
    expect(resolved(ENDPOINT).signals).toEqual({
      traces: {
        enabled: true,
        url: "http://collector:4318/v1/traces",
        protocol: "http/protobuf",
      },
      metrics: {
        enabled: true,
        url: "http://collector:4318/v1/metrics",
        protocol: "http/protobuf",
      },
      logs: { enabled: false, reason: "not-requested" },
    });
  });

  it("turns logs on only for an explicit otlp exporter value", () => {
    expect(
      resolved({ ...ENDPOINT, OTEL_LOGS_EXPORTER: "otlp" }).signals.logs,
    ).toEqual({
      enabled: true,
      url: "http://collector:4318/v1/logs",
      protocol: "http/protobuf",
    });
    expect(
      resolved({ ...NAME, OTEL_LOGS_EXPORTER: "otlp" }).signals.logs,
    ).toEqual({ enabled: false, reason: "no-endpoint" });
  });

  it.each([
    ["OTEL_TRACES_EXPORTER", "traces"],
    ["OTEL_METRICS_EXPORTER", "metrics"],
    ["OTEL_LOGS_EXPORTER", "logs"],
  ] as const)("%s=none turns only that signal off", (variable, signal) => {
    const { signals } = resolved({
      ...ENDPOINT,
      OTEL_LOGS_EXPORTER: "otlp",
      [variable]: "none",
    });
    for (const other of ["traces", "metrics", "logs"] as const) {
      expect(signals[other]).toMatchObject(
        other === signal
          ? { enabled: false, reason: "exporter-none" }
          : { enabled: true },
      );
    }
  });

  it("uses a signal-specific endpoint as given, over the general one", () => {
    const { signals } = resolved({
      ...ENDPOINT,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://traces.example/custom/path",
    });
    expect(signals.traces).toMatchObject({
      url: "https://traces.example/custom/path",
    });
    expect(signals.metrics).toMatchObject({
      url: "http://collector:4318/v1/metrics",
    });
  });

  it("turns a signal on from its own endpoint alone", () => {
    const { signals } = resolved({
      ...NAME,
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://m:4318/v1/metrics",
    });
    expect(signals.metrics).toMatchObject({ enabled: true });
    expect(signals.traces).toEqual({ enabled: false, reason: "no-endpoint" });
  });

  it("appends the signal path to a general endpoint with or without a trailing slash", () => {
    expect(
      resolved({ ...NAME, OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318/otlp/" })
        .signals.traces,
    ).toMatchObject({ url: "http://c:4318/otlp/v1/traces" });
  });

  it("lets the endpoint option override the general variable but not a signal-specific one", () => {
    const { signals } = resolved(
      {
        ...ENDPOINT,
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "http://m:4318/v1/metrics",
      },
      { endpoint: "http://from-code:4318" },
    );
    expect(signals.traces).toMatchObject({
      url: "http://from-code:4318/v1/traces",
    });
    expect(signals.metrics).toMatchObject({ url: "http://m:4318/v1/metrics" });
  });

  it("treats a blank variable as unset", () => {
    expect(
      resolved({ ...NAME, OTEL_EXPORTER_OTLP_ENDPOINT: "  " }).signals.traces,
    ).toEqual({ enabled: false, reason: "no-endpoint" });
  });
});

describe("protocol", () => {
  it("honours http/json, and a signal-specific value over the general one", () => {
    const { signals } = resolved({
      ...ENDPOINT,
      OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
      OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "http/protobuf",
    });
    expect(signals.traces).toMatchObject({ protocol: "http/json" });
    expect(signals.metrics).toMatchObject({ protocol: "http/protobuf" });
  });

  it.each([
    [
      { OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" },
      "OTEL_EXPORTER_OTLP_PROTOCOL=grpc is not supported: use http/protobuf or http/json",
    ],
    [
      { OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: "grpc" },
      "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=grpc is not supported: use http/protobuf or http/json",
    ],
    [
      { OTEL_EXPORTER_OTLP_PROTOCOL: "thrift" },
      'OTEL_EXPORTER_OTLP_PROTOCOL="thrift" is not a known protocol: use http/protobuf or http/json',
    ],
  ])("rejects %o", (env, message) => {
    expect(problems({ ...ENDPOINT, ...env })).toContain(message);
  });
});

describe("rejected settings", () => {
  it.each([
    ["OTEL_TRACES_EXPORTER", "console"],
    ["OTEL_METRICS_EXPORTER", "prometheus"],
    ["OTEL_LOGS_EXPORTER", "console"],
    ["OTEL_TRACES_EXPORTER", "otlp,console"],
  ])("rejects %s=%s", (variable, value) => {
    expect(problems({ ...ENDPOINT, [variable]: value })).toEqual([
      `${variable}="${value}" is not supported: use "otlp" or "none"`,
    ]);
  });

  it.each([
    [{ OTEL_EXPORTER_OTLP_ENDPOINT: "not a url" }, "OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL"],
    [
      { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "ftp://x/y" },
      "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT must be an http or https URL",
    ],
  ])("rejects an unusable endpoint %o", (env, message) => {
    expect(problems({ ...NAME, ...env })).toContain(message);
  });

  it("names the option, not the variable, when the endpoint option is unusable", () => {
    expect(problems(ENDPOINT, { endpoint: "::::" })).toContain(
      "the endpoint option is not a valid URL",
    );
  });

  it("never puts an endpoint's value in the message (it can carry credentials)", () => {
    const all = problems({
      ...NAME,
      OTEL_EXPORTER_OTLP_ENDPOINT: "user:hunter2@@ bad",
    }).join("\n");
    expect(all).not.toContain("hunter2");
  });

  it("requires a service name", () => {
    expect(problems({})).toEqual([
      "no service name: pass serviceName to start() or set OTEL_SERVICE_NAME",
    ]);
  });

  it("reports every problem at once", () => {
    expect(
      problems({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318",
        OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
        OTEL_TRACES_SAMPLER: "sometimes",
      }).length,
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("service name", () => {
  it("prefers the option, then OTEL_SERVICE_NAME, then OTEL_RESOURCE_ATTRIBUTES", () => {
    const env = {
      OTEL_SERVICE_NAME: "from-env",
      OTEL_RESOURCE_ATTRIBUTES: "a=b,service.name=from%20attrs",
    };
    expect(resolved(env, { serviceName: "from-code" }).serviceName).toBe("from-code");
    expect(resolved(env).serviceName).toBe("from-env");
    expect(
      resolved({ OTEL_RESOURCE_ATTRIBUTES: env.OTEL_RESOURCE_ATTRIBUTES }).serviceName,
    ).toBe("from attrs");
  });
});

describe("sampler", () => {
  it("defaults to the specification's parent-based always-on", () => {
    expect(resolved(NAME).sampler).toEqual({
      type: "parentbased_always_on",
      ratio: 1,
      source: "default",
    });
  });

  it("takes the variable pair over the option", () => {
    expect(
      resolved(
        {
          ...NAME,
          OTEL_TRACES_SAMPLER: "parentbased_traceidratio",
          OTEL_TRACES_SAMPLER_ARG: "0.25",
        },
        { sampler: { type: "always_off" } },
      ).sampler,
    ).toEqual({ type: "parentbased_traceidratio", ratio: 0.25, source: "env" });
  });

  it("uses the option when the variables are unset", () => {
    expect(
      resolved(NAME, { sampler: { type: "traceidratio", ratio: 0.5 } }).sampler,
    ).toEqual({ type: "traceidratio", ratio: 0.5, source: "option" });
  });

  it("defaults a ratio sampler's missing argument to 1, as the specification says", () => {
    expect(
      resolved({ ...NAME, OTEL_TRACES_SAMPLER: "traceidratio" }).sampler,
    ).toMatchObject({ type: "traceidratio", ratio: 1 });
  });

  it.each([
    [
      { OTEL_TRACES_SAMPLER_ARG: "0.1" },
      {},
      "OTEL_TRACES_SAMPLER_ARG is set without OTEL_TRACES_SAMPLER, so it would have no effect",
    ],
    [
      { OTEL_TRACES_SAMPLER: "sometimes" },
      {},
      /^OTEL_TRACES_SAMPLER="sometimes" is not one of always_on, /,
    ],
    [
      { OTEL_TRACES_SAMPLER: "traceidratio", OTEL_TRACES_SAMPLER_ARG: "1.5" },
      {},
      'OTEL_TRACES_SAMPLER_ARG="1.5" is not a number from 0 to 1',
    ],
    [
      { OTEL_TRACES_SAMPLER: "traceidratio", OTEL_TRACES_SAMPLER_ARG: "half" },
      {},
      'OTEL_TRACES_SAMPLER_ARG="half" is not a number from 0 to 1',
    ],
    [{}, { sampler: { type: "traceidratio", ratio: 2 } }, "sampler.ratio 2 is not a number from 0 to 1"],
    [
      {},
      { sampler: { type: "nope" } },
      /^sampler\.type "nope" is not one of /,
    ],
  ])("rejects %o with options %o", (env, options, message) => {
    const found = problems({ ...NAME, ...env }, options as PresetConfigOptions);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(message);
  });
});

describe("tuning variables", () => {
  it("forwards the metric and batch settings", () => {
    const config = resolved({
      ...NAME,
      OTEL_METRIC_EXPORT_INTERVAL: "1500",
      OTEL_METRIC_EXPORT_TIMEOUT: "700",
      OTEL_BSP_MAX_QUEUE_SIZE: "8",
      OTEL_BSP_SCHEDULE_DELAY: "50",
      OTEL_BSP_EXPORT_TIMEOUT: "900",
      OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "4",
      OTEL_BLRP_SCHEDULE_DELAY: "60",
    });
    expect(config.metricExportIntervalMillis).toBe(1500);
    expect(config.metricExportTimeoutMillis).toBe(700);
    expect(config.spanBatch).toEqual({
      maxQueueSize: 8,
      scheduledDelayMillis: 50,
      exportTimeoutMillis: 900,
      maxExportBatchSize: 4,
    });
    expect(config.logBatch.scheduledDelayMillis).toBe(60);
    expect(config.warnings).toEqual([]);
  });

  it("leaves unset values undefined so the SDK's defaults apply", () => {
    const config = resolved(NAME);
    expect(config.metricExportIntervalMillis).toBeUndefined();
    expect(config.spanBatch.maxQueueSize).toBeUndefined();
  });

  it("ignores an unusable value with a warning instead of failing", () => {
    const config = resolved({
      ...NAME,
      OTEL_METRIC_EXPORT_INTERVAL: "soon",
      OTEL_BSP_MAX_QUEUE_SIZE: "-1",
    });
    expect(config.metricExportIntervalMillis).toBeUndefined();
    expect(config.spanBatch.maxQueueSize).toBeUndefined();
    expect(config.warnings).toEqual([
      'OTEL_METRIC_EXPORT_INTERVAL="soon" is not a non-negative number; using the default',
      'OTEL_BSP_MAX_QUEUE_SIZE="-1" is not a non-negative number; using the default',
    ]);
  });
});

describe("OTEL_SDK_DISABLED", () => {
  it("returns before validating anything", () => {
    expect(
      resolveConfig(
        {},
        { OTEL_SDK_DISABLED: "true", OTEL_EXPORTER_OTLP_PROTOCOL: "grpc" },
      ),
    ).toEqual({ disabled: true });
  });

  it("is only the literal true (any case)", () => {
    expect(resolveConfig({}, { OTEL_SDK_DISABLED: "TRUE" })).toEqual({
      disabled: true,
    });
    expect(
      resolveConfig({}, { ...NAME, OTEL_SDK_DISABLED: "1" }).disabled,
    ).toBe(false);
  });
});
