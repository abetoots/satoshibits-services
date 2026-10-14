/**
 * The preload and its loader hook, as a consumer runs them:
 *
 *   node --import @satoshibits/observability/register app.mjs
 *
 * The application is a plain `.mjs` file (fixtures/consumer-app.mjs) that
 * imports Express, pino, winston, bunyan and `node:http` statically. The
 * package resolves by its own name through its `exports` map (Node's
 * self-reference, from the package directory), so what runs is the built
 * `dist/`, rebuilt before this file's tests. Once more, the same application
 * is bundled the way the second consumer builds (esbuild, packages external,
 * ESM) and run on Node 22.
 *
 * The same application, made to carry secrets (OBS_FIXTURE_SENSITIVE=1),
 * shows what the standard redaction policy `register` starts under does to
 * telemetry the pinned instrumentations really emit, against a control with
 * `redaction: false`, and an allow-list a preload of the application's own
 * builds.
 *
 * Every case runs on Node 22 and Node 25. A missing binary fails the file.
 */

import { build } from "esbuild";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { SinkLogRecord, SinkSpan } from "../../../testing/otlp-decode.mjs";
import type { OtlpSink } from "../../../testing/otlp-sink.mjs";
import type { ChildRun } from "./harness.mjs";

import { runNode, useSinks } from "./harness.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
// relative to the package directory, where every child runs
const FIXTURES = "src/__tests__/preset/subprocess/fixtures";
const APP = `${FIXTURES}/consumer-app.mjs`;
// inside dist/ (git-ignored, and not under node_modules, where a package cannot import
// itself by name); package.json `files` leaves it out of the published package
const BUNDLE_DIR = "dist/__consumer__";
const BUNDLE = `${BUNDLE_DIR}/consumer-app.mjs`;
const REGISTER = ["--import", "@satoshibits/observability/register"];

/** each binary by the variable that names it; unset, the development machine's nvm install */
const NODE_VARIABLES = {
  "22": [
    "OBS_TEST_NODE_22",
    join(homedir(), ".nvm/versions/node/v22.21.0/bin/node"),
  ],
  "25": [
    "OBS_TEST_NODE_25",
    join(homedir(), ".nvm/versions/node/v25.0.0/bin/node"),
  ],
} as const;
const NODES = {
  "22": process.env[NODE_VARIABLES["22"][0]] ?? NODE_VARIABLES["22"][1],
  "25": process.env[NODE_VARIABLES["25"][0]] ?? NODE_VARIABLES["25"][1],
};

interface AppResult {
  status: number;
  finishError: string | null;
  port: number;
  sockets: { host: string; port: number }[];
  /** with OBS_FIXTURE_SENSITIVE=1: the two failing routes' statuses */
  failures?: { email: number; clean: number };
  /** with OBS_FIXTURE_SENSITIVE=1: every value a policy must remove, by name */
  sensitive?: Record<
    "querySecret" | "contact" | "eventEmail" | "eventQuery" | "errorEmail",
    string
  >;
}

const sinks = useSinks();
let sink: OtlpSink;
beforeEach(() => {
  ({ sink } = sinks);
});

