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

describe("register", () => {
  it("sanitizes the reason it reports when start() throws", async () => {
    vi.resetModules();
    vi.doMock("../../preset/runtime.mjs", () => ({
      start: () => {
        throw new Error(
          `could not reach https://user:SENTINEL-PW@collector.example/v1/traces?token=SENTINEL-Q ${"x".repeat(600)}`,
        );
      },
    }));
    const written: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });

    await expect(import("../../register.mjs")).resolves.toBeDefined();

    expect(written).toHaveLength(1);
    const line = JSON.parse(written[0]!) as Record<string, unknown>;
    expect(line).toMatchObject({ level: "error", msg: "telemetry was not started" });
    // the URL is cut to scheme and host, and the text to a bounded length
    expect(line.reason).toBe(`could not reach https://collector.example ${"x".repeat(458)}…`);
  });
});
