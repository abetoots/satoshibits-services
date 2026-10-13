/**
 * The wrapper every exporter sits behind, exercised through the real `start()`
 * with exporters a test controls.
 */

import { diag, metrics, trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { ExportResultCode, globalErrorHandler } from "@opentelemetry/core";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { OTLPLogExporter as JsonLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPLogExporter as ProtoLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { OTLPMetricExporter as JsonMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPMetricExporter as ProtoMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPTraceExporter as JsonTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as ProtoTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DiagnosticsEvent } from "../../preset/diagnostics.mjs";
import type { TestExporters } from "../../preset/runtime.mjs";
import type { ExportResult } from "@opentelemetry/core";

import { getStatus } from "../../preset.mjs";
import { createDiagnostics } from "../../preset/diagnostics.mjs";
import {
  createLogRecordExporter,
  createMetricExporter,
  createSpanExporter,
  wasReportedByExporter,
  wrapLogRecordExporter,
  wrapMetricExporter,
  wrapSpanExporter,
} from "../../preset/exporters.mjs";
import { createRedactor } from "../../preset/redaction.mjs";
import { forceFlush, resetForTesting, start } from "../../preset/runtime.mjs";
import { startTestTelemetry } from "../../testing/in-memory.mjs";

afterEach(async () => {
  vi.unstubAllEnvs();
  await resetForTesting();
});

function startWith(testExporters: TestExporters) {
  const events: DiagnosticsEvent[] = [];
  start({
    serviceName: "wrapper-test",
    instrumentations: false,
    loaderHook: false,
    diagnostics: () => (event) => events.push(event),
    redaction: false,
    testExporters,
  });
  return events;
}

const throwing = (message: string) => ({
  export: () => {
    throw new Error(message);
  },
  shutdown: () => Promise.resolve(),
  forceFlush: () => Promise.resolve(),
});

describe("exporter wrapper", () => {
  it.each([
    [
      "traces",
      { spanExporter: throwing("span exporter blew up") },
      () => trace.getTracer("t").startSpan("s").end(),
    ],
    [
      "metrics",
      { metricExporter: throwing("metric exporter blew up") },
      () => metrics.getMeter("m").createCounter("c").add(1),
    ],
    [
      "logs",
      { logRecordExporter: throwing("log exporter blew up") },
      () => logs.getLogger("l").emit({ body: "b" }),
    ],
  ] as const)(
    "answers an exporter that throws (%s) with a failed result and one report, and never throws at the caller",
    async (signal, testExporters, emit) => {
      const events = startWith(testExporters as TestExporters);

      expect(emit).not.toThrow();
      // the metric reader rejects a flush whose export failed; spans and logs do not
      await forceFlush().catch(() => undefined);

      const reports = events.filter((e) => e.message === `${signal} export failed`);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ level: "error", fields: { signal, error: "Error" } });
      // the thrown text is the exporter's own; it is not copied into the report
      expect(JSON.stringify(reports[0])).not.toContain("blew up");
      expect(getStatus().state).toBe("running");
    },
  );

  it("answers once when an exporter answers and then throws, answers twice, or the callback itself throws", () => {
    const reports: DiagnosticsEvent[] = [];
    const context = {
      diagnostics: createDiagnostics({ sinkFactory: () => (e) => reports.push(e) }),
      redactor: createRedactor(false),
    };
    context.diagnostics.activate();

    const answers: ExportResult[] = [];
    wrapSpanExporter(
      {
        export: (_spans, callback) => {
          callback({ code: ExportResultCode.SUCCESS });
          throw new Error("thrown after answering");
        },
        shutdown: () => Promise.resolve(),
      },
      context,
    ).export([], (result) => answers.push(result));
    expect(answers.map((a) => a.code)).toEqual([ExportResultCode.SUCCESS]);
    // the export succeeded: nothing to report
    expect(reports).toEqual([]);

    const twice: ExportResult[] = [];
    wrapSpanExporter(
      {
        export: (_spans, callback) => {
          callback({ code: ExportResultCode.SUCCESS });
          callback({ code: ExportResultCode.FAILED });
        },
        shutdown: () => Promise.resolve(),
      },
      context,
    ).export([], (result) => twice.push(result));
    expect(twice.map((a) => a.code)).toEqual([ExportResultCode.SUCCESS]);

    let calls = 0;
    expect(() =>
      wrapSpanExporter(
        {
          export: (_spans, callback) => callback({ code: ExportResultCode.SUCCESS }),
          shutdown: () => Promise.resolve(),
        },
        context,
      ).export([], () => {
        calls++;
        throw new Error("the processor's callback threw");
      }),
    ).not.toThrow();
    expect(calls).toBe(1);
  });

  // each signal's wrapper, given an inner `export` and the processor's callback
  type Callback = (result: ExportResult) => void;
  type InnerExport = (records: unknown, callback: Callback) => void;
  const rest = { shutdown: () => Promise.resolve(), forceFlush: () => Promise.resolve() };
  const WRAPPERS: [string, (inner: InnerExport, context: Parameters<typeof wrapSpanExporter>[1]) => (callback: Callback) => void][] = [
    ["traces", (inner, context) => (callback) => wrapSpanExporter({ export: inner, ...rest }, context).export([], callback)],
    [
      "metrics",
      (inner, context) => (callback) =>
        wrapMetricExporter({ export: inner, ...rest }, context).export(
          { resource: {} as never, scopeMetrics: [] },
          callback,
        ),
    ],
    ["logs", (inner, context) => (callback) => wrapLogRecordExporter({ export: inner, ...rest }, context).export([], callback)],
  ];

  describe.each(WRAPPERS)("for %s", (signal, wrap) => {
    function collecting() {
      const reports: DiagnosticsEvent[] = [];
      const diagnostics = createDiagnostics({ sinkFactory: () => (e) => reports.push(e) });
      diagnostics.activate();
      return { reports, context: { diagnostics, redactor: createRedactor(false) } };
    }
    const throwingCallback = () => {
      let calls = 0;
      return {
        calls: () => calls,
        callback: () => {
          calls++;
          throw new Error("the processor's callback threw SENTINEL");
        },
      };
    };

    it("keeps a throwing callback's exception from an exporter that threw first", () => {
      const { reports, context } = collecting();
      const { calls, callback } = throwingCallback();
      const exportIt = wrap(() => {
        throw new TypeError("exporter threw");
      }, context);

      expect(() => exportIt(callback)).not.toThrow();
      expect(calls()).toBe(1);
      expect(reports.map((r) => [r.message, r.fields?.error])).toEqual([
        [`${signal} export failed`, "TypeError"],
        [`${signal} export result could not be handed back`, "Error"],
      ]);
      expect(JSON.stringify(reports)).not.toContain("SENTINEL");
    });

    it("keeps a throwing callback's exception from an exporter that answers later", () => {
      const { reports, context } = collecting();
      const { calls, callback } = throwingCallback();
      let answer: Callback | undefined;
      wrap((_records, given) => {
        answer = given;
      }, context)(callback);
      expect(calls()).toBe(0);

      // the exporter answers from its own promise chain, after export() has returned
      expect(() => answer!({ code: ExportResultCode.SUCCESS })).not.toThrow();
      expect(calls()).toBe(1);
      expect(reports.map((r) => r.message)).toEqual([
        `${signal} export result could not be handed back`,
      ]);
    });

    it("hears only the first answer: a failure after a success is neither passed on nor reported", () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      wrap((_records, given) => {
        given({ code: ExportResultCode.SUCCESS });
        given({ code: ExportResultCode.FAILED, error: new Error("too late") });
      }, context)((result) => answers.push(result));

      expect(answers.map((a) => a.code)).toEqual([ExportResultCode.SUCCESS]);
      expect(reports).toEqual([]);
    });

    it("answers with a failure when the exporter's answer is no result at all", () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      wrap((_records, given) => given(undefined as never), context)((result) => answers.push(result));

      expect(answers.map((a) => a.code)).toEqual([ExportResultCode.FAILED]);
      expect(reports.map((r) => r.message)).toEqual([`${signal} export failed`]);
    });

    it("still answers when reporting the failure itself throws", () => {
      const answers: ExportResult[] = [];
      const diagnostics = createDiagnostics();
      const context = { diagnostics, redactor: createRedactor(false) };
      vi.spyOn(diagnostics, "report").mockImplementation(() => {
        throw new Error("diagnostics is broken");
      });
      wrap((_records, given) => given({ code: ExportResultCode.FAILED }), context)((result) =>
        answers.push(result),
      );
      expect(answers.map((a) => a.code)).toEqual([ExportResultCode.FAILED]);
    });

    it("lets nothing out when the callback throws and reporting that throws too", () => {
      const diagnostics = createDiagnostics();
      const context = { diagnostics, redactor: createRedactor(false) };
      vi.spyOn(diagnostics, "report").mockImplementation(() => {
        throw new Error("diagnostics is broken");
      });
      const { calls, callback } = throwingCallback();
      let answer: Callback | undefined;
      wrap((_records, given) => {
        answer = given;
      }, context)(callback);

      expect(() => answer!({ code: ExportResultCode.SUCCESS })).not.toThrow();
      expect(calls()).toBe(1);
    });

    it("answers and reports a failure when an exporter written as an async function rejects", async () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      wrap(
        (() => Promise.reject(new RangeError("rejected"))) as unknown as InnerExport,
        context,
      )((result) => answers.push(result));
      await new Promise((resolve) => setImmediate(resolve));

      expect(answers.map((a) => [a.code, a.error?.name])).toEqual([
        [ExportResultCode.FAILED, "RangeError"],
      ]);
      expect(reports.map((r) => [r.message, r.fields?.error])).toEqual([
        [`${signal} export failed`, "RangeError"],
      ]);
    });

    it("gives a failure whose error is not an error object one it has marked, without its text", () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      wrap(
        (_records, given) =>
          given({ code: ExportResultCode.FAILED, error: "SENTINEL from the far end" as never }),
        context,
      )((result) => answers.push(result));

      expect(answers.map((a) => a.code)).toEqual([ExportResultCode.FAILED]);
      expect(answers[0]!.error).toBeInstanceOf(Error);
      expect(wasReportedByExporter(answers[0]!.error)).toBe(true);
      expect(reports.map((r) => [r.message, r.fields?.error])).toEqual([
        [`${signal} export failed`, "Error"],
      ]);
      expect(JSON.stringify([reports, answers[0]!.error!.message])).not.toContain("SENTINEL");
    });

    // values an exporter may throw or reject with that are not errors: one with text that must
    // not travel, and one that cannot be turned into text at all
    const NOT_ERRORS: [string, () => unknown][] = [
      ["a string", () => "SENTINEL from the far end"],
      ["an object that cannot be printed", () => Object.create(null) as unknown],
    ];

    it.each(NOT_ERRORS)("answers once, with a marked error, when the exporter throws %s", (_what, value) => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      const exportIt = wrap(() => {
        throw value();
      }, context);

      expect(() => exportIt((result) => answers.push(result))).not.toThrow();
      expect(answers.map((a) => [a.code, a.error?.message])).toEqual([
        [ExportResultCode.FAILED, "export failed with a value that is not an error"],
      ]);
      expect(wasReportedByExporter(answers[0]!.error)).toBe(true);
      expect(reports.map((r) => r.message)).toEqual([`${signal} export failed`]);
    });

    it.each(NOT_ERRORS)("answers once, with a marked error, when the exporter rejects with %s", async (_what, value) => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-error rejection is the case under test
      wrap((() => Promise.reject(value())) as unknown as InnerExport, context)((result) =>
        answers.push(result),
      );
      await new Promise((resolve) => setImmediate(resolve));

      expect(answers.map((a) => [a.code, a.error?.message])).toEqual([
        [ExportResultCode.FAILED, "export failed with a value that is not an error"],
      ]);
      expect(reports.map((r) => r.message)).toEqual([`${signal} export failed`]);
    });

    // values built to throw when looked at: a proxy that will not say what it is
    const hostile = (): unknown =>
      new Proxy(
        {},
        {
          getPrototypeOf: () => {
            throw new Error("SENTINEL from a proxy");
          },
        },
      );
    const answeredOnceWithAFailure = (answers: ExportResult[]) => {
      expect(answers.map((a) => [a.code, a.error?.message])).toEqual([
        [ExportResultCode.FAILED, "export failed with a value that is not an error"],
      ]);
      expect(wasReportedByExporter(answers[0]!.error)).toBe(true);
    };

    it("answers once when the exporter throws something that cannot even be examined", () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      const exportIt = wrap(() => {
        throw hostile();
      }, context);

      expect(() => exportIt((result) => answers.push(result))).not.toThrow();
      answeredOnceWithAFailure(answers);
      expect(reports.map((r) => r.message)).toEqual([`${signal} export failed`]);
    });

    it.each([
      ["before any answer", false],
      ["after a success", true],
    ])("leaves nothing unhandled when the exporter rejects with such a thing %s", async (_when, answerFirst) => {
      const { context } = collecting();
      const answers: ExportResult[] = [];
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        wrap(
          ((_records: unknown, given: Callback) => {
            if (answerFirst) given({ code: ExportResultCode.SUCCESS });
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-error rejection is the case under test
            return Promise.reject(hostile());
          }) as unknown as InnerExport,
          context,
        )((result) => answers.push(result));
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }

      expect(unhandled).toEqual([]);
      if (answerFirst) expect(answers.map((a) => a.code)).toEqual([ExportResultCode.SUCCESS]);
      else answeredOnceWithAFailure(answers);
    });

    it.each([
      [
        "its code cannot be read",
        () => ({
          get code(): never {
            throw new Error("SENTINEL");
          },
        }),
      ],
      [
        "its error cannot be read",
        () => ({
          code: ExportResultCode.FAILED,
          get error(): never {
            throw new Error("SENTINEL");
          },
        }),
      ],
    ])("answers once with a marked failure when the exporter's answer is one where %s", (_what, answer) => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      const exportIt = wrap((_records, given) => given(answer() as never), context);

      expect(() => exportIt((result) => answers.push(result))).not.toThrow();
      expect(answers.map((a) => [a.code, a.error?.message])).toEqual([
        [ExportResultCode.FAILED, "export failed"],
      ]);
      expect(wasReportedByExporter(answers[0]!.error)).toBe(true);
      expect(reports.map((r) => r.message)).toEqual([`${signal} export failed`]);
    });

    it("reads the answer once: a success that would read differently the second time is a success", () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      let reads = 0;
      const answer = {
        get code(): ExportResultCode {
          if (reads++ > 0) throw new Error("read a second time");
          return ExportResultCode.SUCCESS;
        },
      };
      let late: Callback | undefined;
      wrap((_records, given) => {
        late = given;
      }, context)((result) => answers.push(result));

      // after export() has returned, so nothing but the wrapper stands between this and the exporter
      expect(() => late!(answer as never)).not.toThrow();
      expect(answers).toEqual([{ code: ExportResultCode.SUCCESS }]);
      expect(reports).toEqual([]);
    });

    it("hears a rejection from a thenable whose then() throws", async () => {
      const { context } = collecting();
      const answers: ExportResult[] = [];
      const thenable = {
        then: () => {
          throw new RangeError("then threw");
        },
      };
      wrap((() => thenable) as unknown as InnerExport, context)((result) => answers.push(result));
      await new Promise((resolve) => setImmediate(resolve));

      expect(answers.map((a) => [a.code, a.error?.name])).toEqual([
        [ExportResultCode.FAILED, "RangeError"],
      ]);
      expect(wasReportedByExporter(answers[0]!.error)).toBe(true);
    });

    it("reports what it can read of an error, and reports it, when part of it cannot be read", () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      const partly = Object.defineProperty(
        Object.assign(new Error("m"), { code: 401 }),
        "message",
        {
          get: (): never => {
            throw new Error("SENTINEL");
          },
        },
      );
      wrap((_records, given) => given({ code: ExportResultCode.FAILED, error: partly }), context)(
        (result) => answers.push(result),
      );

      expect(answers.map((a) => a.code)).toEqual([ExportResultCode.FAILED]);
      // not silent, and the status that could be read is still there
      expect(reports.map((r) => [r.message, r.fields])).toEqual([
        [`${signal} export failed`, { signal, status: 401, error: "Error" }],
      ]);
    });

    it("calls the then() it examined, once: a rejection is heard even if then cannot be read again", async () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const rejected = Promise.reject(new RangeError("rejected"));
        let reads = 0;
        // (the promise is handed to the wrapper below; defineProperty only returns it)
        void Object.defineProperty(rejected, "then", {
          get: () => {
            if (reads++ > 0) throw new Error("then read a second time");
            // eslint-disable-next-line @typescript-eslint/unbound-method -- handed back unbound, as a property read would
            return Promise.prototype.then;
          },
        });
        wrap((() => rejected) as unknown as InnerExport, context)((result) => answers.push(result));
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }

      expect(answers.map((a) => [a.code, a.error?.name])).toEqual([
        [ExportResultCode.FAILED, "RangeError"],
      ]);
      expect(reports.map((r) => r.message)).toEqual([`${signal} export failed`]);
      expect(unhandled).toEqual([]);
    });

    it("is not thrown by a thenable that fulfils, however it calls back", async () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        // an awaitable written by hand: it calls its first argument without checking it
        const awaitable = {
          then: (resolve: () => void, reject: (reason: unknown) => void) => {
            void Promise.resolve().then(() => {
              resolve();
            }, reject);
          },
        };
        wrap(
          ((_records: unknown, given: Callback) => {
            given({ code: ExportResultCode.SUCCESS });
            return awaitable;
          }) as unknown as InnerExport,
          context,
        )((result) => answers.push(result));
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }

      expect(answers.map((a) => a.code)).toEqual([ExportResultCode.SUCCESS]);
      expect(reports).toEqual([]);
      expect(unhandled).toEqual([]);
    });

    it("names a callback's error by a plain name only", () => {
      const { reports, context } = collecting();
      const odd = Object.assign(new Error("m"), { name: { url: "http://u:SENTINEL@h.example/p" } });
      wrap((_records, given) => given({ code: ExportResultCode.SUCCESS }), context)(() => {
        throw odd;
      });
      expect(reports.map((r) => [r.message, r.fields?.error])).toEqual([
        [`${signal} export result could not be handed back`, "Error"],
      ]);
    });

    it("hears a rejection from something that is only like a promise", async () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      const thenable = {
        then: (_resolve: unknown, reject: (reason: unknown) => void) => reject(new RangeError("rejected")),
      };
      wrap((() => thenable) as unknown as InnerExport, context)((result) => answers.push(result));
      await new Promise((resolve) => setImmediate(resolve));

      expect(answers.map((a) => [a.code, a.error?.name])).toEqual([
        [ExportResultCode.FAILED, "RangeError"],
      ]);
      expect(reports.map((r) => r.message)).toEqual([`${signal} export failed`]);
    });

    it("lets a rejection that follows a success pass quietly: no second answer, nothing unhandled", async () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        wrap(
          ((_records: unknown, given: Callback) => {
            given({ code: ExportResultCode.SUCCESS });
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-error rejection is the case under test
            return Promise.reject(Object.create(null));
          }) as unknown as InnerExport,
          context,
        )((result) => answers.push(result));
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }

      expect(answers.map((a) => a.code)).toEqual([ExportResultCode.SUCCESS]);
      expect(reports).toEqual([]);
      expect(unhandled).toEqual([]);
    });

    it("gives a failure that came without an error one it has marked as reported", () => {
      const { reports, context } = collecting();
      const answers: ExportResult[] = [];
      wrap((_records, given) => given({ code: ExportResultCode.FAILED }), context)((result) =>
        answers.push(result),
      );

      expect(answers).toHaveLength(1);
      expect(answers[0]!.error).toBeInstanceOf(Error);
      // so the processor hands this object, not a new one, to the SDK's error handler
      expect(wasReportedByExporter(answers[0]!.error)).toBe(true);
      expect(reports.map((r) => r.message)).toEqual([`${signal} export failed`]);
    });
  });

  it("reports a timed-out request with a reason, since it has neither status nor code", async () => {
    const events = startWith({
      spanExporter: {
        export: (_spans, callback) =>
          callback({ code: ExportResultCode.FAILED, error: new Error("Request timed out") }),
        shutdown: () => Promise.resolve(),
      },
    });
    trace.getTracer("t").startSpan("s").end();
    await forceFlush().catch(() => undefined);
    expect(events.find((e) => e.message === "traces export failed")?.fields).toMatchObject({
      signal: "traces",
      reason: "timeout",
    });
  });

  it("keeps the exporter's own temporality: a delta exporter reports each interval's increase", async () => {
    const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
    startWith({ metricExporter: exporter });
    const counter = metrics.getMeter("m").createCounter("ticks_total");

    counter.add(1);
    await forceFlush();
    counter.add(1);
    await forceFlush();

    const values = exporter
      .getMetrics()
      .flatMap((collection) => collection.scopeMetrics)
      .flatMap((scope) => scope.metrics)
      .filter((metric) => metric.descriptor.name === "ticks_total")
      .flatMap((metric) => metric.dataPoints.map((point) => point.value));
    // cumulative, the reader's default without the pass-through, would give [1, 2]
    expect(values).toEqual([1, 1]);
  });
});

