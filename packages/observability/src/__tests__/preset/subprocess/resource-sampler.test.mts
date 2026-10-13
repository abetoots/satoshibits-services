/**
 * What identifies the process on exported data, and which traces are kept.
 * Asserted at a local OTLP sink, in a fresh process per case.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { OtlpSink } from "../../../testing/otlp-sink.mjs";

import { runChild, useSinks } from "./harness.mjs";

const sinks = useSinks();

let sink: OtlpSink;
beforeEach(() => {
  ({ sink } = sinks);
});

/** all three signals on, to the test's sink */
const allSignals = (extra: Record<string, string> = {}) => ({
  OTEL_SERVICE_NAME: "resource-test",
  OTEL_EXPORTER_OTLP_ENDPOINT: sink.url,
  OTEL_LOGS_EXPORTER: "otlp",
  ...extra,
});

/** the resource attributes seen on each signal; fails when a signal sent nothing */
function resourcesBySignal(): Record<"traces" | "metrics" | "logs", Record<string, unknown>> {
  const span = sink.spans()[0];
  const metric = sink.metrics().find((m) => m.name === "child_counter");
  const log = sink.logRecords()[0];
  expect(span, "a span arrived").toBeDefined();
  expect(metric, "a metric arrived").toBeDefined();
  expect(log, "a log record arrived").toBeDefined();
  return { traces: span!.resource, metrics: metric!.resource, logs: log!.resource };
}

