/**
 * Writes the list of attribute keys the redaction package's standard policy
 * is checked against: `packages/redaction/src/fixtures/attribute-keys.json`.
 *
 * Not a test. Run it with `pnpm run capture:attribute-keys` after an
 * OpenTelemetry upgrade and commit what changes; the redaction package's
 * tests then say what the standard policy does to any new key.
 *
 * Two sources:
 *  - captured: one Express request, one outbound HTTP request and one pino
 *    line, through the preset with the auto-instrumentation bundle and the
 *    in-memory kit; every attribute key seen on a span, a span event, a log
 *    record, an instrumentation scope and the resource;
 *  - declared: the attribute constants the MongoDB and Redis
 *    instrumentations in the bundle refer to. Nothing here connects to a
 *    database, so their keys are read from their code, not from a span.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { startTestTelemetry } from "../../testing.mjs";

/** the part of Express this script uses; its types are not a dependency here */
interface ExpressResponse {
  json: (body: unknown) => void;
  status: (code: number) => { end: () => void };
}
interface ExpressApp {
  get: (
    route: string,
    handler: (request: { params: Record<string, string> }, response: ExpressResponse) => void,
  ) => void;
  use: (
    handler: (error: unknown, request: unknown, response: ExpressResponse, next: unknown) => void,
  ) => void;
  listen: (port: number, host: string) => Server;
}

// the file to write, given by the package script: this file is run as a bundle
// from another directory, so it does not know where it lives
const [, , output] = process.argv;
if (output === undefined) {
  throw new Error("usage: capture-attribute-keys <file to write>");
}
const OUTPUT = path.resolve(output);

// ===== captured =====
process.env.OTEL_LOGS_EXPORTER = "otlp";
const telemetry = startTestTelemetry({ instrumentations: {} });

// loaded after start(), and with require: the instrumentations hook that, and
// with no loader hook registered here an import would pass them by
const requireFromHere = createRequire(import.meta.url);
const express = requireFromHere("express") as () => ExpressApp;
const pino = requireFromHere("pino") as typeof import("pino").default;
const http = requireFromHere("node:http") as typeof import("node:http");

const logger = pino({ level: "info" }, pino.destination({ dest: "/dev/null", sync: true }));
const app = express();
app.get("/users/:id", (request, response) => {
  logger.info({ userId: request.params.id }, "user read");
  response.json({ id: request.params.id });
});
app.get("/fails", () => {
  throw new Error("a handler that throws");
});
// four parameters make it an error handler
app.use((_error, _request, response, _next) => {
  response.status(500).end();
});

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const { port } = server.address() as AddressInfo;

const get = (target: string): Promise<void> =>
  new Promise((resolve, reject) => {
    http
      .get(
        `http://127.0.0.1:${port}${target}`,
        { headers: { "user-agent": "capture/1.0" } },
        (response) => {
          response.resume();
          response.on("end", resolve);
        },
      )
      .on("error", reject);
  });
await get("/users/17?fields=name");
await get("/fails");
await new Promise((resolve) => server.close(resolve));

const captured = new Map<string, Set<string>>();
const seen = (surface: string, attributes: object | undefined): void => {
  for (const key of Object.keys(attributes ?? {})) {
    const surfaces = captured.get(key) ?? new Set<string>();
    surfaces.add(surface);
    captured.set(key, surfaces);
  }
};

const spans = await telemetry.spans();
const records = await telemetry.logRecords();
for (const span of spans) {
  seen("span", span.attributes);
  seen("resource", span.resource.attributes);
  for (const event of span.events) seen("span event", event.attributes);
  for (const link of span.links) seen("link", link.attributes);
}
for (const record of records) {
  seen("log record", record.attributes);
  seen("scope", record.instrumentationScope.attributes);
}
await telemetry.stop();

if (spans.length === 0 || records.length === 0) {
  throw new Error(
    `nothing to write: ${spans.length} spans and ${records.length} log records were captured`,
  );
}

// ===== declared =====
const requireFromBundle = createRequire(
  requireFromHere.resolve("@opentelemetry/auto-instrumentations-node"),
);

/** every `.js` file under a directory */
const sourcesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourcesUnder(path.join(directory, entry.name))
      : entry.name.endsWith(".js")
        ? [path.join(directory, entry.name)]
        : [],
  );

/** the attribute keys an instrumentation's code refers to by constant, and its version */
const declaredBy = (name: string): { version: string; keys: string[] } => {
  const main = requireFromBundle.resolve(name);
  const sources = path.dirname(main);
  const requireFromInstrumentation = createRequire(main);
  const constants: Record<string, unknown> = {
    ...(requireFromInstrumentation("@opentelemetry/semantic-conventions") as object),
    // the instrumentation's own copy of the names not yet stable
    ...(requireFromInstrumentation(path.join(sources, "semconv.js")) as object),
  };
  const keys = new Set<string>();
  for (const file of sourcesUnder(sources)) {
    for (const [constant] of readFileSync(file, "utf8").matchAll(/\bATTR_[A-Z0-9_]+/g)) {
      const key = constants[constant];
      if (typeof key === "string") keys.add(key);
    }
  }
  const { PACKAGE_VERSION: version } = requireFromInstrumentation(
    path.join(sources, "version.js"),
  ) as { PACKAGE_VERSION: string };
  return { version, keys: [...keys].sort() };
};

const declared = Object.fromEntries(
  [
    "@opentelemetry/instrumentation-mongodb",
    "@opentelemetry/instrumentation-redis",
    "@opentelemetry/instrumentation-ioredis",
  ].map((name) => [name, declaredBy(name)]),
);

writeFileSync(
  OUTPUT,
  `${JSON.stringify(
    {
      note: "Written by packages/observability's capture:attribute-keys script; do not edit by hand.",
      captured: Object.fromEntries(
        [...captured.entries()]
          .sort(([left], [right]) => (left < right ? -1 : 1))
          .map(([key, surfaces]) => [key, [...surfaces].sort()]),
      ),
      declared,
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote ${captured.size} captured keys to ${OUTPUT}`);