beforeAll(async () => {
  for (const version of ["22", "25"] as const) {
    const binary = NODES[version];
    // the harness's rule for the sink port: a missing prerequisite fails, it never skips
    if (!existsSync(binary)) {
      throw new Error(
        `node ${version} is required at ${binary}; set ${NODE_VARIABLES[version][0]} to its binary`,
      );
    }
  }
  // built here rather than checked for staleness: the build takes seconds, and a stale
  // dist/ would test code that is not the source under review. The release workflow sets
  // OBS_TEST_DIST_FRESH because turbo has just built dist/ before running the tests there
  if (process.env.OBS_TEST_DIST_FRESH !== "1") {
    await promisify(execFile)("pnpm", ["run", "build"], { cwd: PACKAGE_ROOT });
  }
  await build({
    entryPoints: [join(PACKAGE_ROOT, APP)],
    outfile: join(PACKAGE_ROOT, BUNDLE),
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
}, 120_000);

afterAll(() => {
  rmSync(join(PACKAGE_ROOT, BUNDLE_DIR), { recursive: true, force: true });
});

const environment = (logs: "on" | "off"): Record<string, string> => ({
  OTEL_SERVICE_NAME: "preload-test",
  OTEL_EXPORTER_OTLP_ENDPOINT: sink.url,
  ...(logs === "on" && { OTEL_LOGS_EXPORTER: "otlp" }),
});

async function runApp(
  node: string,
  args: string[],
  env: Record<string, string>,
): Promise<ChildRun<AppResult>> {
  const run = await runNode<AppResult>({ node, args, env });
  expect(run.code, run.stderr).toBe(0);
  expect(run.result.status).toBe(200);
  expect(run.result.finishError).toBeNull();
  return run;
}

type LineName =
  | "pino"
  | "winston"
  | "bunyan"
  | "early-pino"
  | "pino-event"
  | "pino-email-error"
  | "pino-clean-error";

/** the line each logger wrote to stdout, by the `logger` field the fixture gives it */
function stdoutLines(
  run: ChildRun<AppResult>,
): Partial<Record<LineName, Record<string, unknown>>> {
  const lines: Partial<Record<LineName, Record<string, unknown>>> = {};
  for (const text of run.stdout.split("\n")) {
    if (!text.startsWith("{")) continue;
    let line: Record<string, unknown>;
    try {
      line = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // not a logger's line
      continue;
    }
    if (typeof line.logger === "string") lines[line.logger as LineName] = line;
  }
  return lines;
}

/** the spans of the fixture's one request to itself */
function requestSpans(at: OtlpSink): {
  client: SinkSpan;
  server: SinkSpan;
  route: SinkSpan;
} {
  const spans = at.spans();
  const server = spans.find(
    (s) =>
      s.scope.name === "@opentelemetry/instrumentation-http" && s.kind === 2,
  );
  expect(
    server,
    `a server span among ${JSON.stringify(spans.map((s) => s.name))}`,
  ).toBeDefined();
  const client = spans.find((s) => s.spanId === server!.parentSpanId);
  const route = spans.find(
    (s) =>
      s.scope.name === "@opentelemetry/instrumentation-express" &&
      s.attributes["http.route"] === "/users/:id",
  );
  expect(client, "the client span the server span continues").toMatchObject({
    scope: { name: "@opentelemetry/instrumentation-http" },
    kind: 3,
    traceId: server!.traceId,
  });
  expect(route, "the Express route span").toMatchObject({
    traceId: server!.traceId,
  });
  return { client: client!, server: server!, route: route! };
}

const LOG_SCOPES = {
  pino: "@opentelemetry/instrumentation-pino",
  winston: "@opentelemetry/winston-transport",
  bunyan: "@opentelemetry/instrumentation-bunyan",
} as const;

const recordOf = (records: SinkLogRecord[], logger: keyof typeof LOG_SCOPES) =>
  records.find((r) => r.scope.name === LOG_SCOPES[logger]);

// the removed addresses are not among the raw-body markers: their value, 127.0.0.1, is
// also server.address and the host in url.full; the decoded attribute checks and the
// redaction: false control cover them
const SENSITIVE = { OBS_FIXTURE_SENSITIVE: "1" };

/** a run of the app with OBS_FIXTURE_SENSITIVE=1, logs on, and what it sent, found by request */
async function runSensitive(node: string, preload: string[]) {
  const run = await runApp(node, [...preload, APP], {
    ...environment("on"),
    ...SENSITIVE,
  });
  expect(run.result.failures).toEqual({ email: 500, clean: 500 });
  const sensitive = run.result.sensitive!;
  const spans = sink.spans();
  const http = (kind: number) =>
    spans.filter(
      (s) =>
        s.scope.name === "@opentelemetry/instrumentation-http" &&
        s.kind === kind,
    );
  const server = http(2).find((s) => s.attributes["url.path"] === "/users/42");
  expect(
    server,
    `the server span of /users/42 among ${JSON.stringify(spans.map((s) => s.name))}`,
  ).toBeDefined();
  const client = http(3).find((s) => s.spanId === server!.parentSpanId);
  expect(client, "the client span the server span continues").toBeDefined();
  const expressRoute = (route: string) => {
    const found = spans.find(
      (s) =>
        s.scope.name === "@opentelemetry/instrumentation-express" &&
        s.attributes["http.route"] === route,
    );
    expect(found, `the Express span of ${route}`).toBeDefined();
    return found!;
  };
  const records = sink.logRecords();
  const pinoRecord = (body: string) => {
    const found = records.find(
      (r) => r.scope.name === LOG_SCOPES.pino && r.body === body,
    );
    expect(found, `the pino record "${body}"`).toBeDefined();
    return found!;
  };
  const lines = stdoutLines(run);
  /** the stack pino itself wrote to stdout for a logged error */
  const stackOnStdout = (name: "pino-email-error" | "pino-clean-error") => {
    const err = lines[name]?.err as { stack?: unknown } | undefined;
    expect(typeof err?.stack, `${name}'s err.stack on stdout`).toBe("string");
    return err!.stack as string;
  };
  // every byte the sink received, whatever the signal
  const rawBodies = sink.requests.map((r) => r.bodyText).join("\n");
  return {
    run,
    sensitive,
    spans,
    server: server!,
    client: client!,
    expressEmail: expressRoute("/fail/email"),
    expressClean: expressRoute("/fail/clean"),
    // the router instrumentation (Express 5) records the same exception on spans of its own
    exceptionSpans: spans.filter((s) =>
      s.events.some((e) => e.name === "exception"),
    ),
    eventRecord: pinoRecord("pino event line"),
    emailErrorRecord: pinoRecord("email error line"),
    cleanErrorRecord: pinoRecord("clean error line"),
    emailStack: stackOnStdout("pino-email-error"),
    cleanStack: stackOnStdout("pino-clean-error"),
    routeHandler: spans.find(
      (s) =>
        s.attributes["http.route"] === "/users/:id" &&
        "app.owner" in s.attributes,
    ),
    rawBodies,
  };
}

describe.each(Object.entries(NODES))(
  "node --import …/register on Node %s",
  (_version, node) => {
    it("gives server, route and client spans of one request, and every logger's line carries its trace id on stdout and at /v1/logs", async () => {
      const run = await runApp(node, [...REGISTER, APP], environment("on"));

      const { server } = requestSpans(sink);
      const traceId = server.traceId;
      expect(sink.requestsTo("/v1/metrics").length).toBeGreaterThan(0);

      const lines = stdoutLines(run);
      // the censored path shows the line is the one pino finished
      expect(lines.pino).toMatchObject({
        trace_id: traceId,
        note: "[pino-censored]",
      });
      expect(lines.winston).toMatchObject({ trace_id: traceId });
      expect(lines.bunyan).toMatchObject({ trace_id: traceId });

      const records = sink.logRecords();
      expect(recordOf(records, "pino")).toMatchObject({
        body: "pino line",
        traceId,
        attributes: { note: "[pino-censored]" },
      });
      expect(recordOf(records, "winston")).toMatchObject({
        body: "winston line",
        traceId,
      });
      expect(recordOf(records, "bunyan")).toMatchObject({
        body: "bunyan line",
        traceId,
      });
    });

    it("with the logs signal off, the lines still carry the trace id and none is sent", async () => {
      const run = await runApp(node, [...REGISTER, APP], environment("off"));

      const { server } = requestSpans(sink);
      const lines = stdoutLines(run);
      expect(lines.pino).toMatchObject({ trace_id: server.traceId });
      expect(lines.winston).toMatchObject({ trace_id: server.traceId });
      expect(lines.bunyan).toMatchObject({ trace_id: server.traceId });
      expect(sink.requestsTo("/v1/logs")).toEqual([]);
    });

    it("a partial override of the pino instrumentation renames its keys and keeps log sending with the logs signal", async () => {
      const preload = ["--import", `./${FIXTURES}/override-preload.mjs`];

      const on = await runApp(node, [...preload, APP], environment("on"));
      const traceId = requestSpans(sink).server.traceId;
      const line = stdoutLines(on).pino;
      expect(line).toMatchObject({ tid: traceId, tf: "01" });
      expect(line?.sid).toMatch(/^[0-9a-f]{16}$/);
      expect(line).not.toHaveProperty("trace_id");
      expect(recordOf(sink.logRecords(), "pino")).toMatchObject({
        body: "pino line",
        traceId,
      });

      const offSink = await sinks.extra();
      const off = await runApp(node, [...preload, APP], {
        ...environment("off"),
        OTEL_EXPORTER_OTLP_ENDPOINT: offSink.url,
      });
      expect(stdoutLines(off).pino).toMatchObject({
        tid: requestSpans(offSink).server.traceId,
      });
      expect(offSink.requestsTo("/v1/logs")).toEqual([]);
    });

    it("a partial setting for the dns instrumentation keeps the preset's `enabled: false` for it", async () => {
      // log sending cannot show a kept default (with logs off nothing could arrive either way); a span can
      const preload = ["--import", `./${FIXTURES}/dns-override-preload.mjs`];
      const lookup = { OBS_FIXTURE_DNS_LOOKUP: "1" };
      const dnsSpans = (at: OtlpSink) =>
        at.spans().filter((s) => s.name === "dns.lookup");

      await runApp(node, [...preload, APP], {
        ...environment("off"),
        ...lookup,
      });
      requestSpans(sink);
      expect(dnsSpans(sink)).toEqual([]);

      // control: the same partial setting with `enabled: true` does record the lookup
      const enabledSink = await sinks.extra();
      await runApp(node, [...preload, APP], {
        ...environment("off"),
        ...lookup,
        OTEL_EXPORTER_OTLP_ENDPOINT: enabledSink.url,
        OBS_FIXTURE_DNS_ENABLED: "1",
      });
      expect(dnsSpans(enabledSink).length).toBeGreaterThan(0);
    });

    it("control: the same application without the flag sends nothing and its lines carry no trace id", async () => {
      const run = await runApp(node, [APP], environment("on"));

      expect(run.result.sockets).toEqual([]);
      expect(sink.connections).toEqual([]);
      const lines = stdoutLines(run);
      for (const name of ["pino", "winston", "bunyan"] as const) {
        expect(lines[name], name).toBeDefined();
        expect(lines[name], name).not.toHaveProperty("trace_id");
      }
    });

    it("control: a logger created before start() is not correlated, inside a span that reaches the sink", async () => {
      // the preload imports a module that creates a pino logger, then calls start()
      const run = await runApp(
        node,
        ["--import", `./${FIXTURES}/early-logger-preload.mjs`, APP],
        { ...environment("on"), OBS_FIXTURE_EARLY_LOGGER: "1" },
      );

      const { server } = requestSpans(sink);
      const lines = stdoutLines(run);
      // a logger created after start() is correlated even though pino was loaded before it
      expect(lines.pino).toMatchObject({ trace_id: server.traceId });
      // observed on pino 9.14 and instrumentation-pino 0.69 on Node 22 and 25: the early
      // logger's line has no trace id and is not sent. The import rule stands on that
      expect(lines["early-pino"]).toBeDefined();
      expect(lines["early-pino"]).not.toHaveProperty("trace_id");
      expect(sink.logRecords().map((r) => r.body)).not.toContain(
        "early pino line",
      );
    });
  },
);

describe.each(Object.entries(NODES))(
  "the standard redaction policy on telemetry from real instrumentation, on Node %s",
  (_version, node) => {
    it("under register: query strings, peer addresses, span exception detail and status text are gone; logged errors keep theirs, masked; the event name is masked", async () => {
      const at = await runSensitive(node, REGISTER);
      const { sensitive, server, client } = at;

      // the inbound request (server span) and the outbound one (client span) are the
      // fixture's one request to itself, its query string holding a secret
      expect
        .soft(server.attributes, "server span")
        .not.toHaveProperty("url.query");
      expect
        .soft(server.attributes["url.path"], "server span url.path")
        .toBe("/users/42");
      expect
        .soft(client.attributes["url.full"], "client span url.full")
        .toBe(`http://127.0.0.1:${at.run.result.port}/users/42`);
      // the pinned HTTP instrumentation emits client.address on the server span only
      expect
        .soft(server.attributes, "server")
        .not.toHaveProperty("client.address");
      for (const [name, span] of [
        ["server", server],
        ["client", client],
      ] as const) {
        expect
          .soft(span.attributes, name)
          .not.toHaveProperty("network.peer.address");
        expect
          .soft(span.attributes["server.address"], `${name} server.address`)
          .toBe("127.0.0.1");
      }

      // a route that throws: the exception event keeps its type only, the status no text
      for (const [route, span] of [
        ["/fail/email", at.expressEmail],
        ["/fail/clean", at.expressClean],
      ] as const) {
        expect
          .soft(span.events, `${route} events`)
          .toEqual([
            { name: "exception", attributes: { "exception.type": "Error" } },
          ]);
        expect.soft(span.status, `${route} status`).toEqual({ code: 2 });
      }
      for (const span of at.exceptionSpans) {
        for (const event of span.events.filter((e) => e.name === "exception")) {
          expect
            .soft(event.attributes, `exception event on ${span.name}`)
            .toEqual({
              "exception.type": "Error",
            });
        }
      }
      expect
        .soft(
          at.spans
            .filter((s) => s.status.message !== undefined)
            .map((s) => s.name),
          "spans with status text",
        )
        .toEqual([]);

      // pino moves `otel.event.name` into the record's event name; the policy masks it as text
      expect
        .soft(at.eventRecord.eventName, "event name")
        .toBe("signup [EMAIL] https://example.com/cb");
      expect
        .soft(at.eventRecord.attributes, "event record")
        .not.toHaveProperty("otel.event.name");

      // the log record of the same error keeps its detail: clean text unchanged, an email masked
      expect
        .soft(at.cleanErrorRecord.attributes, "clean error record")
        .toMatchObject({
          "exception.type": "Error",
          "exception.message": "payment gateway timed out",
          "exception.stacktrace": at.cleanStack,
        });
      expect
        .soft(at.emailErrorRecord.attributes, "email error record")
        .toMatchObject({
          "exception.type": "Error",
          "exception.message": "payment failed for [EMAIL]",
          "exception.stacktrace": at.emailStack.replaceAll(
            sensitive.errorEmail,
            "[EMAIL]",
          ),
        });
      expect
        .soft(at.emailStack, "the stack pino wrote holds the email")
        .toContain(sensitive.errorEmail);

      // nowhere in any request, in any signal
      for (const [name, value] of Object.entries(sensitive)) {
        expect
          .soft(
            at.rawBodies.includes(value),
            `${name} (${value}) in a request body`,
          )
          .toBe(false);
      }
    });

    it("not through register: a preload with the standard parts and `app.contact` allowed exports that key as given and masks the same value under another", async () => {
      const at = await runSensitive(node, [
        "--import",
        `./${FIXTURES}/allow-list-preload.mjs`,
      ]);

      expect(
        at.routeHandler,
        "the span the route set its attributes on",
      ).toBeDefined();
      expect(at.routeHandler!.attributes).toMatchObject({
        "app.contact": at.sensitive.contact,
        "app.owner": "[EMAIL]",
      });
      // the rest of the standard policy still applies
      expect(at.server.attributes).not.toHaveProperty("url.query");
    });

    it("control: with `redaction: false` the same telemetry carries every value the policy removes", async () => {
      const at = await runSensitive(node, [
        "--import",
        `./${FIXTURES}/no-redaction-preload.mjs`,
      ]);
      const { sensitive, server, client } = at;
      const query = `api_key=${sensitive.querySecret}&page=2`;
      const emailMessage = `payment failed for ${sensitive.errorEmail}`;

      expect
        .soft(server.attributes["url.query"], "server url.query")
        .toBe(query);
      expect
        .soft(client.attributes["url.full"], "client url.full")
        .toBe(`http://127.0.0.1:${at.run.result.port}/users/42?${query}`);
      expect
        .soft(server.attributes["client.address"], "server client.address")
        .toBe("127.0.0.1");
      for (const [name, span] of [
        ["server", server],
        ["client", client],
      ] as const) {
        expect
          .soft(
            span.attributes["network.peer.address"],
            `${name} network.peer.address`,
          )
          .toBe("127.0.0.1");
      }
      expect.soft(at.expressEmail.events, "/fail/email events").toEqual([
        {
          name: "exception",
          attributes: {
            "exception.type": "Error",
            "exception.message": emailMessage,
            "exception.stacktrace": at.emailStack,
          },
        },
      ]);
      expect
        .soft(at.expressEmail.status, "/fail/email status")
        .toEqual({ code: 2, message: emailMessage });
      const cleanMessage = "payment gateway timed out";
      expect.soft(at.expressClean.events, "/fail/clean events").toEqual([
        {
          name: "exception",
          attributes: {
            "exception.type": "Error",
            "exception.message": cleanMessage,
            "exception.stacktrace": at.cleanStack,
          },
        },
      ]);
      expect
        .soft(at.expressClean.status, "/fail/clean status")
        .toEqual({ code: 2, message: cleanMessage });
      expect
        .soft(at.eventRecord.eventName, "event name")
        .toBe(
          `signup ${sensitive.eventEmail} https://example.com/cb?code=${sensitive.eventQuery}`,
        );
      expect
        .soft(at.emailErrorRecord.attributes, "email error record")
        .toMatchObject({
          "exception.message": emailMessage,
          "exception.stacktrace": at.emailStack,
        });
      expect
        .soft(at.routeHandler?.attributes["app.owner"], "app.owner")
        .toBe(sensitive.contact);
      for (const [name, value] of Object.entries(sensitive)) {
        expect
          .soft(
            at.rawBodies.includes(value),
            `${name} (${value}) in a request body`,
          )
          .toBe(true);
      }
    });
  },
);

describe("bundled as the second consumer builds (esbuild, packages external, ESM)", () => {
  it("on Node 22, pino and winston lines carry the request's trace id and arrive at /v1/logs", async () => {
    const run = await runApp(
      NODES["22"],
      [...REGISTER, BUNDLE],
      environment("on"),
    );

    const { server } = requestSpans(sink);
    const traceId = server.traceId;
    const lines = stdoutLines(run);
    expect(lines.pino).toMatchObject({ trace_id: traceId });
    expect(lines.winston).toMatchObject({ trace_id: traceId });
    const records = sink.logRecords();
    expect(recordOf(records, "pino")).toMatchObject({
      body: "pino line",
      traceId,
    });
    expect(recordOf(records, "winston")).toMatchObject({
      body: "winston line",
      traceId,
    });
  });
});
