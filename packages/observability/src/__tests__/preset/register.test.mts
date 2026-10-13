/**
 * The register entry's failure path: whatever made `start()` throw is reported
 * on stderr through diagnostics, and the import itself never throws.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../../preset/runtime.mjs");
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