describe("building the SDK's own exporters", () => {
  const VARIABLES = {
    OTEL_EXPORTER_OTLP_ENDPOINT: "http:\\\\user:SENTINEL@general.example ",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "\u00a0http:\\\\user:SENTINEL@traces.example/t",
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "\u00a0http:\\\\user:SENTINEL@metrics.example/m",
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "\u00a0http:\\\\user:SENTINEL@logs.example/l",
  };
  const now = () => Object.fromEntries(Object.keys(VARIABLES).map((name) => [name, process.env[name]]));
  const FACTORIES = [
    ["traces", createSpanExporter],
    ["metrics", createMetricExporter],
    ["logs", createLogRecordExporter],
  ] as const;
  const CASES = FACTORIES.flatMap(([signal, create]) =>
    (["http/protobuf", "http/json"] as const).map((protocol) => [signal, protocol, create] as const),
  );

  function listening() {
    const said: string[] = [];
    const note = (...parts: unknown[]) => said.push(parts.map(String).join(" "));
    diag.setLogger({ error: note, warn: note, info: note, debug: note, verbose: note });
    return said;
  }

  it.each(CASES)(
    "%s over %s: the endpoint variables are out of the SDK's sight, and back afterwards",
    (_signal, protocol, create) => {
      for (const [name, value] of Object.entries(VARIABLES)) vi.stubEnv(name, value);
      const said = listening();

      create({ enabled: true, url: "http://collector.example/v1/x", protocol }, undefined);

      // each of these values makes the SDK warn, with the value quoted, when it does read it
      expect(said).toEqual([]);
      expect(now()).toEqual(VARIABLES);
    },
  );

  it.each(CASES)("%s over %s: the variables are back when the SDK refuses to build", (_signal, protocol, create) => {
    for (const [name, value] of Object.entries(VARIABLES)) vi.stubEnv(name, value);
    const said = listening();

    // the SDK's own refusal, from inside the construction the variables are hidden for
    expect(() => create({ enabled: true, url: "not a url", protocol }, undefined)).toThrow(
      /user-provided export URL/,
    );
    expect(said).toEqual([]);
    expect(now()).toEqual(VARIABLES);
  });

  it.each([
    ["traces", "http/protobuf", ProtoTraceExporter],
    ["traces", "http/json", JsonTraceExporter],
    ["metrics", "http/protobuf", ProtoMetricExporter],
    ["metrics", "http/json", JsonMetricExporter],
    ["logs", "http/protobuf", ProtoLogExporter],
    ["logs", "http/json", JsonLogExporter],
  ] as const)(
    "%s over %s: the SDK does quote such a value when the variables are left in its sight",
    (_signal, _protocol, Exporter) => {
      // the control for the cases above: without it they would pass on an SDK that had stopped warning
      for (const [name, value] of Object.entries(VARIABLES)) vi.stubEnv(name, value);
      const said = listening();
      new Exporter({ url: "http://collector.example/v1/x" });
      expect(said.join("\n")).toContain("SENTINEL");
    },
  );
});

