/**
 * Child-process fixture for the preset's subprocess tests.
 *
 * Starts the preset the way a consumer's preload does, emits some telemetry,
 * finishes as asked, and prints one `RESULT {json}` line. The scenario comes
 * from OBS_CHILD_SCENARIO; see ../harness.mts.
 *
 * Every outbound socket is recorded before anything else runs, so a test can
 * fail on a connection to an address it did not expect.
 */

import {
  createTraceState,
  isSpanContextValid,
  metrics,
  ROOT_CONTEXT,
  SpanStatusCode,
  trace,
  TraceFlags,
} from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
// the 1.x span processor, as a 1.x consumer passes it to the facade
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { createRequire } from "node:module";
import net from "node:net";

import type { ChildResult, ChildScenario } from "../harness.mjs";
import type { DiagnosticsEvent } from "../../../../preset/diagnostics.mjs";

import { forceFlush, getStatus, shutdown, start } from "../../../../preset.mjs";
import { createProbePolicy, createThrowingPolicy } from "../../probe-policy.mjs";

const scenario = JSON.parse(
  process.env.OBS_CHILD_SCENARIO ?? "{}",
) as ChildScenario;

// ===== record every outbound connection =====
const sockets: ChildResult["sockets"] = [];
// eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with apply below
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (
  this: net.Socket,
  ...args: unknown[]
): net.Socket {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    const target = (Array.isArray(first) ? first[0] : first) as {
      host?: string;
      port?: number | string;
      path?: string;
    };
    sockets.push({
      host: target.host ?? target.path ?? "localhost",
      port: Number(target.port ?? 0),
    });
  } else {
    sockets.push({
      host: typeof args[1] === "string" ? args[1] : "localhost",
      port: Number(first),
    });
  }
  return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;

// ===== start =====
// sorted by name: a variable that is removed and set again moves to the end of the environment
const endpointVariables = (): [string, string][] =>
  Object.entries(process.env)
    .flatMap(([name, value]): [string, string][] =>
      value !== undefined && /^OTEL_EXPORTER_OTLP_(\w+_)?ENDPOINT$/.test(name)
        ? [[name, value]]
        : [],
    )
    .sort(([a], [b]) => a.localeCompare(b));
const endpointVariablesBeforeStart = JSON.stringify(endpointVariables());
const diagnostics: DiagnosticsEvent[] = [];
let sinkFactoryCalledAfterSdkStarted: boolean | null = null;
let startError: string | null = null;

const startOptions = (): Parameters<typeof start>[0] => ({
  instrumentations: false,
  ...scenario.options,
  ...(scenario.redaction !== "none" && {
    redaction:
      scenario.redaction === "probe"
        ? createProbePolicy()
        : scenario.redaction === "throwing"
          ? createThrowingPolicy()
          : false,
  }),
  ...(scenario.collectDiagnostics && {
    diagnostics: () => {
      // a tracer provider is registered by the same call that installs instrumentation
      // a registered tracer provider hands out recording spans; none are exported by this
      sinkFactoryCalledAfterSdkStarted = trace
        .getTracer("probe")
        .startSpan("probe")
        .isRecording();
      if (scenario.collectDiagnostics === "throwing") {
        return (event) => {
          diagnostics.push(event);
          throw new Error("diagnostics sink is broken");
        };
      }
      return (event) => diagnostics.push(event);
    },
  }),
});

if (scenario.start === "register") {
  await import("../../../../register.mjs");
} else if (scenario.start !== "none" && scenario.start !== "facade") {
  try {
    start(startOptions());
  } catch (error) {
    startError = error instanceof Error ? error.message : String(error);
  }
}

// ===== the deprecated facade =====
const usesFacade = scenario.start === "facade" || scenario.start === "start-then-facade";
let facadeExporter: InMemorySpanExporter | undefined;
let statusBeforeFacade: ChildResult["statusBeforeFacade"] = null;
let statusAfterFacade: ChildResult["statusAfterFacade"] = null;
let statusAfterSecondFacade: ChildResult["statusAfterSecondFacade"] = null;
let httpPatched: ChildResult["httpPatched"] = null;
const facadeConfig = (given: Omit<NonNullable<ChildScenario["facade"]>, "testSpanProcessor">) => ({
  environment: "node" as const,
  serviceName: "facade-child",
  disableInstrumentation: true,
  ...given,
  ...(facadeExporter && { testSpanProcessor: new SimpleSpanProcessor(facadeExporter) }),
});
// loaded only here: the root entry is not part of any other scenario
const facade = usesFacade ? (await import("../../../../index.mjs")).SmartClient : undefined;
if (facade) {
  const { testSpanProcessor, ...given } = scenario.facade ?? {};
  if (testSpanProcessor) facadeExporter = new InMemorySpanExporter();
  if (scenario.start === "start-then-facade") statusBeforeFacade = getStatus();
  await facade.initialize(facadeConfig(given));
  statusAfterFacade = getStatus();
  httpPatched =
    (createRequire(import.meta.url)("node:http") as { request: { __wrapped?: boolean } }).request
      .__wrapped === true;
}

const logLevelAfterStart = process.env.OTEL_LOG_LEVEL ?? null;
// compared here and reported as a flag: the values can hold credentials, and the result is printed
const endpointVariablesRestored =
  JSON.stringify(endpointVariables()) === endpointVariablesBeforeStart;

