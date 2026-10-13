/**
 * Policies: what is exported or written in place of what was given.
 *
 * A policy is a plain object of functions, each told the surface it is
 * looking at, because the same key means different things in different
 * places: an exception's message belongs in a log record and not on a span.
 * It works on plain values and knows nothing of OpenTelemetry's types, so it
 * serves an exporter, a logger and anything else that holds a text or an
 * object of fields.
 *
 * This module holds no state shared between policies and decides nothing by
 * itself: a caller that names no policy gets no redaction.
 */

import type { KeyRule } from "./keys.mjs";
import type { Mask } from "./masks.mjs";

import { anyKey } from "./keys.mjs";
import { composeMasks } from "./masks.mjs";
import { cutUrl } from "./urls.mjs";

/** an attribute set as a policy sees it: plain keys and values */
export type PolicyAttributes = Record<string, unknown>;

/** a span event: its name and attributes together, so an `exception` event can be recognised */
export interface PolicySpanEvent {
  name: string;
  attributes: PolicyAttributes;
}

/** a log record: everything of it that is exported text, together */
export interface PolicyLogRecord {
  /** a string, or a nested value */
  body: unknown;
  attributes: PolicyAttributes;
  eventName?: string;
  severityText?: string;
}

/**
 * A policy. Each function returns what is to be used in place of what it was
 * given and leaves its argument as it was. The surface is a name such as
 * `"span.name"`, `"diagnostics"`, `"span"` or `"resource"`; a policy that
 * branches on it needs a branch for a name it does not know.
 *
 * This is the shape `@satoshibits/observability`'s `redaction` option takes.
 */
export interface RedactionPolicy {
  text: (surface: string, value: string) => string;
  attributes: (surface: string, attributes: PolicyAttributes) => PolicyAttributes;
  /** a span's status text; `undefined` drops it */
  spanStatus: (message: string) => string | undefined;
  spanEvent: (event: PolicySpanEvent) => PolicySpanEvent;
  logRecord: (record: PolicyLogRecord) => PolicyLogRecord;
}

/** the parts a policy is built from; a policy of your own is the standard parts with some changed */
export interface PolicyParts {
  /** applied in order to every text, and to every string value that no key rule below decides */
  readonly textMasks: readonly Mask[];
  /** keys whose value is replaced whole, an array or an object under them included */
  readonly redactKeys: readonly KeyRule[];
  /** keys removed together with their value */
  readonly dropKeys: readonly KeyRule[];
  /** keys that hold a URL, or a path with a query: the query, fragment and user-info are removed */
  readonly urlKeys: readonly KeyRule[];
  /** keys, exactly as written, whose value is left as given whatever the rules above say */
  readonly allowKeys: readonly string[];
  /** what a redacted value is replaced with */
  readonly replacement: string;
  /** on a span's `exception` event, drop `exception.message` and `exception.stacktrace`; the type stays */
  readonly dropSpanExceptionDetail: boolean;
  /** drop a span's status text; when false it passes the text masks */
  readonly dropSpanStatusText: boolean;
}

/** the same parts as a function over a value of any depth: a log call's fields */
export type FieldsRedactor = (fields: unknown) => unknown;

/** in place of an object that contains itself */
const CIRCULAR = "[CIRCULAR]";
/** in place of what lies deeper than a policy will follow */
const TOO_DEEP = "[TOO_DEEP]";
/** how deep a nested value is followed; a log line's fields are a few levels */
const MAX_DEPTH = 32;
/** how many keys' decisions are remembered; attribute keys are a bounded set chosen in code */
const MAX_REMEMBERED_KEYS = 4096;

const EXCEPTION_DETAIL = new Set(["exception.message", "exception.stacktrace"]);

type Decision = "allow" | "drop" | "redact" | "url" | "mask";

/** an object literal or one without a prototype, from any realm */
const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
};

interface Engine {
  text: (value: string) => string;
  /** an object's entries, each decided by its key; `without` names keys to leave out */
  entries: (
    given: Record<string, unknown>,
    without?: ReadonlySet<string>,
  ) => Record<string, unknown>;
  value: (given: unknown) => unknown;
}

