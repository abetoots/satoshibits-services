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

/** one call of the policy: which function, as which surface, and with what */
export interface ProbeCall {
  fn: keyof RedactionPolicy;
  surface?: string;
  /** the text handed over (for an event, its name), or the keys of the attribute set */
  given: string | string[];
}

/**
 * @param calls when given, every call of `text`, `attributes`, `spanStatus`
 *   and `spanEvent` is recorded here. The marks show what the policy did to what was exported; only this
 *   shows what it was handed, including anything the preset replaced afterwards.
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
    logRecord: (record) => ({
      ...record,
      body:
        typeof record.body === "string"
          ? probed("log.record", record.body)
          : record.body,
      attributes: marked("log.record", record.attributes),
    }),
  };
}
