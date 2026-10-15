/**
 * The README's snippets, run as a consumer runs them: from a package of its
 * own, outside this repository, with `@opentelemetry/api` and
 * `@satoshibits/redaction` as its own dependencies and this package installed
 * from its packed tarball (see packed.mts's installPacked). So `files` and the
 * dependency list are what run: a file left out of the tarball, or an import
 * of a package the packed manifest does not declare, fails a test here. That
 * the peer range lets the app and the SDK share one copy of the api is
 * package-contents.test.mts's to check.
 *
 * Each snippet is read from README.md (see ../readme-snippets.mts); `app.js`
 * is fixtures/readme-app.mjs, and the README's example endpoint is replaced
 * by the test's sink.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  copyFileSync,
  existsSync,
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

import type { SinkSpan } from "../../../testing/otlp-decode.mjs";
import type { OtlpSink } from "../../../testing/otlp-sink.mjs";
import type { ChildRun, ReportsSockets } from "./harness.mjs";

import type { Installed } from "./packed.mjs";

import { parseCommand, snippet } from "../readme-snippets.mjs";
import { runNode, useSinks } from "./harness.mjs";
import { buildDist, installPacked, PACKAGE_ROOT, packPackage } from "./packed.mjs";

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
let installed: Installed;

beforeAll(async () => {
  await buildDist();
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
  // the consumer's own dependencies, the workspace's installed copies (the test runs offline)
  for (const name of ["@satoshibits/redaction", "@opentelemetry/api"]) {
    mkdirSync(join(consumer, "node_modules", name, ".."), { recursive: true });
    symlinkSync(realpathSync(join(PACKAGE_ROOT, "node_modules", name)), join(consumer, "node_modules", name), "dir");
  }
  const packed = await packPackage();
  try {
    installed = await installPacked(packed.tarball, consumer);
  } finally {
    packed.dispose();
  }
  copyFileSync(join(import.meta.dirname, "fixtures/readme-app.mjs"), join(consumer, "app.js"));
}, 120_000);

afterAll(() => {
  installed?.dispose();
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
// the ones the pinned HTTP instrumentation puts on its server span
const EMITTED_PEER_KEYS = ["client.address", "network.peer.address"];

describe("the consumer package", () => {
  it("has this package as published: no sources, and beside it the dependency and the peer it imports", () => {
    expect(existsSync(join(installed.dir, "dist/register.mjs"))).toBe(true);
    expect(existsSync(join(installed.dir, "src")), "sources are not published").toBe(false);
    // presence only: offline, every link resolves to the workspace's one installed copy, so where a
    // link came from is not visible here. That an undeclared dependency fails is shown by removing
    // it from the manifest (the round-2 red run); one shared api copy is package-contents' to check
    const beside = (name: string) => existsSync(join(installed.store, "node_modules", name));
    expect(beside("@opentelemetry/api"), "the api peer is linked beside the package").toBe(true);
    expect(beside("@satoshibits/redaction"), "the declared redaction dependency is linked beside the package").toBe(
      true,
    );
  });
});

describe("the redaction control", () => {
  // what the app emits with nothing redacted, so the absences asserted below mean something
  it("exports the secret and the peer address when the preload passes redaction: false", async () => {
    writeFileSync(
      join(consumer, "unredacted.mjs"),
      'import { start } from "@satoshibits/observability/preset";\nstart({ serviceName: "control", redaction: false });\n',
    );
    await runCommand(
      "OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example.com node --import ./unredacted.mjs app.js",
    );
    expect(JSON.stringify(sink.spans())).toContain(SECRET);
    expect(peerAddresses(serverSpan())).toEqual(EMITTED_PEER_KEYS);
  });
});

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
    expect(peerAddresses(span)).toEqual(EMITTED_PEER_KEYS);
    expect(span.attributes["client.address"]).toBe("127.0.0.1");
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
