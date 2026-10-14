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
import { existsSync, readFileSync } from "node:fs";
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
    ) as {
      capturedWith: Record<string, string>;
      declared: Record<string, { version: string }>;
    };
    const requireFromHere = createRequire(import.meta.url);
    const requireFromBundle = createRequire(
      requireFromHere.resolve("@opentelemetry/auto-instrumentations-node"),
    );
    const recorded = {
      ...fixture.capturedWith,
      ...Object.fromEntries(
        Object.entries(fixture.declared).map(([name, { version }]) => [name, version]),
      ),
    };
    // the bundle, the three instrumentations the capture exercises, and the three it reads
    expect(Object.keys(recorded).sort()).toEqual([
      "@opentelemetry/auto-instrumentations-node",
      "@opentelemetry/instrumentation-express",
      "@opentelemetry/instrumentation-http",
      "@opentelemetry/instrumentation-ioredis",
      "@opentelemetry/instrumentation-mongodb",
      "@opentelemetry/instrumentation-pino",
      "@opentelemetry/instrumentation-redis",
    ]);
    // read from the manifest above each package's entry file: a package need not export it
    const versionOf = (name: string): string => {
      const resolve =
        name === "@opentelemetry/auto-instrumentations-node" ? requireFromHere : requireFromBundle;
      for (
        let directory = path.dirname(resolve.resolve(name));
        directory !== path.dirname(directory);
        directory = path.dirname(directory)
      ) {
        const manifest = path.join(directory, "package.json");
        if (!existsSync(manifest)) continue;
        const { name: found, version } = JSON.parse(readFileSync(manifest, "utf8")) as {
          name?: string;
          version?: string;
        };
        if (found === name && version !== undefined) return version;
      }
      throw new Error(`no package.json found for ${name}`);
    };
    const installed = Object.fromEntries(Object.keys(recorded).map((name) => [name, versionOf(name)]));
    // a difference means an upgrade: run `pnpm run capture:attribute-keys` and commit what changes
    expect(recorded).toEqual(installed);
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
    },
    { write: (line: string) => lines.push(line) },
  );

  it("is what the README shows", () => {
    const readme = readFileSync(path.join(REDACTION_PACKAGE, "README.md"), "utf8");
    for (const line of [
      "serializers: { err: (error) => redactFields(describeError(error)) },",
      "formatters: { log: (fields) => redactFields(fields) as Record<string, unknown> },",
    ]) {
      expect(readme).toContain(line);
    }
  });

  it("does what the README says it does: a log call's fields through redactFields, an error given as err described and redacted", () => {
    logger.info(
      {
        to: "a@b.io",
        password: "s3cr3t-value",
        nested: { list: [{ owner: "c@d.io" }] },
        err: Object.assign(new Error("no mailbox jane@example.com"), { detail: "carried by the error" }),
      },
      "sent",
    );
    const line = logged();
    expect(line).toMatchObject({
      to: "[EMAIL]",
      password: "[REDACTED]",
      nested: { list: [{ owner: "[EMAIL]" }] },
      err: { name: "Error", message: "no mailbox [EMAIL]" },
      msg: "sent",
    });
    // described: what the error carries beyond name, message, code and stack is not written
    expect(Object.keys(line.err as object).sort()).toEqual(["message", "name", "stack"]);
    // the stack is kept, and masked like the message
    expect((line.err as { stack: string }).stack).toContain("Error: no mailbox [EMAIL]");
    for (const address of ["a@b.io", "c@d.io", "jane@example.com"]) expect(lines.at(-1)).not.toContain(address);
  });

  it("leaves a large integer as pino wrote it: the line is not parsed again", () => {
    logger.info({ id: 9007199254740993n }, "m");
    expect(lines.at(-1)).toContain('"id":9007199254740993');
  });

  // the facts about pino the README states, each as pino behaves; if pino changes one, the README is wrong
  it("redacting in formatters.log alone would let an error's text pass: pino runs it before serializers", () => {
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

  it("does not redact a message given as an argument, or what is put into it, as the README says", () => {
    logger.info("sent to %s", "jane@example.com");
    expect(logged().msg).toBe("sent to jane@example.com");
    logger.info({ n: 1 }, "sent to jane@example.com");
    expect(logged().msg).toBe("sent to jane@example.com");
  });

  it("does not redact the message pino makes of an error logged with none, as the README says", () => {
    logger.error(new Error("bare jane@example.com"));
    expect(logged().msg).toBe("bare jane@example.com");
    expect((logged().err as { message: string }).message).toBe("bare [EMAIL]");
    // the same when the error is given as a field and no message with it
    logger.error({ err: new Error("field jane@example.com") });
    expect(logged().msg).toBe("field jane@example.com");
    // with a message of one's own, nothing of the error's is copied
    logger.error({ err: new Error("bare jane@example.com") }, "send failed");
    expect(logged().msg).toBe("send failed");
    expect(lines.at(-1)).not.toContain("jane@example.com");
  });

  it("writes an error under another key, and a class instance, as pino serializes them, as the README says", () => {
    const error = Object.assign(new Error("x"), { detail: "jane@example.com" });
    logger.info(
      { failure: error, link: new URL("https://h.example/a?e=jane@example.com"), at: new Date(0) },
      "m",
    );
    expect(logged()).toMatchObject({
      failure: { detail: "jane@example.com" },
      link: "https://h.example/a?e=jane@example.com",
      at: "1970-01-01T00:00:00.000Z",
    });
  });

  it("does not redact a child logger's bindings or the base fields, as the README says", () => {
    logger.child({ owner: "jane@example.com", password: "s3cr3t-value" }).info("m");
    expect(logged()).toMatchObject({ owner: "jane@example.com", password: "s3cr3t-value" });

    const based: string[] = [];
    pino(
      {
        base: { who: "jane@example.com" },
        formatters: { log: (fields) => redactFields(fields) as Record<string, unknown> },
      },
      { write: (line: string) => based.push(line) },
    ).info("m");
    expect(JSON.parse(based[0]!)).toMatchObject({ who: "jane@example.com" });
  });
});
