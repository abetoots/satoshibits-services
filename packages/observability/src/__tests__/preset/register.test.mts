/**
 * The register entry's failure paths: whatever made `start()` throw is reported
 * on stderr through diagnostics, and the import itself never throws. What it
 * exports, and under which policy, is asserted in a child process
 * (subprocess/signals.test.mts).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../../preset/runtime.mjs");
  vi.doUnmock("../../preset/diagnostics.mjs");
  vi.resetModules();
  vi.restoreAllMocks();
});

/** capture stderr; returns a reader of the JSON lines written so far */
function captureStderr(): () => Record<string, unknown>[] {
  const written: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  return () => written.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("register", () => {
  const FALLBACK = { level: "error", source: "opentelemetry", msg: "telemetry was not started" };
  const unreadable = (): unknown =>
    new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("SENTINEL from a proxy");
        },
      },
    );
  const startThrows = (thrown: () => unknown) => {
    vi.resetModules();
    vi.doMock("../../preset/runtime.mjs", () => ({
      start: () => {
        throw thrown();
      },
    }));
  };

  it("does not report a failed start when telemetry started and only its own line could not be written", async () => {
    vi.resetModules();
    const { standardPolicy } = await import("@satoshibits/redaction");
    const start = vi.fn(() => ({
      state: "running",
      loaderHook: false,
      signals: {
        traces: { enabled: true },
        metrics: { enabled: false, reason: "exporter-none" },
        logs: { enabled: false, reason: "not-requested" },
      },
    }));
    vi.doMock("../../preset/runtime.mjs", () => ({ start }));
    vi.doMock("../../preset/diagnostics.mjs", () => ({
      createDiagnostics: () => {
        throw new Error("SENTINEL diagnostics cannot be made");
      },
    }));
    const lines = captureStderr();

    await expect(import("../../register.mjs")).resolves.toBeDefined();

    expect(start).toHaveBeenCalledExactlyOnceWith({ redaction: standardPolicy });
    // not even the fixed fallback line: nothing failed to start
    expect(lines()).toEqual([]);
  });

  it("says so, and carries on, when what start() threw is not an error", async () => {
    startThrows(() => "SENTINEL thrown as a string");
    const lines = captureStderr();

    await expect(import("../../register.mjs")).resolves.toBeDefined();

    expect(lines().map((line) => [line.msg, line.reason])).toEqual([
      ["telemetry was not started", "start() threw a value that is not an error"],
    ]);
  });

  it("falls back to a fixed line, and carries on, when what start() threw cannot even be examined", async () => {
    startThrows(unreadable);
    const lines = captureStderr();

    await expect(import("../../register.mjs")).resolves.toBeDefined();

    expect(lines()).toEqual([FALLBACK]);
  });

  it("carries on even when that line cannot be written either", async () => {
    startThrows(unreadable);
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error("stderr is closed");
    });

    await expect(import("../../register.mjs")).resolves.toBeDefined();
    expect(write).toHaveBeenCalled();
  });

  it("reports every problem of a configuration error on a line of its own, once", async () => {
    vi.resetModules();
    const { PresetConfigError } = await import("../../preset/config.mjs");
    const long = (name: string) => `${name} ${"is wrong ".repeat(40)}`.trim();
    vi.doMock("../../preset/runtime.mjs", () => ({
      start: () => {
        throw new PresetConfigError([long("first"), long("first"), long("second"), "third"]);
      },
    }));
    const lines = captureStderr();

    await expect(import("../../register.mjs")).resolves.toBeDefined();

    // 700 characters of problems in all: one line would have cut the last ones off
    expect(lines().map((line) => [line.msg, line.reason])).toEqual([
      ["telemetry was not started", long("first")],
      ["telemetry was not started", long("second")],
      ["telemetry was not started", "third"],
    ]);
  });

  it("sanitizes the reason it reports when start() throws", async () => {
    vi.resetModules();
    vi.doMock("../../preset/runtime.mjs", () => ({
      start: () => {
        throw new Error(
          `could not reach https://user:SENTINEL-PW@collector.example/v1/traces?token=SENTINEL-Q ${"x".repeat(600)}`,
        );
      },
    }));
    const lines = captureStderr();

    await expect(import("../../register.mjs")).resolves.toBeDefined();

    expect(lines()).toHaveLength(1);
    const line = lines()[0]!;
    expect(line).toMatchObject({ level: "error", msg: "telemetry was not started" });
    // the URL is cut to scheme and host, and the text to a bounded length
    expect(line.reason).toBe(`could not reach https://collector.example ${"x".repeat(458)}…`);
  });
});
