import { DiagLogLevel } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";

import type { DiagnosticsEvent } from "../../preset/diagnostics.mjs";

import {
  createDiagnostics,
  createRateLimiter,
  stderrSink,
} from "../../preset/diagnostics.mjs";

function collecting(logLevel?: string) {
  const events: DiagnosticsEvent[] = [];
  const sinkFactory = vi.fn(() => (event: DiagnosticsEvent) => {
    events.push(event);
  });
  return { events, sinkFactory, diagnostics: createDiagnostics({ logLevel, sinkFactory }) };
}

describe("diagnostics", () => {
  it("does not call the sink factory before activation, then delivers what was held, in order", () => {
    const { events, sinkFactory, diagnostics } = collecting();
    diagnostics.report({ level: "warn", message: "first" });
    diagnostics.diagLogger.error("second");
    expect(sinkFactory).not.toHaveBeenCalled();

    diagnostics.activate();

    expect(sinkFactory).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.message)).toEqual(["first", "second"]);

    diagnostics.report({ level: "error", message: "third" });
    expect(sinkFactory).toHaveBeenCalledTimes(1);
    expect(events.map((e) => e.message)).toEqual(["first", "second", "third"]);
  });

  it("reports warnings and errors by default and drops quieter events", () => {
    const { events, diagnostics } = collecting();
    diagnostics.activate();
    diagnostics.diagLogger.error("e");
    diagnostics.diagLogger.warn("w");
    diagnostics.diagLogger.info("i");
    diagnostics.diagLogger.debug("d");
    expect(events.map((e) => e.level)).toEqual(["error", "warn"]);
    expect(diagnostics.diagLevel).toBe(DiagLogLevel.WARN);
  });

  it.each([
    ["debug", DiagLogLevel.DEBUG, ["error", "warn", "info", "debug"]],
    ["ERROR", DiagLogLevel.ERROR, ["error"]],
    ["none", DiagLogLevel.NONE, []],
    ["nonsense", DiagLogLevel.WARN, ["error", "warn"]],
  ])("OTEL_LOG_LEVEL=%s changes only the level", (logLevel, apiLevel, levels) => {
    const { events, diagnostics } = collecting(logLevel);
    diagnostics.activate();
    diagnostics.diagLogger.error("e");
    diagnostics.diagLogger.warn("w");
    diagnostics.diagLogger.info("i");
    diagnostics.diagLogger.debug("d");
    expect(diagnostics.diagLevel).toBe(apiLevel);
    expect(events.map((e) => e.level)).toEqual(levels);
  });

  it("describes the API's extra arguments by shape, never by content", () => {
    const { events, diagnostics } = collecting();
    diagnostics.activate();
    const batch = [{ attributes: { api_key: "SENTINEL-IN-BATCH" } }];
    const resource = { _rawAttributes: [["api_key", "SENTINEL-IN-RESOURCE"]], pending: false };
    diagnostics.diagLogger.error(
      "export failed",
      new TypeError("fetch failed"),
      resource,
      batch,
      42,
      null,
      "x".repeat(2000),
    );
    const message = events[0]!.message;
    expect(message).toContain(
      "export failed TypeError: fetch failed {_rawAttributes, pending} [array of 1] 42 null xxx",
    );
    expect(message).not.toContain("SENTINEL");
    expect(message.length).toBeLessThan(700);
  });

  it("cuts URLs down to scheme and host, in messages, arguments and fields", () => {
    const { events, diagnostics } = collecting();
    diagnostics.activate();
    const url = "https://user:SENTINEL-PW@collector.example:4318/otlp/v1/traces?token=SENTINEL-Q";
    diagnostics.diagLogger.warn(`could not parse '${url}'`, new Error(`connect failed for ${url}`));
    diagnostics.report({ level: "error", message: "m", fields: { detail: `at ${url}`, status: 401 } });

    expect(events[0]!.message).toBe(
      "could not parse 'https://collector.example:4318' Error: connect failed for https://collector.example:4318",
    );
    expect(events[1]!.fields).toEqual({ detail: "at https://collector.example:4318", status: 401 });
    expect(JSON.stringify(events)).not.toContain("SENTINEL");
  });

  it("applies the redaction it is given to every message and text field", () => {
    const events: DiagnosticsEvent[] = [];
    const diagnostics = createDiagnostics({
      sinkFactory: () => (event) => events.push(event),
      redactText: (text) => text.replaceAll("alice@example.com", "a***@example.com"),
    });
    diagnostics.activate();
    diagnostics.diagLogger.error("failed for alice@example.com");
    diagnostics.report({ level: "warn", message: "m", fields: { detail: "alice@example.com" } });
    expect(JSON.stringify(events)).not.toContain("alice@");
    expect(events[0]!.message).toBe("failed for a***@example.com");
  });

  it("sanitizes events that were held before activation too", () => {
    const { events, diagnostics } = collecting();
    diagnostics.diagLogger.warn("early http://u:SENTINEL@h:1/p");
    diagnostics.activate();
    expect(events[0]!.message).toBe("early http://h:1");
  });

  it("survives a sink that throws, and keeps reporting to it", () => {
    const sink = vi.fn(() => {
      throw new Error("sink is broken");
    });
    const diagnostics = createDiagnostics({ sinkFactory: () => sink });
    diagnostics.activate();
    expect(() => diagnostics.report({ level: "error", message: "a" })).not.toThrow();
    expect(() => diagnostics.diagLogger.warn("b")).not.toThrow();
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it("falls back to stderr when the sink factory throws", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const diagnostics = createDiagnostics({
      sinkFactory: () => {
        throw new Error("no logger");
      },
    });
    diagnostics.activate();
    diagnostics.report({ level: "warn", message: "still visible" });
    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]![0])).toContain("still visible");
  });

  it("holds a bounded number of events before activation", () => {
    const { events, diagnostics } = collecting();
    for (let i = 0; i < 250; i++) {
      diagnostics.report({ level: "warn", message: `m${i}` });
    }
    diagnostics.activate();
    expect(events).toHaveLength(100);
    expect(events[0]!.message).toBe("m0");
  });

  it("the default sink writes one JSON line with level, source, message and fields", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    stderrSink({ level: "warn", message: "signal off", fields: { signal: "traces" } });
    const line = String(write.mock.calls[0]![0]);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(line)).toMatchObject({
      level: "warn",
      source: "opentelemetry",
      msg: "signal off",
      signal: "traces",
    });
    expect(Number.isNaN(Date.parse((JSON.parse(line) as { time: string }).time))).toBe(false);
  });
});

describe("rate limiter", () => {
  it("lets the first through, counts the rest, and reports the count on the next one", () => {
    let now = 1_000;
    const limit = createRateLimiter(60_000, () => now);
    const seen: number[] = [];
    const emit = (suppressed: number) => seen.push(suppressed);

    limit(emit);
    limit(emit);
    limit(emit);
    expect(seen).toEqual([0]);

    now += 59_999;
    limit(emit);
    expect(seen).toEqual([0]);

    now += 1;
    limit(emit);
    expect(seen).toEqual([0, 3]);

    now += 60_000;
    limit(emit);
    expect(seen).toEqual([0, 3, 0]);
  });
});
