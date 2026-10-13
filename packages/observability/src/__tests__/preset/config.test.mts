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

  it("appends the signal path to the path of a general endpoint that has a query string", () => {
    expect(
      resolved({ ...NAME, OTEL_EXPORTER_OTLP_ENDPOINT: "https://c.example/base?tenant=a" })
        .signals.traces,
    ).toMatchObject({ url: "https://c.example/base/v1/traces?tenant=a" });
  });

  it("warns when a logs-specific variable is set but logs were never turned on", () => {
    const config = resolved({
      ...ENDPOINT,
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://logs:4318/v1/logs",
      OTEL_EXPORTER_OTLP_LOGS_HEADERS: "a=b",
    });
    expect(config.signals.logs).toEqual({ enabled: false, reason: "not-requested" });
    expect(config.warnings).toEqual([
      "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT, OTEL_EXPORTER_OTLP_LOGS_HEADERS is set but logs are not exported: set OTEL_LOGS_EXPORTER=otlp to turn them on",
    ]);
    expect(resolved(ENDPOINT).warnings).toEqual([]);
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

  it("reads protocol, exporter and sampler names without regard to case", () => {
    const config = resolved({
      ...ENDPOINT,
      OTEL_EXPORTER_OTLP_PROTOCOL: "HTTP/JSON",
      OTEL_METRICS_EXPORTER: "None",
      OTEL_TRACES_SAMPLER: "Always_Off",
    });
    expect(config.signals.traces).toMatchObject({ protocol: "http/json" });
    expect(config.signals.metrics).toEqual({ enabled: false, reason: "exporter-none" });
    expect(config.sampler.type).toBe("always_off");
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

  it("rejects an endpoint with a fragment, which would swallow the signal path", () => {
    expect(problems({ ...NAME, OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318/#frag" })).toEqual([
      "OTEL_EXPORTER_OTLP_ENDPOINT must not contain a fragment (#...)",
    ]);
  });

  it("rejects an unusable general variable even when the endpoint option overrides it", () => {
    // the upstream exporters parse the variable regardless, and print a bad value
    expect(
      problems(
        { ...NAME, OTEL_EXPORTER_OTLP_ENDPOINT: "http://[bad" },
        { endpoint: "http://good:4318" },
      ),
    ).toEqual(["OTEL_EXPORTER_OTLP_ENDPOINT is not a valid URL"]);
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

  it("never echoes a value that is not a short plain token (a URL pasted into the wrong variable)", () => {
    const pasted = "https://user:SENTINEL-PW@collector.example/v1/traces?token=SENTINEL-Q";
    const all = [
      ...problems({ ...ENDPOINT, OTEL_EXPORTER_OTLP_PROTOCOL: pasted }),
      ...problems({ ...ENDPOINT, OTEL_TRACES_EXPORTER: pasted }),
      ...problems({ ...ENDPOINT, OTEL_TRACES_SAMPLER: pasted }),
      ...problems({
        ...ENDPOINT,
        OTEL_TRACES_SAMPLER: "traceidratio",
        OTEL_TRACES_SAMPLER_ARG: pasted,
      }),
      ...resolved({ ...ENDPOINT, OTEL_BSP_SCHEDULE_DELAY: pasted }).warnings,
    ];
    expect(all).toHaveLength(7);
    expect(all.join("\n")).not.toContain("SENTINEL");
    expect(all.join("\n")).not.toContain("collector.example");
    expect(all.filter((p) => p.includes("(a value that is not shown)"))).toHaveLength(7);
  });

  it("reports every problem at once", () => {
    expect(
      problems({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318",
        OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
        OTEL_TRACES_SAMPLER: "sometimes",
      }),
    ).toEqual([
      "no service name: pass serviceName to start() or set OTEL_SERVICE_NAME",
      // once per signal: each one would have used the general protocol
      "OTEL_EXPORTER_OTLP_PROTOCOL=grpc is not supported: use http/protobuf or http/json",
      "OTEL_EXPORTER_OTLP_PROTOCOL=grpc is not supported: use http/protobuf or http/json",
      "OTEL_EXPORTER_OTLP_PROTOCOL=grpc is not supported: use http/protobuf or http/json",
      'OTEL_TRACES_SAMPLER="sometimes" is not one of always_on, always_off, traceidratio, parentbased_always_on, parentbased_always_off, parentbased_traceidratio',
    ]);
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

describe("OTEL_RESOURCE_ATTRIBUTES", () => {
  it("is parsed once: percent-decoded keys and values, the last duplicate winning", () => {
    const config = resolved({
      OTEL_RESOURCE_ATTRIBUTES:
        "service%2Ename=encoded%20name, team = a ,team=b,empty=,url=http%3A%2F%2Fx%3Fa%3Db",
    });
    expect(config.serviceName).toBe("encoded name");
    expect(config.environmentAttributes).toEqual({
      "service.name": "encoded name",
      team: "b",
      empty: "",
      url: "http://x?a=b",
    });
    expect(config.warnings).toEqual([]);
  });

  it.each(["a=b,novalue", "=x", "a=%E0%A4%A"])(
    "discards all of a malformed value (%s), with a warning, as the specification says",
    (value) => {
      const config = resolved({ ...NAME, OTEL_RESOURCE_ATTRIBUTES: value });
      expect(config.environmentAttributes).toEqual({});
      expect(config.warnings).toEqual([
        "OTEL_RESOURCE_ATTRIBUTES is malformed (expected key=value pairs separated by commas, percent-encoded); all of it is ignored",
      ]);
    },
  );

  it("does not take a service name from a value it discards", () => {
    expect(problems({ OTEL_RESOURCE_ATTRIBUTES: "service.name=x,broken" })).toEqual([
      "no service name: pass serviceName to start() or set OTEL_SERVICE_NAME",
    ]);
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

  it("warns that an argument given to a sampler that takes none is ignored", () => {
    const config = resolved({
      ...NAME,
      OTEL_TRACES_SAMPLER: "always_on",
      OTEL_TRACES_SAMPLER_ARG: "0.1",
    });
    expect(config.sampler).toMatchObject({ type: "always_on", ratio: 1 });
    expect(config.warnings).toEqual([
      "OTEL_TRACES_SAMPLER_ARG is ignored: the always_on sampler takes no argument",
    ]);
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

  it.each([
    ["OTEL_METRIC_EXPORT_INTERVAL", "soon", "number"],
    ["OTEL_METRIC_EXPORT_INTERVAL", "0", "number"],
    ["OTEL_METRIC_EXPORT_TIMEOUT", "-5", "number"],
    ["OTEL_BSP_SCHEDULE_DELAY", "Infinity", "number"],
    ["OTEL_BSP_SCHEDULE_DELAY", "99999999999", "number"],
    ["OTEL_BSP_EXPORT_TIMEOUT", "0", "number"],
    // a zero batch size makes the processor export empty batches forever; a zero queue drops everything
    ["OTEL_BSP_MAX_EXPORT_BATCH_SIZE", "0", "whole number"],
    ["OTEL_BSP_MAX_QUEUE_SIZE", "0", "whole number"],
    ["OTEL_BSP_MAX_QUEUE_SIZE", "-1", "whole number"],
    ["OTEL_BSP_MAX_EXPORT_BATCH_SIZE", "0.5", "whole number"],
    ["OTEL_BLRP_MAX_EXPORT_BATCH_SIZE", "0", "whole number"],
    ["OTEL_BLRP_MAX_QUEUE_SIZE", "1.5", "whole number"],
  ])("ignores %s=%s with a warning instead of failing or forwarding it", (variable, value, kind) => {
    const config = resolved({ ...NAME, [variable]: value });
    expect(config.warnings).toEqual([
      `${variable}="${value}" is not a positive ${kind}; using the default`,
    ]);
    expect([
      config.metricExportIntervalMillis,
      config.metricExportTimeoutMillis,
      ...(Object.values(config.spanBatch) as unknown[]),
      ...(Object.values(config.logBatch) as unknown[]),
    ]).toEqual(Array.from({ length: 10 }, () => undefined));
  });

  it("accepts a fractional delay but only whole sizes", () => {
    const config = resolved({
      ...NAME,
      OTEL_BSP_SCHEDULE_DELAY: "0.5",
      OTEL_BSP_MAX_QUEUE_SIZE: "1",
    });
    expect(config.spanBatch.scheduledDelayMillis).toBe(0.5);
    expect(config.spanBatch.maxQueueSize).toBe(1);
    expect(config.warnings).toEqual([]);
  });

  it("uses the interval as the timeout, with a warning, when the timeout is the larger", () => {
    // the upstream reader refuses to be constructed otherwise
    const config = resolved({
      ...NAME,
      OTEL_METRIC_EXPORT_INTERVAL: "200",
      OTEL_METRIC_EXPORT_TIMEOUT: "500",
    });
    expect(config.metricExportIntervalMillis).toBe(200);
    expect(config.metricExportTimeoutMillis).toBe(200);
    expect(config.warnings).toEqual([
      "OTEL_METRIC_EXPORT_TIMEOUT is greater than OTEL_METRIC_EXPORT_INTERVAL; using the interval as the timeout",
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