describe("resource", () => {
  it("carries the configured name, namespace, version, environment, an instance id and the OS type on every signal", async () => {
    const run = await runChild(
      {
        options: {
          serviceNamespace: "websand",
          serviceVersion: "1.2.3",
          deploymentEnvironment: "staging",
          resourceAttributes: { "team.name": "platform" },
        },
      },
      allSignals(),
    );

    expect(run.result.startError).toBeNull();
    for (const [signal, resource] of Object.entries(resourcesBySignal())) {
      expect(resource, signal).toMatchObject({
        "service.name": "resource-test",
        "service.namespace": "websand",
        "service.version": "1.2.3",
        "deployment.environment.name": "staging",
        "team.name": "platform",
        "telemetry.sdk.language": "nodejs",
      });
      expect(resource["service.instance.id"], signal).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(typeof resource["os.type"], signal).toBe("string");
    }
  });

  it("drops host, command line, executable path and OS user keys, whether from options, the environment or a detector", async () => {
    const run = await runChild(
      {
        options: {
          resourceAttributes: {
            "host.id": "machine-id-from-options",
            "process.owner": "root-from-options",
          },
        },
      },
      allSignals({
        OTEL_RESOURCE_ATTRIBUTES:
          "host.name=box-from-env,process.command_line=node%20secret-arg,process.command_args=arg-from-env," +
          "process.executable.path=/opt/from-env,process.owner=owner-from-env," +
          "process.user.name=user-from-env,process.real_user.id=1000,kept.key=kept-value",
      }),
    );

    expect(run.result.startError).toBeNull();
    for (const [signal, resource] of Object.entries(resourcesBySignal())) {
      const keys = Object.keys(resource);
      expect(
        keys.filter((key) => /^(host\.|process\.|os\.(description|version))/.test(key)),
        signal,
      ).toEqual([]);
      expect(resource["kept.key"], signal).toBe("kept-value");
    }
    for (const request of sink.requests) {
      for (const value of [
        "machine-id-from-options",
        "root-from-options",
        "box-from-env",
        "secret-arg",
        "arg-from-env",
        "/opt/from-env",
        "owner-from-env",
        "user-from-env",
      ]) {
        expect(request.bodyText, `${request.path} contains ${value}`).not.toContain(value);
      }
    }
  });

  // the resource is a surface of the policy the application named; the preset decides nothing itself
  const RESOURCE_VALUES =
    "api_key=SENTINEL-RESOURCE-SECRET,owner.contact=alice.sentinel@example.com,plain.key=plain-value";

  it("hands the resource to the named policy as the resource surface, on every signal, identity keys aside", async () => {
    const run = await runChild(
      { redaction: "probe" },
      allSignals({ OTEL_RESOURCE_ATTRIBUTES: RESOURCE_VALUES }),
    );

    expect(run.result.startError).toBeNull();
    expect(Object.keys(resourcesBySignal()).sort()).toEqual(["logs", "metrics", "traces"]);
    for (const [signal, resource] of Object.entries(resourcesBySignal())) {
      expect(resource.api_key, signal).toBe("[probe:resource] SENTINEL-RESOURCE-SECRET");
      expect(resource["owner.contact"], signal).toBe("[probe:resource] alice.sentinel@example.com");
      expect(resource["plain.key"], signal).toBe("[probe:resource] plain-value");
      // the two identity keys never pass the policy: a changed name would merge services
      expect(resource["service.name"], signal).toBe("resource-test");
      expect(String(resource["service.instance.id"]), signal).not.toContain("[probe");
    }
  });

  it("exports the resource as given under redaction: false (the preset masks nothing by default)", async () => {
    const run = await runChild({}, allSignals({ OTEL_RESOURCE_ATTRIBUTES: RESOURCE_VALUES }));

    expect(run.result.startError).toBeNull();
    for (const [signal, resource] of Object.entries(resourcesBySignal())) {
      expect(resource.api_key, signal).toBe("SENTINEL-RESOURCE-SECRET");
      expect(resource["owner.contact"], signal).toBe("alice.sentinel@example.com");
      expect(resource["plain.key"], signal).toBe("plain-value");
    }
  });

  it("ignores a malformed OTEL_RESOURCE_ATTRIBUTES whole, and says so", async () => {
    const run = await runChild(
      {},
      allSignals({ OTEL_RESOURCE_ATTRIBUTES: "team.name=a,broken-entry" }),
    );
    expect(run.result.startError).toBeNull();
    expect(sink.spans()[0]!.resource["team.name"]).toBeUndefined();
    expect(run.stderrLines.map((line) => line.msg)).toContain(
      "OTEL_RESOURCE_ATTRIBUTES is malformed (expected key=value pairs separated by commas, percent-encoded); all of it is ignored",
    );
  });

  const SCOPE = {
    scopeName: "scope carol.sentinel@example.com",
    scopeAttributes: { api_key: "SENTINEL-SCOPE-SECRET", plain: "kept" },
  };
  const scopesSeen = () => ({
    span: sink.spans().find((s) => s.name === "child-span-0")?.scope,
    metric: sink.metrics().find((m) => m.name === "child_counter")?.scope,
    // the body is a log-record surface, which this batch does not yet pass to the policy
    log: sink.logRecords().find((r) => String(r.body).includes("child-log-line"))?.scope,
  });

  it("hands a scope's name and attributes to the named policy, on every signal that carries one", async () => {
    const run = await runChild({ ...SCOPE, redaction: "probe" }, allSignals());

    expect(run.result.startError).toBeNull();
    const { span, metric, log } = scopesSeen();
    expect(span?.name).toBe("[probe:scope.name] scope carol.sentinel@example.com");
    expect(metric?.name).toBe("[probe:scope.name] scope carol.sentinel@example.com");
    expect(log?.name).toBe("[probe:scope.name] scope carol.sentinel@example.com");
    // the logger's scope attributes (the API gives tracers and meters none)
    expect(log?.attributes).toEqual({
      api_key: "[probe:scope] SENTINEL-SCOPE-SECRET",
      plain: "[probe:scope] kept",
    });
    // metric attributes are not a surface: labels are exported as the code set them
    expect(sink.metrics().find((m) => m.name === "child_counter")?.points).toEqual([
      { attributes: {}, value: 1 },
    ]);
  });

  it("exports a scope as given under redaction: false", async () => {
    const run = await runChild(SCOPE, allSignals());

    expect(run.result.startError).toBeNull();
    const { span, metric, log } = scopesSeen();
    expect(span?.name).toBe(SCOPE.scopeName);
    expect(metric?.name).toBe(SCOPE.scopeName);
    expect(log?.name).toBe(SCOPE.scopeName);
    expect(log?.attributes).toEqual(SCOPE.scopeAttributes);
  });

  it("gives each process its own instance id, which the environment cannot pin", async () => {
    const env = allSignals({ OTEL_RESOURCE_ATTRIBUTES: "service.instance.id=pinned" });
    await runChild({}, env);
    await runChild({}, env);
    const ids = sink.spans().map((s) => s.resource["service.instance.id"]);
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain("pinned");
    expect(new Set(ids).size).toBe(2);
  });

  it("a name passed to start() beats OTEL_SERVICE_NAME; the environment beats options for other keys", async () => {
    await runChild(
      {
        options: {
          serviceName: "name-from-code",
          serviceVersion: "from-code",
          resourceAttributes: { "team.name": "from-code" },
        },
      },
      allSignals({
        OTEL_RESOURCE_ATTRIBUTES:
          "service.name=name-from-attributes,service.version=from-env,team.name=from-env",
      }),
    );
    expect(sink.spans()[0]!.resource).toMatchObject({
      "service.name": "name-from-code",
      "service.version": "from-env",
      "team.name": "from-env",
    });
  });

  it("refuses to start without a service name", async () => {
    const run = await runChild({}, { OTEL_EXPORTER_OTLP_ENDPOINT: sink.url });
    expect(run.result.startError).toContain(
      "no service name: pass serviceName to start() or set OTEL_SERVICE_NAME",
    );
    expect(run.result.status.state).toBe("not-started");
    expect(sink.connections).toEqual([]);
  });
});

