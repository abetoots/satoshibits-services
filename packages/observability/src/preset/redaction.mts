/**
 * Redaction of what leaves the process.
 *
 * One redactor is built per `start()` and applied where data is handed to an
 * exporter, so it covers telemetry from any source (auto-instrumentation
 * included) and does not depend on processor order.
 *
 * A value under a sensitive key is replaced whole, whatever its type. Other
 * string values have secrets and email addresses masked. Keys on the allow
 * list are passed through untouched.
 */

import type { SanitizerOptions } from "../enrichment/sanitizer.mjs";
import type { Attributes, AttributeValue } from "@opentelemetry/api";
import type { InstrumentationScope } from "@opentelemetry/core";

import { DataSanitizer } from "../enrichment/sanitizer.mjs";

export interface RedactionOptions {
  /** attribute keys whose values are exported as they are */
  allowKeys?: readonly string[];
  /** options for the underlying sanitizer; email masking is on unless turned off here */
  sanitizer?: SanitizerOptions;
}

export interface Redactor {
  /** a free-text value: a span name, a status message, a scope name */
  text: (value: string) => string;
  /** an attribute set; returns the same object when nothing changed */
  attributes: <T extends Attributes | undefined>(attributes: T) => T;
  /** an instrumentation scope: its name and attributes are chosen by API callers */
  scope: (scope: InstrumentationScope) => InstrumentationScope;
}

export const REDACTED = "[REDACTED]";

export function createRedactor(options: RedactionOptions = {}): Redactor {
  const sanitizer = new DataSanitizer({
    maskEmails: true,
    ...options.sanitizer,
  });
  const redacted = options.sanitizer?.redactionString ?? REDACTED;
  const allowed = new Set(options.allowKeys ?? []);

  const text = (value: string): string => sanitizer.sanitize(value) as string;

  const value = (attribute: AttributeValue): AttributeValue => {
    if (typeof attribute === "string") return text(attribute);
    if (Array.isArray(attribute)) {
      let changed = false;
      const items = attribute.map((item) => {
        if (typeof item !== "string") return item;
        const clean = text(item);
        if (clean !== item) changed = true;
        return clean;
      });
      return changed ? (items as AttributeValue) : attribute;
    }
    return attribute;
  };

  const attributes = <T extends Attributes | undefined>(input: T): T => {
    if (input === undefined) return input;
    let output: Attributes | undefined;
    for (const [key, original] of Object.entries(input)) {
      if (original === undefined || allowed.has(key)) continue;
      const clean = sanitizer.shouldRedactField(key) ? redacted : value(original);
      if (clean !== original) {
        output ??= { ...input };
        output[key] = clean;
      }
    }
    return (output ?? input) as T;
  };

  // scopes are few and long-lived, and every exported record carries one
  const scopes = new WeakMap<InstrumentationScope, InstrumentationScope>();
  const scope = (input: InstrumentationScope): InstrumentationScope => {
    const known = scopes.get(input);
    if (known) return known;
    const withAttributes = input as InstrumentationScope & {
      attributes?: Attributes;
    };
    const name = text(input.name);
    const cleanAttributes = attributes(withAttributes.attributes);
    const clean =
      name === input.name && cleanAttributes === withAttributes.attributes
        ? input
        : { ...input, name, attributes: cleanAttributes };
    scopes.set(input, clean);
    return clean;
  };

  return { text, attributes, scope };
}