describe("the SDK's global error handler", () => {
  it("reports an error once per kind per interval, and skips only what the exporter wrapper reported", async () => {
    const reportedByWrapper = new Error("connect ECONNREFUSED");
    const events = startWith({
      spanExporter: {
        export: (_spans, callback) =>
          callback({ code: ExportResultCode.FAILED, error: reportedByWrapper }),
        shutdown: () => Promise.resolve(),
      },
    });
    trace.getTracer("t").startSpan("s").end();
    await forceFlush().catch(() => undefined);
    expect(wasReportedByExporter(reportedByWrapper)).toBe(true);
    events.length = 0;

    // what the SDK would hand over during an outage, and beside it unrelated failures
    globalErrorHandler(reportedByWrapper);
    globalErrorHandler(new Error("PeriodicExportingMetricReader: metrics export failed (error x)"));
    // the same error again and again, as in an outage: numbers aside, one kind
    globalErrorHandler(new Error("batch 1 of 3 timed out"));
    globalErrorHandler(new Error("batch 2 of 3 timed out"));
    globalErrorHandler(new Error("batch 3 of 3 timed out"));
    // a different error of the same class is not hidden behind it
    globalErrorHandler(new Error("a different plain error"));
    globalErrorHandler(new TypeError("a type error"));
    // an error with a string code the wrapper never saw must not be swallowed
    globalErrorHandler(Object.assign(new RangeError("no such file"), { code: "ENOENT" }));
    globalErrorHandler(null as never);
    globalErrorHandler("a bare string" as never);

    const pipeline = events.filter((e) => e.message === "telemetry pipeline error");
    expect(pipeline.map((e) => [e.fields?.error, e.fields?.detail])).toEqual([
      ["Error", "batch 1 of 3 timed out"],
      ["Error", "a different plain error"],
      ["TypeError", "a type error"],
      ["RangeError", "no such file"],
      ["Error", "null"],
      ["Error", "a bare string"],
    ]);
  });

  it("sanitizes an error's whole message before cutting it", () => {
    const events = startWith({});
    events.length = 0;
    globalErrorHandler(
      new Error(`failed at http://${"u".repeat(300)}:SENTINEL-PW@collector.example/path`),
    );
    expect(events.map((e) => e.fields?.detail)).toEqual(["failed at http://collector.example"]);
  });

  it("still reports an error kind it has no room to limit on its own, under one shared limit", () => {
    const events = startWith({});
    events.length = 0;
    const named = (name: string) => Object.assign(new Error("m"), { name });
    for (let kind = 0; kind < 40; kind++) globalErrorHandler(named(`Kind${kind}`));

    // 32 kinds with a limit each, then the 33rd through the shared one, which holds back the rest
    expect(events.map((e) => e.fields?.error)).toEqual(
      Array.from({ length: 33 }, (_, kind) => `Kind${kind}`),
    );
  });

});

