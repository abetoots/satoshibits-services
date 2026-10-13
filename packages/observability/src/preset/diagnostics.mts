/**
 * Diagnostics: where the telemetry pipeline reports its own trouble.
 *
 * OpenTelemetry stays silent about failed exports unless a diagnostics logger
 * is installed, and NodeSDK installs one only when `OTEL_LOG_LEVEL` is set.
 * The preset always installs this one, at warning level by default, writing
 * one JSON line per event to stderr.
 *
 * Diagnostics are a way out of the process like any exporter, so everything
 * passes a sanitizing step first: free text is redacted, URLs are cut down to
 * scheme and host, and objects the SDK passes along (a whole export batch, at
 * debug level) are described by their shape, never dumped.
 *
 * A project can supply its own sink through a factory. The factory is called
 * lazily, on the first event after {@link Diagnostics.activate}, so a logger
 * library is never imported before instrumentation is in place. Events
 * raised earlier are held (bounded) and delivered then.
 */

import { inspect } from "node:util";

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
const MAX_TEXT_LENGTH = 500;
const NOT_SHOWN = "(a value that is not shown)";

/**
 * Whether a setting's value may appear in a message: a short, plain token
 * (`http/json`, `5000`, `parentbased_traceidratio`, the longest name the
 * specification defines). Anything else is never printed, since a value
 * pasted into the wrong variable can be a credential or a URL with one.
 * A credential this short and this plain would still be printed.
 */
export const isPlainShortToken = (value: string): boolean =>
  /^[A-Za-z0-9_.,/-]{1,24}$/.test(value);

/** a setting's value as it may appear in a message */
export const shown = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string" && isPlainShortToken(value)
      ? `"${value}"`
      : NOT_SHOWN;

/**
 * The values of the telemetry variables that must not appear in any text.
 * The SDK quotes a variable's value when it cannot use it (`Unknown value
 * '…' for OTEL_…`), in messages this module does not write, so the values
 * themselves are taken out of every text instead.
 */
function unshowableValues(environment: NodeJS.ProcessEnv): string[] {
  const values = new Set<string>();
  for (const [name, raw] of Object.entries(environment)) {
    if (raw === undefined || !/^(OTEL|OBS)_/.test(name)) continue;
    // as set, as trimmed, and as each way of printing a string literal escapes it
    const forms = [
      raw,
      raw.trim(),
      JSON.stringify(raw).slice(1, -1),
      inspect(raw).slice(1, -1),
    ];
    for (const form of forms) {
      // a few characters are no credential, and would be found in ordinary words
      if (form.length >= 4 && !isPlainShortToken(form)) values.add(form);
    }
  }
  // longest first, so a value that contains another is taken out whole
  return [...values].sort((a, b) => b.length - a.length);
}

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

/**
 * Cut every URL in a text down to scheme and host. An endpoint URL can carry
 * credentials in its user-info, path or query, and error messages quote URLs.
 */
export function scrubUrls(text: string): string {
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, (match) => {
    // punctuation that ends the sentence or closes a bracket is not part of the URL
    let trailing = /[.,;:!?)\]}]+$/.exec(match)?.[0] ?? "";
    let candidate = match.slice(0, match.length - trailing.length);
    // except the bracket that closes an IPv6 host
    if (trailing.startsWith("]") && /:\/\/[^/?#]*\[[^\]]*$/.test(candidate)) {
      candidate += "]";
      trailing = trailing.slice(1);
    }
    try {
      const url = new URL(candidate);
      return `${url.protocol}//${url.host}${trailing}`;
    } catch {
      return `[url]${trailing}`;
    }
  });
}

const truncate = (text: string): string =>
  text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text;

/**
 * Describe a logger argument without printing what it holds. Text is not cut
 * here: cutting comes last, after sanitizing, or the cut could split a URL
 * and leave its credentials looking like a host.
 */
function describeArgument(argument: unknown): string {
  if (argument instanceof Error) return `${argument.name}: ${argument.message}`;
  if (typeof argument === "string") return argument;
  if (
    typeof argument === "number" ||
    typeof argument === "boolean" ||
    argument === null ||
    argument === undefined
  ) {
    return String(argument);
  }
  if (Array.isArray(argument)) return `[array of ${argument.length}]`;
  if (typeof argument === "object") {
    const keys = Object.keys(argument);
    const shown = keys.slice(0, 8).join(", ");
    return `{${shown}${keys.length > 8 ? ", …" : ""}}`;
  }
  return `[${typeof argument}]`;
}

export interface CreateDiagnosticsOptions {
  /** the value of `OTEL_LOG_LEVEL`, if set */
  logLevel?: string;
  /** returns the project's sink; called once, lazily, after `activate()` */
  sinkFactory?: () => DiagnosticsSink;
  /** redacts free text (the same redaction exported data gets); URLs are always scrubbed */
  redactText?: (text: string) => string;
  /** the environment whose `OTEL_*` and `OBS_*` values are kept out of every text */
  environment?: NodeJS.ProcessEnv;
}

export function createDiagnostics(
  options: CreateDiagnosticsOptions = {},
): Diagnostics {
  const diagLevel =
    API_LEVELS[options.logLevel?.trim().toUpperCase() ?? ""] ?? DiagLogLevel.WARN;

  let active = false;
  let sink: DiagnosticsSink | undefined;
  let held: DiagnosticsEvent[] = [];

  const unshowable = unshowableValues(options.environment ?? {});

  // the whole text is sanitized, and only then cut to length
  const clean = (text: string): string => {
    let cleaned = text;
    for (const value of unshowable) cleaned = cleaned.replaceAll(value, NOT_SHOWN);
    cleaned = scrubUrls(cleaned);
    if (options.redactText) cleaned = options.redactText(cleaned);
    return truncate(cleaned);
  };
  const sanitized = (event: DiagnosticsEvent): DiagnosticsEvent => ({
    level: event.level,
    message: clean(event.message),
    ...(event.fields && {
      fields: Object.fromEntries(
        Object.entries(event.fields).map(([key, value]) => [
          key,
          typeof value === "string" ? clean(value) : value,
        ]),
      ),
    }),
  });

  const deliver = (raw: DiagnosticsEvent) => {
    try {
      const event = sanitized(raw);
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
      // typed as a string, but instrumentations do pass errors and objects
      report({
        level,
        message: [message, ...args].map(describeArgument).join(" "),
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
