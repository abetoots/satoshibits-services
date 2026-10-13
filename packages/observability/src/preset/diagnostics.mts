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
 * One limit: the SDK quotes a variable's value when it cannot use it
 * (`Unknown value '…' for OTEL_…`, `Propagator "…" … is unavailable`), in
 * several forms and in messages this module does not write. Such a value is
 * free text here, so it passes the redaction the application named and
 * nothing more: a credential pasted into the wrong variable can be printed.
 * The preset's own configuration messages never quote such a value
 * ({@link shown}).
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

/** longer than any scheme in use; bounds the walk back from "://" */
const MAX_SCHEME_LENGTH = 32;
const isSchemeChar = (char: string): boolean => /[a-z0-9+.-]/i.test(char);
const isWhitespace = (char: string): boolean => /\s/.test(char);
/** what may follow a URL in a sentence, or close what was opened before it */
const TRAILING_PUNCTUATION = new Set(".,;:!?)]}>'\"`");
/** the scheme, any user-info and a bracketed (IPv6) host: its brackets and colons are not punctuation */
const BRACKETED_AUTHORITY = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#[\]@]*@)?\[[^\]]*\]/i;

function scrubbedUrl(token: string): string {
  const authority = BRACKETED_AUTHORITY.exec(token)?.[0].length ?? 0;
  let end = token.length;
  while (end > authority && TRAILING_PUNCTUATION.has(token[end - 1]!)) end--;
  const trailing = token.slice(end);
  try {
    const url = new URL(token.slice(0, end));
    return `${url.protocol}//${url.host}${trailing}`;
  } catch {
    return `[url]${trailing}`;
  }
}

/**
 * Cut every URL in a text down to scheme and host. An endpoint URL can carry
 * credentials in its user-info, path or query, and error messages quote URLs.
 *
 * A URL is taken to run from its scheme to the next whitespace, whatever is
 * in between (a password or a query may hold a quote or an angle bracket),
 * less the punctuation at its very end. Text glued to a URL without a space
 * is therefore lost with it; no part of a URL is ever kept.
 *
 * One pass over the text, with no backtracking: it runs on text of any size
 * inside whatever called the diagnostics logger.
 */
export function scrubUrls(text: string): string {
  let out = "";
  let copied = 0;
  let search = 0;
  for (;;) {
    const marker = text.indexOf("://", search);
    if (marker === -1) break;
    // back over the scheme, never into text already replaced; a scheme starts with a letter
    let start = marker;
    const floor = Math.max(copied, marker - MAX_SCHEME_LENGTH);
    while (start > floor && isSchemeChar(text[start - 1]!)) start--;
    while (start < marker && !/[a-z]/i.test(text[start]!)) start++;
    let end = marker + 3;
    while (end < text.length && !isWhitespace(text[end]!)) end++;
    if (start === marker) {
      // "://" with no scheme before it is not a URL
      search = marker + 3;
      continue;
    }
    out += text.slice(copied, start) + scrubbedUrl(text.slice(start, end));
    copied = end;
    search = end;
  }
  return out + text.slice(copied);
}

/** far more than a message needs; what is sanitized is bounded, so sanitizing is */
const MAX_INPUT_LENGTH = 16_384;

/** cut an oversized text at whitespace, so no URL is split and its tail mistaken for text */
function bounded(text: string): string {
  if (text.length <= MAX_INPUT_LENGTH) return text;
  let end = MAX_INPUT_LENGTH;
  while (end > 0 && !isWhitespace(text[end]!)) end--;
  return `${text.slice(0, end)} …`;
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
}

export function createDiagnostics(
  options: CreateDiagnosticsOptions = {},
): Diagnostics {
  const diagLevel =
    API_LEVELS[options.logLevel?.trim().toUpperCase() ?? ""] ?? DiagLogLevel.WARN;

  let active = false;
  let sink: DiagnosticsSink | undefined;
  let held: DiagnosticsEvent[] = [];

  // the whole text is sanitized, and only then cut to length
  const clean = (text: string): string => {
    const scrubbed = scrubUrls(bounded(text));
    return truncate(options.redactText ? options.redactText(scrubbed) : scrubbed);
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
      try {
        // typed as a string, but instrumentations do pass errors and objects
        report({
          level,
          message: [message, ...args].map(describeArgument).join(" "),
        });
      } catch {
        // an argument that cannot even be described must not throw into the caller
      }
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