describe("a start that fails part-way", () => {
  it("gives back what it registered, delivers what diagnostics held, and lets the next start work", async () => {
    vi.stubEnv("OTEL_BSP_SCHEDULE_DELAY", "not-a-number");
    const events: DiagnosticsEvent[] = [];
    expect(() =>
      start({
        serviceName: "fails",
        instrumentations: false,
        loaderHook: false,
        diagnostics: () => (event) => events.push(event),
        redaction: false,
        // an exporter the pipeline cannot be built around: it fails after diagnostics are in place
        testExporters: {
          metricExporter: {
            export: () => undefined,
            forceFlush: () => Promise.resolve(),
            shutdown: () => Promise.resolve(),
            get selectAggregationTemporality(): never {
              diag.warn("held before the failure");
              throw new Error("exporter could not be built");
            },
          },
        },
      }),
    ).toThrow("exporter could not be built");
    // an ignored setting is reported even though the start failed, and so is what the SDK said
    expect(events.map((e) => [e.level, e.message])).toEqual([
      ["warn", expect.stringContaining("OTEL_BSP_SCHEDULE_DELAY")],
      ["warn", "held before the failure"],
    ]);

    expect(getStatus().state).toBe("not-started");
    // the logger and the error handler were given back: neither reaches the failed start's sink
    const before = events.length;
    diag.warn("after the failed start");
    globalErrorHandler(new Error("after the failed start"));
    expect(events).toHaveLength(before);
    // no tracer provider was left registered
    expect(trace.getTracer("t").startSpan("s").isRecording()).toBe(false);

    vi.unstubAllEnvs();
    const telemetry = startTestTelemetry();
    trace.getTracer("t").startSpan("works").end();
    expect((await telemetry.spans()).map((s) => s.name)).toEqual(["works"]);
  });
});
