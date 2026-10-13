/**
 * The redaction package's standard policy is a policy as the preset means
 * it. The two types are written apart (that package knows nothing of
 * OpenTelemetry, and this one does not take its types from it), so this is
 * where they are held together.
 */
import { createPolicy, standardParts, standardPolicy } from "@satoshibits/redaction";
import { describe, expect, it } from "vitest";

import type { RedactionPolicy as PackagePolicy } from "@satoshibits/redaction";

import type { RedactionOption, RedactionPolicy } from "../../preset.mjs";

import { redactionProblem } from "../../preset/redaction.mjs";

// checked by the compiler: a change to either type that parts them fails the build
standardPolicy satisfies RedactionPolicy;
createPolicy(standardParts) satisfies RedactionOption;
// and any policy written against the package's type is one the preset takes
null as unknown as PackagePolicy satisfies RedactionPolicy;

describe("the redaction package's standard policy", () => {
  it("is accepted as the preset's redaction option", () => {
    expect(redactionProblem(standardPolicy)).toBeUndefined();
    expect(redactionProblem(createPolicy(standardParts))).toBeUndefined();
  });
});
