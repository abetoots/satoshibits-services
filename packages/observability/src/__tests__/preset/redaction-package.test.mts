/**
 * The redaction package's standard policy is a policy as the preset means
 * it. The two types are written apart (that package knows nothing of
 * OpenTelemetry, and this one does not take its types from it), so this is
 * where they are held together: by the compiler, and by running one through
 * the other.
 *
 * Also here, because this package has what they need: the check that the
 * recorded attribute keys were recorded from the instrumentations installed,
 * and the pino wiring the redaction package's README shows.
 */
import { trace } from "@opentelemetry/api";
import {
  createPolicy,
  describeError,
  redactFields,
  standardParts,
  standardPolicy,
} from "@satoshibits/redaction";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";

import type { RedactionPolicy as PackagePolicy } from "@satoshibits/redaction";

import type { RedactionOption, RedactionPolicy } from "../../preset.mjs";
import type { TestTelemetry } from "../../testing.mjs";

import { redactionProblem } from "../../preset/redaction.mjs";
import { startTestTelemetry } from "../../testing.mjs";

// checked by the compiler: a change to either type that parts them fails the build
standardPolicy satisfies RedactionPolicy;
createPolicy(standardParts) satisfies RedactionOption;
// and any policy written against the package's type is one the preset takes
null as unknown as PackagePolicy satisfies RedactionPolicy;

const REDACTION_PACKAGE = path.resolve(import.meta.dirname, "../../../../redaction");

describe("the redaction package's standard policy", () => {
  let telemetry: TestTelemetry | undefined;
  afterEach(async () => {
    await telemetry?.stop();
    telemetry = undefined;
  });

  it("is accepted as the preset's redaction option", () => {
    expect(redactionProblem(standardPolicy)).toBeUndefined();
    expect(redactionProblem(createPolicy(standardParts))).toBeUndefined();
  });

  it("is applied by the preset to what it hands a policy today: the resource and the scope", async () => {
    telemetry = startTestTelemetry({
      redaction: standardPolicy,
      resourceAttributes: {
        "deployment.owner": "jane@example.com",
        "deployment.api_key": "s3cr3t-value",
        "client.address": "203.0.113.7",
        "deployment.region": "eu-west-1",
      },
    });
    trace.getTracer("scope for jane@example.com").startSpan("s").end();

    const [span] = await telemetry.spans();
    expect(span!.resource.attributes).toMatchObject({
      "deployment.owner": "[EMAIL]",
      "deployment.api_key": "[REDACTED]",
      "deployment.region": "eu-west-1",
      // the identity keys are not the policy's
      "service.name": "test",
    });
    expect(span!.resource.attributes).not.toHaveProperty("client.address");
    expect(span!.instrumentationScope.name).toBe("scope for [EMAIL]");
  });
});

describe("the recorded attribute keys", () => {
  it("were recorded from the instrumentations installed now", () => {
    const fixture = JSON.parse(
      readFileSync(path.join(REDACTION_PACKAGE, "src/fixtures/attribute-keys.json"), "utf8"),
    ) as { declared: Record<string, { version: string }> };
    const requireFromBundle = createRequire(
      createRequire(import.meta.url).resolve("@opentelemetry/auto-instrumentations-node"),
    );
    const installed = Object.fromEntries(
      Object.keys(fixture.declared).map((name) => [
        name,
        (requireFromBundle(`${name}/package.json`) as { version: string }).version,
      ]),
    );
    // a difference means an upgrade: run `pnpm run capture:attribute-keys` and commit what changes
    expect(
      Object.fromEntries(Object.entries(fixture.declared).map(([name, { version }]) => [name, version])),
    ).toEqual(installed);
  });
});

describe("the pino wiring in the redaction package's README", () => {
  const lines: string[] = [];
  const logged = (): Record<string, unknown> => JSON.parse(lines.at(-1)!) as Record<string, unknown>;
  // the options as the README gives them; the destination is this test's
  const logger = pino(
    {
      serializers: { err: (error: unknown) => redactFields(describeError(error)) },
      formatters: { log: (fields) => redactFields(fields) as Record<string, unknown> },
      hooks: {
        logMethod(args, method) {
          method.apply(this, args.map((arg: unknown) => (typeof arg === "string" ? redactFields(arg) : arg)) as typeof args);
        },
      },
    },
    { write: (line: string) => lines.push(line) },
  );

  it("is what the README shows", () => {
    const readme = readFileSync(path.join(REDACTION_PACKAGE, "README.md"), "utf8");
    for (const line of [
      "serializers: { err: (error) => redactFields(describeError(error)) },",
      "formatters: { log: (fields) => redactFields(fields) as Record<string, unknown> },",
      'method.apply(this, args.map((arg) => (typeof arg === "string" ? redactFields(arg) : arg)) as typeof args);',
    ]) {
      expect(readme).toContain(line);
    }
  });

  it("masks a field, an error's message and stack, and the message with what is put into it", () => {
    logger.info(
      { to: "a@b.io", password: "s3cr3t-value", err: new Error("no mailbox jane@example.com") },
      "sent to %s",
      "c@d.io",
    );
    const line = logged();
    expect(line.to).toBe("[EMAIL]");
    expect(line.password).toBe("[REDACTED]");
    expect(line.msg).toBe("sent to [EMAIL]");
    expect(line.err).toMatchObject({ name: "Error", message: "no mailbox [EMAIL]" });
    expect(lines.at(-1)).not.toContain("jane@example.com");
  });

  it("without the serializer's own redaction an error's text would pass: the formatter runs first", () => {
    const plain: string[] = [];
    pino(
      {
        serializers: { err: describeError },
        formatters: { log: (fields) => redactFields(fields) as Record<string, unknown> },
      },
      { write: (line: string) => plain.push(line) },
    ).info({ err: new Error("no mailbox jane@example.com") }, "m");
    expect(plain[0]).toContain("jane@example.com");
  });

  it("leaves the one path the README names: an error logged with no message", () => {
    logger.error(new Error("bare jane@example.com"));
    expect(logged().msg).toBe("bare jane@example.com");
    expect((logged().err as { message: string }).message).toBe("bare [EMAIL]");
  });
});
