/**
 * The seam at which what leaves the process is redacted.
 *
 * The preset owns the seam and nothing else: it wraps every exporter and
 * hands what is about to leave to a policy the application named. It ships no
 * patterns and no default. `redaction: false` exports everything as given; a
 * start that would export with no `redaction` at all is refused.
 *
 * A policy is a plain object of functions, each told the surface it is
 * looking at, because the same key means different things in different
 * places (an exception's message belongs in a log record and not on a span).
 * It works on plain values, so a policy needs no OpenTelemetry import.
 *
 * Metric attributes are not passed to a policy: labels are bounded names
 * chosen in code, and a redacted label value would merge series.
 */

import type { Attributes } from "@opentelemetry/api";
import type { InstrumentationScope } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";

/** an attribute set as a policy sees it: plain keys and values */
export type PolicyAttributes = Record<string, unknown>;

/**
 * Where a free text is about to appear. This list, like the one of attribute
 * surfaces below, may grow in a later version: a policy that branches on the
 * surface needs a branch for "anything else".
 */
export type TextSurface =
  | "span.name"
  | "scope.name"
  /** the library's own diagnostics: a message, or a text field of one */
  | "diagnostics";

/** what an attribute set is attached to */
export type AttributesSurface =
  | "span"
  | "link"
  /** every resource attribute but `service.name` and `service.instance.id` */
  | "resource"
  | "scope";

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
 * What an application names as `redaction`. Each function returns what is to
 * be exported in place of what it was given; it must not change its argument,
 * and must answer at once (not with a promise) and the same way each time for
 * the same input: what it returns for an instrumentation scope is kept for
 * the life of the process.
 */
export interface RedactionPolicy {
  text: (surface: TextSurface, value: string) => string;
  attributes: (
    surface: AttributesSurface,
    attributes: PolicyAttributes,
  ) => PolicyAttributes;
  /** a span's status text; `undefined` drops it */
  spanStatus: (message: string) => string | undefined;
  spanEvent: (event: PolicySpanEvent) => PolicySpanEvent;
  logRecord: (record: PolicyLogRecord) => PolicyLogRecord;
}

/** a policy, or `false` to export everything as given */
export type RedactionOption = RedactionPolicy | false;

const POLICY_FUNCTIONS = [
  "text",
  "attributes",
  "spanStatus",
  "spanEvent",
  "logRecord",
] as const satisfies readonly (keyof RedactionPolicy)[];

/** what is wrong with a `redaction` value that is neither a policy nor `false`; `undefined` when nothing is */
export function redactionProblem(option: unknown): string | undefined {
  if (option === false) return undefined;
  if (typeof option !== "object" || option === null) {
    return "redaction must be a policy or false";
  }
  const missing = POLICY_FUNCTIONS.filter(
    (name) => typeof (option as Record<string, unknown>)[name] !== "function",
  );
  return missing.length === 0
    ? undefined
    : `redaction is not a policy: it has no ${missing.join(", ")} function`;
}

/** the policy as the preset applies it to what it wraps */
export interface Redactor {
  text: (surface: TextSurface, value: string) => string;
  /** what the policy returned for a copy of the set; `undefined` stays `undefined` */
  attributes: <T extends Attributes | undefined>(
    surface: AttributesSurface,
    attributes: T,
  ) => T;
  /** an instrumentation scope: its name and attributes are chosen by API callers */
  scope: (scope: InstrumentationScope) => InstrumentationScope;
  /** what is exported in place of the span's own, by property; the span is not changed */
  span: (span: ReadableSpan) => Partial<RedactedSpan>;
}

/** the properties of a span a policy has a say in: all of them are replaced under one */
export type RedactedSpan = Pick<
  ReadableSpan,
  "name" | "attributes" | "status" | "events" | "links" | "instrumentationScope"
>;

/**
 * An object literal or one without a prototype: not an array, a promise or a
 * class instance. Told by the shape of the prototype chain, not by identity
 * with this realm's `Object`, so a plain object from another realm (a
 * `structuredClone` under a test runner's sandbox) is one too.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/** whether a value would be awaited if it were treated as a result */
export const isThenable = (value: unknown): boolean =>
  (typeof value === "object" || typeof value === "function") &&
  value !== null &&
  typeof (value as { then?: unknown }).then === "function";

/**
 * A policy written as an async function returns a promise where a value
 * belongs. That is refused like any wrong kind, but the promise itself must
 * not be left to reject with nobody listening: Node ends the process for
 * that, and prints the policy's own error on the way.
 */
