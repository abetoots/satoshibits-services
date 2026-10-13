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

export function createProbePolicy(): RedactionPolicy {
  return {
    text: (surface, value) => probed(surface, value),
    attributes: (surface, attributes) => marked(surface, attributes),
    spanStatus: (message) => probed("span.status", message),
    spanEvent: (event) => ({
      name: probed("span.event", event.name),
      attributes: marked("span.event", event.attributes),
    }),
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