describe("sampler", () => {
  it("samples every root span by default", async () => {
    const run = await runChild({ spans: 5 }, allSignals());
    expect(run.result.spans.map((s) => s.sampled)).toEqual([true, true, true, true, true]);
    expect(sink.spans()).toHaveLength(5);
    expect(run.result.status.sampler).toBe("parentbased_always_on");
  });

  it("applies the OTEL_TRACES_SAMPLER pair: spans keep valid ids but none is exported", async () => {
    const run = await runChild(
      { spans: 5 },
      allSignals({
        OTEL_TRACES_SAMPLER: "parentbased_traceidratio",
        OTEL_TRACES_SAMPLER_ARG: "0",
      }),
    );
    expect(run.result.startError).toBeNull();
    expect(run.result.spans.map((s) => s.sampled)).toEqual([false, false, false, false, false]);
    expect(run.result.spans.every((s) => s.valid)).toBe(true);
    expect(sink.requestsTo("/v1/traces")).toEqual([]);
    // the other signals are unaffected, which also shows the process did export
    expect(sink.metrics().map((m) => m.name)).toContain("child_counter");
    expect(run.result.status.sampler).toBe("parentbased_traceidratio(0)");
  });

  it("samples a share of traces for a ratio between 0 and 1", async () => {
    const run = await runChild(
      { spans: 50 },
      allSignals({ OTEL_TRACES_SAMPLER: "traceidratio", OTEL_TRACES_SAMPLER_ARG: "0.5" }),
    );
    const sampled = run.result.spans.filter((s) => s.sampled).length;
    // 50 fair coin flips land outside 5..45 about once in 10^9 runs
    expect(sampled).toBeGreaterThan(4);
    expect(sampled).toBeLessThan(46);
    expect(sink.spans()).toHaveLength(sampled);
  });

  it("uses the sampler option when the variables are unset", async () => {
    const run = await runChild(
      { spans: 3, options: { sampler: { type: "always_off" } } },
      allSignals(),
    );
    expect(run.result.spans.map((s) => s.sampled)).toEqual([false, false, false]);
    expect(sink.requestsTo("/v1/traces")).toEqual([]);
    expect(run.result.status.sampler).toBe("always_off");
  });

  it("lets the variable win over the sampler option", async () => {
    const run = await runChild(
      { spans: 2, options: { sampler: { type: "always_off" } } },
      allSignals({ OTEL_TRACES_SAMPLER: "always_on" }),
    );
    expect(run.result.spans.map((s) => s.sampled)).toEqual([true, true]);
    expect(sink.spans()).toHaveLength(2);
  });

  it.each([
    [
      { OTEL_TRACES_SAMPLER_ARG: "0.1" },
      "OTEL_TRACES_SAMPLER_ARG is set without OTEL_TRACES_SAMPLER, so it would have no effect",
    ],
    [
      { OTEL_TRACES_SAMPLER: "sometimes" },
      'OTEL_TRACES_SAMPLER="sometimes" is not one of',
    ],
    [
      { OTEL_TRACES_SAMPLER: "traceidratio", OTEL_TRACES_SAMPLER_ARG: "7" },
      'OTEL_TRACES_SAMPLER_ARG="7" is not a number from 0 to 1',
    ],
  ])("refuses to start for %o", async (env, message) => {
    const run = await runChild({}, allSignals(env));
    expect(run.result.startError).toContain(message);
    expect(run.result.status.state).toBe("not-started");
    expect(sink.connections).toEqual([]);
  });
});
