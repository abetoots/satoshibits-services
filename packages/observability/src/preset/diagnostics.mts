/**
 * Diagnostics: where the telemetry pipeline reports its own trouble.
 *
 * OpenTelemetry stays silent about failed exports unless a diagnostics logger
 * is installed, and NodeSDK installs one only when `OTEL_LOG_LEVEL` is set.
 * The preset always installs this one, at warning level by default, writing
 * one JSON line per event to stderr.
 *
 * A project can supply its own sink through a factory. The factory is called
 * lazily, on the first event after {@link Diagnostics.activate}, so a logger
 * library is never imported before instrumentation is in place. Events
 * raised earlier are held (bounded) and delivered then.
 */

import { DiagLogLevel } from "@opentelemetry/api";

import type { DiagLogger } from "@opentelemetry/api";

export type DiagnosticsLevel = "error" | "warn" | "info" | "debug";

export interface DiagnosticsEvent {
  level: DiagnosticsLevel;
  message: string;
  /** structured detail; never header values */
  fields?: Record<string, unknown>;
}

export type DiagnosticsSink = (event: DiagnosticsEvent) => void;

export interface Diagnostics {
  report: (event: DiagnosticsEvent) => void;
  /** the logger to hand to the OpenTelemetry API */
  diagLogger: DiagLogger;
  /** the API level matching `OTEL_LOG_LEVEL` (warning when unset or unknown) */
  diagLevel: DiagLogLevel;
  /** from now on the sink factory may be called */
  activate: () => void;
}

const MAX_HELD_EVENTS = 100;
const MAX_ARGUMENT_LENGTH = 500;

const API_LEVELS: Record<string, DiagLogLevel> = {
  NONE: DiagLogLevel.NONE,
  ERROR: DiagLogLevel.ERROR,
  WARN: DiagLogLevel.WARN,
  INFO: DiagLogLevel.INFO,
  DEBUG: DiagLogLevel.DEBUG,
  VERBOSE: DiagLogLevel.VERBOSE,
  ALL: DiagLogLevel.ALL,
};

const THRESHOLD: Record<DiagnosticsLevel, DiagLogLevel> = {
  error: DiagLogLevel.ERROR,
  warn: DiagLogLevel.WARN,
  info: DiagLogLevel.INFO,
  debug: DiagLogLevel.DEBUG,
};

/** one JSON line per event on stderr */
export const stderrSink: DiagnosticsSink = (event) => {
  process.stderr.write(
    JSON.stringify({
      time: new Date().toISOString(),
      level: event.level,
      source: "opentelemetry",
      msg: event.message,
      ...event.fields,
    }) + "\n",
  );
};

function describeArgument(argument: unknown): string {
  let text: string;
  if (argument instanceof Error) {
    text = `${argument.name}: ${argument.message}`;
  } else if (typeof argument === "string") {
    text = argument;
  } else {
    try {
      text = JSON.stringify(argument) ?? String(argument);
    } catch {
      text = "[unserializable]";
    }
  }
  return text.length > MAX_ARGUMENT_LENGTH
    ? `${text.slice(0, MAX_ARGUMENT_LENGTH)}…`
    : text;
}

export interface CreateDiagnosticsOptions {
  /** the value of `OTEL_LOG_LEVEL`, if set */
  logLevel?: string;
  /** returns the project's sink; called once, lazily, after `activate()` */
  sinkFactory?: () => DiagnosticsSink;
}

export function createDiagnostics(
  options: CreateDiagnosticsOptions = {},
): Diagnostics {
  const diagLevel =
    API_LEVELS[options.logLevel?.trim().toUpperCase() ?? ""] ?? DiagLogLevel.WARN;

  let active = false;
  let sink: DiagnosticsSink | undefined;
  let held: DiagnosticsEvent[] = [];

  const deliver = (event: DiagnosticsEvent) => {
    try {
      if (sink === undefined) {
        try {
          sink = options.sinkFactory?.() ?? stderrSink;
        } catch {
          // a broken factory must not silence diagnostics
          sink = stderrSink;
        }
      }
      sink(event);
    } catch {
      // a sink that throws must never break the pipeline that is reporting to it
    }
  };

  const report = (event: DiagnosticsEvent) => {
    if (THRESHOLD[event.level] > diagLevel) return;
    if (!active) {
      if (held.length < MAX_HELD_EVENTS) held.push(event);
      return;
    }
    deliver(event);
  };

  const fromApi =
    (level: DiagnosticsLevel) =>
    (message: string, ...args: unknown[]) => {
      report({
        level,
        message:
          args.length === 0
            ? message
            : `${message} ${args.map(describeArgument).join(" ")}`,
      });
    };

  return {
    report,
    diagLevel,
    diagLogger: {
      error: fromApi("error"),
      warn: fromApi("warn"),
      info: fromApi("info"),
      debug: fromApi("debug"),
      verbose: fromApi("debug"),
    },
    activate: () => {
      active = true;
      const pending = held;
      held = [];
      for (const event of pending) deliver(event);
    },
  };
}

/**
 * Limits a repeating report to one line per interval. The first occurrence is
 * reported at once; later ones are counted and the count is attached to the
 * next line that is let through.
 */
export function createRateLimiter(
  intervalMillis: number,
  now: () => number = Date.now,
): (emit: (suppressed: number) => void) => void {
  let last: number | undefined;
  let suppressed = 0;
  return (emit) => {
    const current = now();
    if (last !== undefined && current - last < intervalMillis) {
      suppressed++;
      return;
    }
    last = current;
    const count = suppressed;
    suppressed = 0;
    emit(count);
  };
}
