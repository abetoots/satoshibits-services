/**
 * The README's snippets, run as a consumer runs them: from a package of its
 * own, outside this repository, whose node_modules holds this package (the
 * built `dist/`, rebuilt before the file's tests), `@satoshibits/redaction`
 * and `@opentelemetry/api`. The links resolve to the real packages, so their
 * own dependencies (dev ones included) stay visible to them; a preload in the
 * consumer imports the redaction package through the consumer's own
 * dependency on it.
 *
 * Each snippet is read from README.md (see ../readme-snippets.mts); `app.js`
 * is fixtures/readme-app.mjs, and the README's example endpoint is replaced
 * by the test's sink.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { SinkSpan } from "../../../testing/otlp-decode.mjs";
import type { OtlpSink } from "../../../testing/otlp-sink.mjs";
import type { ChildRun, ReportsSockets } from "./harness.mjs";

import { PACKAGE_ROOT, parseCommand, snippet } from "../readme-snippets.mjs";
import { runNode, useSinks } from "./harness.mjs";

interface AppResult extends ReportsSockets {
  status: number;
}

// the secret fixtures/readme-app.mjs puts in its request's query string
const SECRET = "s3cret-query-token";

const sinks = useSinks();
let sink: OtlpSink;
beforeEach(() => {
  ({ sink } = sinks);
});

let consumer: string;

beforeAll(async () => {
  // as in preload.test.mts: built here unless the release workflow has just built dist/
  if (process.env.OBS_TEST_DIST_FRESH !== "1") {
    await promisify(execFile)("pnpm", ["run", "build"], { cwd: PACKAGE_ROOT });
  }
  consumer = mkdtempSync(join(tmpdir(), "obs-readme-consumer-"));
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "readme-consumer",
      private: true,
      type: "module",
      dependencies: {
        "@opentelemetry/api": "*",
        "@satoshibits/observability": "*",
        "@satoshibits/redaction": "*",
      },
    }),
  );
  const link = (name: string, target: string) => {
    mkdirSync(join(consumer, "node_modules", name, ".."), { recursive: true });
    symlinkSync(target, join(consumer, "node_modules", name), "dir");
  };
  link("@satoshibits/observability", PACKAGE_ROOT);
  link("@satoshibits/redaction", realpathSync(join(PACKAGE_ROOT, "node_modules/@satoshibits/redaction")));
  link("@opentelemetry/api", realpathSync(join(PACKAGE_ROOT, "node_modules/@opentelemetry/api")));
  copyFileSync(join(import.meta.dirname, "fixtures/readme-app.mjs"), join(consumer, "app.js"));
}, 120_000);

afterAll(() => {
  if (consumer) rmSync(consumer, { recursive: true, force: true });
});

/** run a README command in the consumer package, with the sink in place of its example endpoint */
async function runCommand(code: string, env: Record<string, string> = {}): Promise<ChildRun<AppResult>> {
  const command = parseCommand(code);
  expect(command.program).toBe("node");
  expect(command.args.at(-1), "the command runs the application").toBe("app.js");
  const endpoint = command.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (endpoint !== undefined) expect(endpoint).toMatch(/^https?:\/\//);
  const run = await runNode<AppResult>({
    args: command.args,
    env: {
      ...command.env,
      ...(endpoint !== undefined && { OTEL_EXPORTER_OTLP_ENDPOINT: sink.url }),
      ...env,
    },
    cwd: consumer,
  });
  expect(run.code, run.stderr).toBe(0);
  expect(run.result.status).toBe(200);
  return run;
}

/** the server span of the app's request to itself */
function serverSpan(): SinkSpan {
  const spans = sink.spans();
  const server = spans.find((s) => s.scope.name === "@opentelemetry/instrumentation-http" && s.kind === 2);
  expect(server, `a server span among ${JSON.stringify(spans.map((s) => s.name))}`).toBeDefined();
  return server!;
}

// the keys the standard policy drops as the peer's address, under any convention the instrumentation uses
const PEER_ADDRESS_KEYS = ["client.address", "network.peer.address", "http.client_ip", "net.peer.ip", "net.sock.peer.addr"];
const peerAddresses = (span: SinkSpan) => PEER_ADDRESS_KEYS.filter((key) => key in span.attributes);

describe("the quick start", () => {
  it("exports the app's spans under the standard policy, with one flag and the standard variables", async () => {
    const code = snippet("quick-start");
    expect(code).toMatch(/--import @satoshibits\/observability\/register/);
    const run = await runCommand(code);

    const span = serverSpan();
    expect(span.resource["service.name"]).toBe(parseCommand(code).env.OTEL_SERVICE_NAME);
    // the standard policy: no query string, no peer address
    expect(JSON.stringify(sink.spans())).not.toContain(SECRET);
    expect(peerAddresses(span)).toEqual([]);
    expect(run.stderrLines).toContainEqual(
      expect.objectContaining({ msg: "telemetry exporters are configured with the standard redaction policy" }),
    );
  });

  it("reads the variables from a .env file with Node's --env-file", async () => {
    const code = snippet("env-file");
    expect(parseCommand(code).args).toContain("--env-file=.env");
    writeFileSync(join(consumer, ".env"), `OTEL_SERVICE_NAME=from-env-file\nOTEL_EXPORTER_OTLP_ENDPOINT=${sink.url}\n`);
    try {
      await runCommand(code);
    } finally {
      rmSync(join(consumer, ".env"));
    }
    expect(serverSpan().resource["service.name"]).toBe("from-env-file");
  });
});

describe("a preload of your own", () => {
  beforeAll(() => {
    writeFileSync(join(consumer, "telemetry.mjs"), snippet("custom-preload"));
  });

  it("is a package that depends on @satoshibits/redaction itself", () => {
    const manifest = JSON.parse(readFileSync(join(consumer, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies).toHaveProperty("@satoshibits/redaction");
    expect(snippet("custom-preload")).toMatch(/from "@satoshibits\/redaction"/);
  });

  it("exports under the policy it names, with the service name set in code", async () => {
    const code = snippet("custom-preload-run");
    expect(parseCommand(code).args).toEqual(["--import", "./telemetry.mjs", "app.js"]);
    await runCommand(code);

    const span = serverSpan();
    const named = /serviceName: "([^"]+)"/.exec(snippet("custom-preload"));
    expect(named, "the snippet sets serviceName in code").not.toBeNull();
    expect(span.resource["service.name"]).toBe(named![1]);
    // the policy keeps the peer address the standard one drops, and still cuts the query string
    expect(peerAddresses(span).length).toBeGreaterThan(0);
    expect(JSON.stringify(sink.spans())).not.toContain(SECRET);
  });

  it("catches a configuration error, and the app runs without telemetry", async () => {
    const run = await runCommand(snippet("custom-preload-run"), { OTEL_TRACES_SAMPLER: "not-a-sampler" });
    expect(run.stderr).toContain("OTEL_TRACES_SAMPLER");
    expect(sink.requests).toEqual([]);
  });
});

describe("the test kit", () => {
  it("collects the spans the code under test makes, in-process", async () => {
    // the snippet, then one line that hands its result to this test
    writeFileSync(
      join(consumer, "kit.mjs"),
      `${snippet("test-kit")}\nprocess.stdout.write("RESULT " + JSON.stringify({ names: spans.map((s) => s.name), sockets: [] }) + "\\n");\n`,
    );
    const run = await runNode<ReportsSockets & { names: string[] }>({ args: ["kit.mjs"], cwd: consumer });
    expect(run.code, run.stderr).toBe(0);
    expect(run.result.names).toEqual(["checkout"]);
  });
});
