/**
 * Runs the preset in a fresh node process and reports what it did.
 *
 * OpenTelemetry registers providers, a context manager and module hooks on
 * process globals, so only a new process gives an honest start. The child is
 * plain `node` running an esbuild bundle of the fixture and the library
 * SOURCE; dependencies stay external and are loaded by node itself, which is
 * how a consumer's build treats them.
 *
 * Every test in this project also holds a "trap": a sink on the
 * specification's default port, 4318, on both loopback families. Anything
 * that arrives there was sent to an address nobody configured.
 */

import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DiagnosticsEvent } from "../../../preset/diagnostics.mjs";
import type { PresetStatus, StartOptions } from "../../../preset.mjs";
import type { OtlpSink } from "../../../testing/otlp-sink.mjs";

import { startOtlpSink } from "../../../testing/otlp-sink.mjs";

/** What the child is asked to do; see fixtures/preset-child.mts */
export interface ChildScenario {
  /** `start` calls start(options) (default); `register` imports the register entry; `none` does neither */
  start?: "start" | "register" | "none";
  /** merged over `{ instrumentations: false }` */
  options?: Omit<StartOptions, "diagnostics" | "testExporters" | "redaction">;
  /**
   * The `redaction` option the child passes to start(). A policy is a set of
   * functions and cannot travel in this JSON, so it is named: `false` (the
   * default: export as given), `probe` (the child builds the probe policy),
   * or `none` (the option is left out, to meet the no-policy rule).
   * The register entry takes no options; this is ignored for it.
   */
  redaction?: "probe" | false | "none";
  /** collect diagnostics events into the result; `throwing` also makes the sink throw */
  collectDiagnostics?: boolean | "throwing";
  /** scope name for the tracer, meter and logger (default `preset-child`) */
  scopeName?: string;
  /** scope attributes for the logger (the only scope the API lets carry attributes) */
  scopeAttributes?: Record<string, string>;
  /** number of root spans to create (default 1) */
  spans?: number;
  spanName?: string;
  /** add 1 to a counter (default true) */
  metric?: boolean;
  /** emit one log record through the logs API (default true) */
  log?: boolean;
  /** flush, then create this many more spans */
  afterDrainSpans?: number;
  /** stay alive this long before finishing */
  lingerMillis?: number;
  /** how to finish (default `shutdown`) */
  finish?: "shutdown" | "forceFlush" | "none";
  /** timeout passed to shutdown / forceFlush */
  timeoutMillis?: number;
  /** `natural` lets the event loop empty instead of calling process.exit */
  exit?: "forced" | "natural";
}

export interface ChildResult {
  status: PresetStatus;
  startError: string | null;
  finishError: string | null;
  finishMillis: number;
  spans: { traceId: string; valid: boolean; sampled: boolean }[];
  /** every outbound socket the child opened */
  sockets: { host: string; port: number }[];
  diagnostics: DiagnosticsEvent[];
  sinkFactoryCalledAfterSdkStarted: boolean | null;
  /** `OTEL_LOG_LEVEL` as the child sees it after start() returned */
  logLevelAfterStart: string | null;
  /** whether the endpoint variables read the same once start() has returned as before it */
  endpointVariablesRestored: boolean;
}

export interface ChildRun {
  code: number | null;
  stdout: string;
  stderr: string;
  /** JSON lines the child wrote to stderr (the default diagnostics sink) */
  stderrLines: Record<string, unknown>[];
  result: ChildResult;
}

const FIXTURE = fileURLToPath(
  new URL("./fixtures/preset-child.mts", import.meta.url),
);
const PACKAGE_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

// inside the package's node_modules so the bundle resolves the package's own dependencies
const BUNDLE = join(
  PACKAGE_ROOT,
  "node_modules/.cache/obs-preset-child/preset-child.mjs",
);

let bundlePromise: Promise<string> | undefined;

function bundleFixture(): Promise<string> {
  bundlePromise ??= build({
    entryPoints: [FIXTURE],
    outfile: BUNDLE,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    target: "node20",
    logLevel: "silent",
  }).then(() => BUNDLE);
  return bundlePromise;
}

/** telemetry variables must never leak from the test runner into a child */
const SCRUBBED_ENV_PREFIXES = ["OTEL_", "OBS_", "VITEST"];
/** settings of the developer's shell that would add output or sockets to the child */
const SCRUBBED_ENV_NAMES = new Set([
  "NODE_OPTIONS",
  "NODE_USE_ENV_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
]);

/** a child that has printed nothing by then is killed and the run rejected */
const CHILD_DEADLINE_MILLIS = 20_000;

/** every run since the last call, for a check shared by all tests of a file */
const recentRuns: ChildRun[] = [];
export function takeRecentRuns(): ChildRun[] {
  return recentRuns.splice(0);
}

/**
 * Run the fixture. `env` is the ONLY telemetry-related environment the child
 * sees. Rejects when the child prints no result (it crashed), with its stderr.
 */
