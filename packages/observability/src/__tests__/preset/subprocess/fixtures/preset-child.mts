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
  isSpanContextValid,
  metrics,
  trace,
  TraceFlags,
} from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import net from "node:net";

import type { ChildResult, ChildScenario } from "../harness.mjs";
import type { DiagnosticsEvent } from "../../../../preset/diagnostics.mjs";

import { forceFlush, getStatus, shutdown, start } from "../../../../preset.mjs";

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
const endpointVariables = (): [string, string][] =>
  Object.entries(process.env).flatMap(([name, value]): [string, string][] =>
    value !== undefined && /^OTEL_EXPORTER_OTLP_(\w+_)?ENDPOINT$/.test(name) ? [[name, value]] : [],
  );
const endpointVariablesBeforeStart = JSON.stringify(endpointVariables());
const diagnostics: DiagnosticsEvent[] = [];
let sinkFactoryCalledAfterSdkStarted: boolean | null = null;
let startError: string | null = null;

if (scenario.start === "register") {
  await import("../../../../register.mjs");
} else if (scenario.start !== "none") {
  try {
    start({
      instrumentations: false,
      ...scenario.options,
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
  } catch (error) {
    startError = error instanceof Error ? error.message : String(error);
  }
}

const logLevelAfterStart = process.env.OTEL_LOG_LEVEL ?? null;
// compared here and reported as a flag: the values can hold credentials, and the result is printed
const endpointVariablesRestored =
  JSON.stringify(endpointVariables()) === endpointVariablesBeforeStart;

// ===== emit =====
const scopeName = scenario.scopeName ?? "preset-child";
const tracer = trace.getTracer(scopeName);
const spans: ChildResult["spans"] = [];
const total = scenario.spans ?? 1;
for (let i = 0; i < total; i++) {
  const span = tracer.startSpan(`${scenario.spanName ?? "child-span"}-${i}`);
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
  metrics.getMeter(scopeName).createCounter("child_counter").add(1);
}

if (scenario.log !== false) {
  logs
    .getLogger(scopeName, undefined, {
      ...(scenario.scopeAttributes && { attributes: scenario.scopeAttributes }),
    })
    .emit({ body: "child-log-line", severityText: "INFO" });
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

// ===== finish =====
let finishError: string | null = null;
const finishStarted = Date.now();
try {
  if (scenario.finish === "forceFlush") {
    await forceFlush(scenario.timeoutMillis);
  } else if (scenario.finish !== "none") {
    await shutdown(scenario.timeoutMillis);
  }
} catch (error) {
  finishError = error instanceof Error ? error.message : String(error);
}

const result: ChildResult = {
  status: getStatus(),
  startError,
  finishError,
  finishMillis: Date.now() - finishStarted,
  spans,
  sockets,
  diagnostics,
  sinkFactoryCalledAfterSdkStarted,
  logLevelAfterStart,
  endpointVariablesRestored,
};
process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);

if (scenario.exit !== "natural") {
  // an exporter may hold a socket open; the work is done, so leave deterministically
  process.exit(0);
}
