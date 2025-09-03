import { describe, expect, it } from "vitest";

import { createMockClient } from "../test-utils/mock-client.mjs";

describe("API Additions (Shared)", () => {
  it("logs.debug exists and records a debug log", () => {
    const client = createMockClient();
    client.logs.debug("Debug message", { feature: "test" });
    const logs = client.getLogs();
    const debug = logs.find(
      (l) => l.level === "debug" && l.message === "Debug message",
    );
    expect(debug).toBeTruthy();
    expect(debug?.attributes?.feature).toBe("test");
  });

  it("context.getTraceId() is available and returns a string", () => {
    const client = createMockClient();
    const id = client.context.getTraceId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});
