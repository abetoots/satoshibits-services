/**
 * A redaction policy for tests: it marks whatever it is handed with the
 * surface it was told, so an assertion can tell that the policy was applied,
 * to what, and as which surface. It redacts nothing by itself.
 *
 * The preset ships no policy; the redaction package's standard policy is
 * tested where it is wired in. This one tests the seam.
 */

import type {
  PolicyAttributes,
  RedactionPolicy,
} from "../../preset/redaction.mjs";

import { isPlainObject } from "../../preset/redaction.mjs";

export const probed = (surface: string, value: string): string =>
  `[probe:${surface}] ${value}`;

/** every string value marked; other values as they were */
const marked = (surface: string, attributes: PolicyAttributes): PolicyAttributes =>
  Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      typeof value === "string" ? probed(surface, value) : value,
    ]),
  );

const markedText = (surface: string, value: unknown): unknown =>
  typeof value === "string" ? probed(surface, value) : value;

/** a string body marked, and the strings one level into an object or an array; anything else as it was */
const markedBody = (body: unknown): unknown => {
  if (Array.isArray(body)) return body.map((value) => markedText("log.record", value));
  if (isPlainObject(body)) return marked("log.record", body);
  return markedText("log.record", body);
};

/** one call of the policy: which function, as which surface, and with what */
export interface ProbeCall {
  fn: keyof RedactionPolicy;
  surface?: string;
  /**
   * the text handed over (for an event, its name), the keys of the attribute
   * set, or for a log record the keys of the record itself
   */
  given: string | string[];
}

/**
 * @param calls when given, every call of the policy is recorded here. The marks show what the policy did to
 *   what was exported; only this shows what it was handed, including anything
 *   the preset replaced afterwards.
 */
export function createProbePolicy(calls?: ProbeCall[]): RedactionPolicy {
  return {
    text: (surface, value) => {
      calls?.push({ fn: "text", surface, given: value });
      return probed(surface, value);
    },
    attributes: (surface, attributes) => {
      calls?.push({ fn: "attributes", surface, given: Object.keys(attributes) });
      return marked(surface, attributes);
    },
    spanStatus: (message) => {
      calls?.push({ fn: "spanStatus", given: message });
      return probed("span.status", message);
    },
    spanEvent: (event) => {
      calls?.push({ fn: "spanEvent", given: event.name });
      return {
        name: probed("span.event", event.name),
        attributes: marked("span.event", event.attributes),
      };
    },
    logRecord: (record) => {
      calls?.push({ fn: "logRecord", given: Object.keys(record) });
      return {
        body: markedBody(record.body),
        attributes: marked("log.record", record.attributes),
        // only what the record has: a key added here would be exported
        ...(record.eventName !== undefined && {
          eventName: probed("log.record", record.eventName),
        }),
        ...(record.severityText !== undefined && {
          severityText: probed("log.record", record.severityText),
        }),
      };
    },
  };
}