// ===== emit =====
const scopeName = scenario.scopeName ?? "preset-child";
const scopeOptions = {
  ...(scenario.scopeSchemaUrl !== undefined && { schemaUrl: scenario.scopeSchemaUrl }),
};
// through the provider: the API's own getTracer() drops the schema URL
const tracer = trace.getTracerProvider().getTracer(scopeName, scenario.scopeVersion, scopeOptions);
const parent =
  scenario.parentTraceState === undefined
    ? undefined
    : trace.setSpanContext(ROOT_CONTEXT, {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        traceFlags: TraceFlags.SAMPLED,
        isRemote: true,
        traceState: createTraceState(scenario.parentTraceState),
      });
const spans: ChildResult["spans"] = [];
const total = scenario.spans ?? 1;
for (let i = 0; i < total; i++) {
  const span = tracer.startSpan(
    scenario.spanNameAsGiven && scenario.spanName !== undefined
      ? scenario.spanName
      : `${scenario.spanName ?? "child-span"}-${i}`,
    {
      ...(scenario.spanAttributes && { attributes: scenario.spanAttributes }),
      ...(scenario.spanLink && {
        links: [
          {
            context: {
              traceId: "0af7651916cd43dd8448eb211c80319c",
              spanId: "b7ad6b7169203331",
              traceFlags: TraceFlags.SAMPLED,
              traceState: createTraceState(scenario.spanLink.traceState),
            },
            attributes: scenario.spanLink.attributes,
          },
        ],
      }),
    },
    parent,
  );
  if (scenario.spanEvent) span.addEvent(scenario.spanEvent.name, scenario.spanEvent.attributes);
  if (scenario.spanStatusMessage !== undefined) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: scenario.spanStatusMessage });
  }
  const spanContext = span.spanContext();
  if (i < 50) {
    spans.push({
      traceId: spanContext.traceId,
      valid: isSpanContextValid(spanContext),
      sampled: (spanContext.traceFlags & TraceFlags.SAMPLED) !== 0,
    });
  }
  span.end();
}

if (scenario.metric !== false) {
  metrics.getMeter(scopeName, scenario.scopeVersion, scopeOptions).createCounter("child_counter").add(1);
}

if (scenario.log !== false) {
  logs
    .getLogger(scopeName, scenario.scopeVersion, {
      ...scopeOptions,
      ...(scenario.scopeAttributes && { attributes: scenario.scopeAttributes }),
    })
    .emit({ body: "child-log-line", severityText: "INFO", ...scenario.logRecord });
}

// ===== overflow: fill the span queue, let it drain, then one more span =====
if (scenario.afterDrainSpans) {
  await forceFlush(scenario.timeoutMillis).catch(() => undefined);
  for (let i = 0; i < scenario.afterDrainSpans; i++) {
    tracer.startSpan(`after-drain-${i}`).end();
  }
}

if (scenario.lingerMillis) {
  await new Promise((resolve) => setTimeout(resolve, scenario.lingerMillis));
}

// read before the finish: an in-memory exporter forgets its spans when it is shut down
const facadeSpans = facadeExporter?.getFinishedSpans().map((span) => span.name) ?? null;

// ===== finish =====
/** everything of an error a caller could print, so a test can search it for what must not be there */
const printable = (error: unknown): string => {
  const parts = [String(error), JSON.stringify(error) ?? ""];
  if (typeof error === "object" && error !== null) {
    for (const key of Object.getOwnPropertyNames(error)) {
      const value: unknown = (error as Record<string, unknown>)[key];
      parts.push(`${key}=${typeof value === "string" ? value : (JSON.stringify(value) ?? String(value))}`);
    }
  }
  return parts.join("\n");
};

let finishError: string | null = null;
let finishErrorName: string | null = null;
let finishErrorText: string | null = null;
const finishStarted = Date.now();
try {
  if (scenario.finish === "forceFlush") {
    await forceFlush(scenario.timeoutMillis);
  } else if (facade && scenario.finish !== "none") {
    await facade.shutdown();
  } else if (scenario.finish !== "none") {
    await shutdown(scenario.timeoutMillis);
  }
} catch (error) {
  finishError = error instanceof Error ? error.message : String(error);
  finishErrorName = error instanceof Error ? error.name : null;
  finishErrorText = printable(error);
}
const finishMillis = Date.now() - finishStarted;

if (facade && scenario.facadeAgain) {
  const { testSpanProcessor: _ignored, ...given } = scenario.facade ?? {};
  await facade.initialize(facadeConfig(given));
  statusAfterSecondFacade = getStatus();
}

let againError: string | null = null;
if (scenario.emitAgainAfterFinish) {
  tracer.startSpan("after-finish").end();
  metrics.getMeter(scopeName).createCounter("child_counter_after_finish").add(1);
  logs.getLogger(scopeName).emit({ body: "after-finish-line", severityText: "INFO" });
  try {
    await forceFlush(scenario.timeoutMillis);
  } catch (error) {
    againError = error instanceof Error ? error.message : String(error);
  }
}

let restartError: string | null = null;
if (scenario.restartAfterFinish) {
  try {
    start(startOptions());
    tracer.startSpan("after-restart").end();
    await shutdown(scenario.timeoutMillis);
  } catch (error) {
    restartError = error instanceof Error ? error.message : String(error);
  }
}

const result: ChildResult = {
  status: getStatus(),
  startError,
  finishError,
  finishErrorName,
  finishErrorText,
  finishMillis,
  againError,
  restartError,
  spans,
  sockets,
  diagnostics,
  sinkFactoryCalledAfterSdkStarted,
  logLevelAfterStart,
  endpointVariablesRestored,
  facadeSpans,
  statusBeforeFacade,
  statusAfterFacade,
  statusAfterSecondFacade,
  httpPatched,
};
process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);

if (scenario.exit !== "natural") {
  // an exporter may hold a socket open; the work is done, so leave deterministically
  process.exit(0);
}
