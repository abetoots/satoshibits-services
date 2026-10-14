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
  "22": ["OBS_TEST_NODE_22", join(homedir(), ".nvm/versions/node/v22.21.0/bin/node")],
  "25": ["OBS_TEST_NODE_25", join(homedir(), ".nvm/versions/node/v25.0.0/bin/node")],
} as const;
const NODES = {
  "22": process.env[NODE_VARIABLES["22"][0]] ?? NODE_VARIABLES["22"][1],
  "25": process.env[NODE_VARIABLES["25"][0]] ?? NODE_VARIABLES["25"][1],
};

interface AppResult {
  status: number;
  finishError: string | null;
  sockets: { host: string; port: number }[];
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

type LineName = "pino" | "winston" | "bunyan" | "early-pino";

/** the line each logger wrote to stdout, by the `logger` field the fixture gives it */
function stdoutLines(run: ChildRun<AppResult>): Partial<Record<LineName, Record<string, unknown>>> {
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
function requestSpans(at: OtlpSink): { client: SinkSpan; server: SinkSpan; route: SinkSpan } {
  const spans = at.spans();
  const server = spans.find(
    (s) => s.scope.name === "@opentelemetry/instrumentation-http" && s.kind === 2,
  );
  expect(server, `a server span among ${JSON.stringify(spans.map((s) => s.name))}`).toBeDefined();
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
  expect(route, "the Express route span").toMatchObject({ traceId: server!.traceId });
  return { client: client!, server: server!, route: route! };
}

const LOG_SCOPES = {
  pino: "@opentelemetry/instrumentation-pino",
  winston: "@opentelemetry/winston-transport",
  bunyan: "@opentelemetry/instrumentation-bunyan",
} as const;

const recordOf = (records: SinkLogRecord[], logger: keyof typeof LOG_SCOPES) =>
  records.find((r) => r.scope.name === LOG_SCOPES[logger]);

describe.each(Object.entries(NODES))("node --import …/register on Node %s", (_version, node) => {
  it("gives server, route and client spans of one request, and every logger's line carries its trace id on stdout and at /v1/logs", async () => {
    const run = await runApp(node, [...REGISTER, APP], environment("on"));

    const { server } = requestSpans(sink);
    const traceId = server.traceId;
    expect(sink.requestsTo("/v1/metrics").length).toBeGreaterThan(0);

    const lines = stdoutLines(run);
    // the censored path shows the line is the one pino finished
    expect(lines.pino).toMatchObject({ trace_id: traceId, note: "[pino-censored]" });
    expect(lines.winston).toMatchObject({ trace_id: traceId });
    expect(lines.bunyan).toMatchObject({ trace_id: traceId });

    const records = sink.logRecords();
    expect(recordOf(records, "pino")).toMatchObject({
      body: "pino line",
      traceId,
      attributes: { note: "[pino-censored]" },
    });
    expect(recordOf(records, "winston")).toMatchObject({ body: "winston line", traceId });
    expect(recordOf(records, "bunyan")).toMatchObject({ body: "bunyan line", traceId });
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
    expect(recordOf(sink.logRecords(), "pino")).toMatchObject({ body: "pino line", traceId });

    const offSink = await sinks.extra();
    const off = await runApp(node, [...preload, APP], {
      ...environment("off"),
      OTEL_EXPORTER_OTLP_ENDPOINT: offSink.url,
    });
    expect(stdoutLines(off).pino).toMatchObject({ tid: requestSpans(offSink).server.traceId });
    expect(offSink.requestsTo("/v1/logs")).toEqual([]);
  });

  it("a partial setting for the dns instrumentation keeps the preset's `enabled: false` for it", async () => {
    // log sending cannot show a kept default (with logs off nothing could arrive either way); a span can
    const preload = ["--import", `./${FIXTURES}/dns-override-preload.mjs`];
    const lookup = { OBS_FIXTURE_DNS_LOOKUP: "1" };
    const dnsSpans = (at: OtlpSink) => at.spans().filter((s) => s.name === "dns.lookup");

    await runApp(node, [...preload, APP], { ...environment("off"), ...lookup });
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
    expect(sink.logRecords().map((r) => r.body)).not.toContain("early pino line");
  });
});

describe("bundled as the second consumer builds (esbuild, packages external, ESM)", () => {
  it("on Node 22, pino and winston lines carry the request's trace id and arrive at /v1/logs", async () => {
    const run = await runApp(NODES["22"], [...REGISTER, BUNDLE], environment("on"));

    const { server } = requestSpans(sink);
    const traceId = server.traceId;
    const lines = stdoutLines(run);
    expect(lines.pino).toMatchObject({ trace_id: traceId });
    expect(lines.winston).toMatchObject({ trace_id: traceId });
    const records = sink.logRecords();
    expect(recordOf(records, "pino")).toMatchObject({ body: "pino line", traceId });
    expect(recordOf(records, "winston")).toMatchObject({ body: "winston line", traceId });
  });
});