function createEngine(parts: PolicyParts): Engine {
  const text = composeMasks(...parts.textMasks);
  const allowed = new Set(parts.allowKeys);
  const dropped = anyKey(...parts.dropKeys);
  const redacted = anyKey(...parts.redactKeys);
  const url = anyKey(...parts.urlKeys);
  const remembered = new Map<string, Decision>();

  const decide = (key: string): Decision => {
    const known = remembered.get(key);
    if (known !== undefined) return known;
    const decision: Decision = allowed.has(key)
      ? "allow"
      : dropped(key)
        ? "drop"
        : redacted(key)
          ? "redact"
          : url(key)
            ? "url"
            : "mask";
    if (remembered.size < MAX_REMEMBERED_KEYS) remembered.set(key, decision);
    return decision;
  };

  // the objects being walked, from the outermost in: one found again contains itself
  const walk = (given: unknown, ancestors: object[]): unknown => {
    if (typeof given === "string") return text(given);
    const isArray = Array.isArray(given);
    // anything that is neither is left as given: a number, a date, a buffer, an error
    if (!isArray && !isPlainObject(given)) return given;
    if (ancestors.includes(given)) return CIRCULAR;
    if (ancestors.length >= MAX_DEPTH) return TOO_DEEP;
    ancestors.push(given);
    const walked = isArray
      ? given.map((item) => walk(item, ancestors))
      : walkEntries(given, ancestors);
    ancestors.pop();
    return walked;
  };

  const walkEntries = (
    given: Record<string, unknown>,
    ancestors: object[],
    without?: ReadonlySet<string>,
  ): Record<string, unknown> => {
    const kept: [string, unknown][] = [];
    for (const key of Object.keys(given)) {
      if (without?.has(key) === true) continue;
      const decision = decide(key);
      if (decision === "drop") continue;
      const value = given[key];
      kept.push([
        key,
        decision === "allow"
          ? value
          : decision === "redact"
            ? // nothing is there to hide in a value that is absent
              value === undefined || value === null
              ? value
              : parts.replacement
            : decision === "url" && typeof value === "string"
              ? text(cutUrl(value))
              : walk(value, ancestors),
      ]);
    }
    // from entries, so that a key named "__proto__" is a key and nothing more
    return Object.fromEntries(kept);
  };

  return {
    text,
    entries: (given, without) => walkEntries(given, [given], without),
    value: (given) => walk(given, []),
  };
}

const createPolicyFrom = (parts: PolicyParts, engine: Engine): RedactionPolicy => ({
  text: (_surface, value) => engine.text(value),
  attributes: (_surface, attributes) => engine.entries(attributes),
  spanStatus: (message) =>
    parts.dropSpanStatusText ? undefined : engine.text(message),
  spanEvent: (event) => ({
    name: engine.text(event.name),
    attributes: engine.entries(
      event.attributes,
      parts.dropSpanExceptionDetail && event.name === "exception"
        ? EXCEPTION_DETAIL
        : undefined,
    ),
  }),
  logRecord: (record) => ({
    ...record,
    body: engine.value(record.body),
    attributes: engine.entries(record.attributes),
    ...(record.eventName !== undefined && {
      eventName: engine.text(record.eventName),
    }),
    ...(record.severityText !== undefined && {
      severityText: engine.text(record.severityText),
    }),
  }),
});

/** a policy from its parts */
export const createPolicy = (parts: PolicyParts): RedactionPolicy =>
  createPolicyFrom(parts, createEngine(parts));

/**
 * The parts as a function over a plain object of any depth, for a logger: a
 * line's fields get the key rules at every level and the text masks on every
 * string. A text is masked; an array is walked; a value that is neither a
 * plain object, an array nor a string (a number, a date, a buffer, an error)
 * is returned as given. What is given is not changed.
 *
 * It is the log-record side of the policy: an error's message and stack are
 * kept and masked, not dropped.
 */
export const createFieldsRedactor = (parts: PolicyParts): FieldsRedactor => {
  const engine = createEngine(parts);
  return (fields) => engine.value(fields);
};