export async function runChild(
  scenario: ChildScenario,
  env: Record<string, string> = {},
): Promise<ChildRun> {
  const bundle = await bundleFixture();

  const childEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SCRUBBED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
    if (SCRUBBED_ENV_NAMES.has(key)) continue;
    childEnv[key] = value;
  }
  Object.assign(childEnv, env, {
    OBS_CHILD_SCENARIO: JSON.stringify(scenario),
  });

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bundle], {
      cwd: PACKAGE_ROOT,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    let killed = false;
    const deadline = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, CHILD_DEADLINE_MILLIS);
    child.on("close", (code) => {
      clearTimeout(deadline);
      if (killed) {
        // a child that printed its result and then hung is still a failure
        reject(
          new Error(
            `child did not exit within ${CHILD_DEADLINE_MILLIS} ms and was killed\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
        return;
      }
      const line = stdout.split("\n").find((l) => l.startsWith("RESULT "));
      if (!line) {
        reject(
          new Error(
            `child exited with code ${code} and no result\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
        return;
      }
      const stderrLines: Record<string, unknown>[] = [];
      for (const text of stderr.split("\n")) {
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed !== null && typeof parsed === "object") {
            stderrLines.push(parsed as Record<string, unknown>);
          }
        } catch {
          // not a diagnostics line
        }
      }
      const run: ChildRun = {
        code,
        stdout,
        stderr,
        stderrLines,
        result: JSON.parse(line.slice("RESULT ".length)) as ChildResult,
      };
      recentRuns.push(run);
      resolve(run);
    });
  });
}

export const DEFAULT_OTLP_PORT = 4318;

/**
 * Bind the specification's default OTLP port on IPv4 and IPv6 loopback.
 * Rejects (so the test fails, never skips) when either cannot be bound.
 */
export function startDefaultAddressTrap(): Promise<OtlpSink> {
  return startOtlpSink({ port: DEFAULT_OTLP_PORT, hosts: ["127.0.0.1", "::1"] });
}

/** where a sink listens; a socket to one of its ports on any other host is still a leak */
const LOOPBACK: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "localhost"]);

/** the sockets that went anywhere but loopback on one of `ports` */
export function straySockets(
  sockets: ChildResult["sockets"],
  ports: ReadonlySet<number>,
): ChildResult["sockets"] {
  return sockets.filter((socket) => !(ports.has(socket.port) && LOOPBACK.has(socket.host)));
}

/** the child's outbound sockets that did not go to one of the given sinks */
export function socketsOutside(
  run: ChildRun,
  ...sinks: OtlpSink[]
): ChildResult["sockets"] {
  const ports = new Set(sinks.map((sink) => sink.port));
  return straySockets(run.result.sockets, ports);
}

/**
 * The outbound sockets of every child run since the last call that went
 * anywhere but loopback on one of `allowedPorts` (the ports of every sink a
 * test started, closed ones included). Call it from `afterEach`.
 */
export function strayRecentSockets(allowedPorts: ReadonlySet<number>): ChildResult["sockets"] {
  return takeRecentRuns().flatMap((run) => straySockets(run.result.sockets, allowedPorts));
}

/**
 * What reached the trap since the last call, cleared as it is read so one
 * leak fails one test and not every test after it.
 */
export function drainTrap(trap: OtlpSink): OtlpSink["connections"] {
  trap.requests.length = 0;
  return trap.connections.splice(0);
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

/**
 * The sinks every subprocess test file uses, with the checks every test ends on:
 * nothing reached the default address, and no child opened a socket to a port
 * that is not one of the test's sinks.
 *
 * Register it once at the top of a file, before the file's own hooks.
 */
export function useSinks(): {
  /** the sink on localhost:4318, for the whole file */
  readonly trap: OtlpSink;
  /** a fresh sink on an ephemeral port, per test */
  readonly sink: OtlpSink;
  /** another sink for this test; closed with it */
  extra: () => Promise<OtlpSink>;
} {
  let trap: OtlpSink | undefined;
  let sink: OtlpSink | undefined;
  let extras: OtlpSink[] = [];
  let ports = new Set<number>();

  const open = async (): Promise<OtlpSink> => {
    const opened = await startOtlpSink();
    ports.add(opened.port);
    return opened;
  };

  beforeAll(async () => {
    trap = await startDefaultAddressTrap();
  });
  afterAll(async () => {
    await settle();
    const late = trap ? drainTrap(trap) : [];
    await trap?.close();
    expect(late, "connections to localhost:4318 after the last test").toEqual([]);
  });
  beforeEach(async () => {
    takeRecentRuns();
    ports = new Set([DEFAULT_OTLP_PORT]);
    extras = [];
    sink = await open();
  });
  afterEach(async () => {
    // a connection made just before a child exited may not have been accepted yet
    await settle();
    const reachedTrap = trap ? drainTrap(trap) : [];
    const stray = strayRecentSockets(ports);
    const unreadable = [trap, sink, ...extras].flatMap((s) => s?.undecodable.splice(0) ?? []);
    await Promise.all([sink, ...extras].map((s) => s?.close().catch(() => undefined)));
    expect(reachedTrap, "connections to localhost:4318").toEqual([]);
    expect(stray, "sockets to a port that is not one of the test's sinks").toEqual([]);
    expect(unreadable, "requests a sink could not decode").toEqual([]);
  });

  return {
    get trap() {
      return trap!;
    },
    get sink() {
      return sink!;
    },
    extra: async () => {
      const opened = await open();
      extras.push(opened);
      return opened;
    },
  };
}
