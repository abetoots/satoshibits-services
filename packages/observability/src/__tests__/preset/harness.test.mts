/**
 * The subprocess harness's own guard: which of a child's outbound sockets
 * count as a leak. Every subprocess test ends on it, so it is pinned here.
 */

import { describe, expect, it } from "vitest";

import { straySockets } from "./subprocess/harness.mjs";

describe("the harness's outbound guard", () => {
  const ports = new Set([4318, 40001]);

  it("allows loopback on a sink's port, by any of its names", () => {
    expect(
      straySockets(
        [
          { host: "127.0.0.1", port: 40001 },
          { host: "::1", port: 4318 },
          { host: "localhost", port: 4318 },
        ],
        ports,
      ),
    ).toEqual([]);
  });

  it("counts any other host as a leak, even on a sink's port, and any other port", () => {
    const leaks = [
      { host: "collector.example", port: 4318 },
      { host: "10.0.0.7", port: 40001 },
      { host: "127.0.0.1", port: 4317 },
    ];
    expect(straySockets([{ host: "127.0.0.1", port: 4318 }, ...leaks], ports)).toEqual(leaks);
  });
});