export function abandon(result: unknown): void {
  if (!isThenable(result)) return;
  try {
    // both handlers are functions: a thenable written by hand may call either without checking
    (result as PromiseLike<unknown>).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // a then() that throws has nothing left to reject
  }
}

/**
 * What a policy may return where an attribute set belongs. A thenable is not
 * one whatever else it is: an object literal with a then() is plain too.
 */
const isPlainResult = (value: unknown): value is Record<string, unknown> =>
  isPlainObject(value) && !isThenable(value);

/** refuse what a policy returned, letting go first of every promise among `results` */
function refuse(message: string, ...results: unknown[]): never {
  for (const result of results) abandon(result);
  throw new TypeError(message);
}

const NOTHING_REPLACED: Partial<RedactedSpan> = Object.freeze({});

const AS_GIVEN: Redactor = {
  text: (_surface, value) => value,
  attributes: (_surface, attributes) => attributes,
  scope: (scope) => scope,
  span: () => NOTHING_REPLACED,
};

export function createRedactor(option: RedactionOption): Redactor {
  if (option === false) return AS_GIVEN;
  const policy = option;

  // What a policy returns is checked for its kind, here, once for every caller: a policy
  // written without types, or as an async function, would otherwise put `undefined` or a
  // promise where a text or an attribute set belongs, and nothing downstream would say so.
  // A wrong kind is thrown like any other failure of the policy; the content is not looked at.
  const text: Redactor["text"] = (surface, value) => {
    const result: unknown = policy.text(surface, value);
    if (typeof result !== "string") {
      refuse(`the redaction policy's text() did not return a string for ${surface}`, result);
    }
    return result;
  };

  const attributes = <T extends Attributes | undefined>(
    surface: AttributesSurface,
    input: T,
  ): T => {
    if (input === undefined) return input;
    // a copy: the policy must not change what it is given, and this makes a slip harmless
    const result: unknown = policy.attributes(surface, { ...input });
    if (!isPlainResult(result)) {
      refuse(
        `the redaction policy's attributes() did not return an attribute set for ${surface}`,
        result,
      );
    }
    return result as T;
  };

  // scopes are few and long-lived, and every exported record carries one
  const scopes = new WeakMap<InstrumentationScope, InstrumentationScope>();
  const scope = (input: InstrumentationScope): InstrumentationScope => {
    const known = scopes.get(input);
    if (known) return known;
    const withAttributes = input as InstrumentationScope & {
      attributes?: Attributes;
    };
    const name = text("scope.name", input.name);
    const cleanAttributes = attributes("scope", withAttributes.attributes);
    const clean = { ...input, name, attributes: cleanAttributes };
    scopes.set(input, clean);
    return clean;
  };

  const spanStatus = (input: ReadableSpan["status"]): ReadableSpan["status"] => {
    // a status with no text has nothing a policy could redact
    if (input.message === undefined) return input;
    const result: unknown = policy.spanStatus(input.message);
    if (result === undefined) return { code: input.code };
    if (typeof result !== "string") {
      refuse("the redaction policy's spanStatus() did not return a string or undefined", result);
    }
    return { code: input.code, message: result };
  };

  type SpanEvent = ReadableSpan["events"][number];
  const spanEvent = (input: SpanEvent): SpanEvent => {
    // name and attributes together, and the attributes a copy, as for any attribute set
    const result: unknown = policy.spanEvent({
      name: input.name,
      attributes: { ...input.attributes },
    });
    // read once each: what is checked is what is exported
    const { name, attributes: eventAttributes } =
      typeof result === "object" && result !== null && !isThenable(result)
        ? (result as { name?: unknown; attributes?: unknown })
        : {};
    if (typeof name !== "string" || !isPlainResult(eventAttributes)) {
      // a promise may be the event itself or sit where its name or attributes belong
      refuse(
        "the redaction policy's spanEvent() did not return an event",
        result,
        name,
        eventAttributes,
      );
    }
    return { ...input, name, attributes: eventAttributes as Attributes };
  };

  // typed as the whole set, so that a surface left out here does not compile;
  // most spans have no events and no links, and for those nothing is allocated
  const span = (input: ReadableSpan): RedactedSpan => ({
    name: text("span.name", input.name),
    attributes: attributes("span", input.attributes),
    status: spanStatus(input.status),
    events: input.events.length === 0 ? input.events : input.events.map(spanEvent),
    links:
      input.links.length === 0
        ? input.links
        : input.links.map((link) => ({
            ...link,
            attributes: attributes("link", link.attributes),
          })),
    instrumentationScope: scope(input.instrumentationScope),
  });

  return { text, attributes, scope, span };
}
