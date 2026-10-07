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
  options?: Omit<StartOptions, "diagnostics" | "testExporters">;
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
    child.on("close", (code) => {
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
      resolve({
        code,
        stdout,
        stderr,
        stderrLines,
        result: JSON.parse(line.slice("RESULT ".length)) as ChildResult,
      });
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

/** the child's outbound sockets that did not go to one of the given sinks */
export function socketsOutside(
  run: ChildRun,
  ...sinks: OtlpSink[]
): ChildResult["sockets"] {
  const ports = new Set(sinks.map((sink) => sink.port));
  const loopback = new Set(["127.0.0.1", "::1", "localhost"]);
  return run.result.sockets.filter(
    (socket) => !(ports.has(socket.port) && loopback.has(socket.host)),
  );
}

/**
 * What reached the trap since the last call, cleared as it is read so one
 * leak fails one test and not every test after it.
 */
export function drainTrap(trap: OtlpSink): OtlpSink["connections"] {
  trap.requests.length = 0;
  return trap.connections.splice(0);
}
