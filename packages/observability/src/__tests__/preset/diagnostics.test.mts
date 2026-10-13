import { inspect } from "node:util";

import { DiagLogLevel } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";

import type { DiagnosticsEvent } from "../../preset/diagnostics.mjs";

import {
  createDiagnostics,
  createRateLimiter,
  scrubUrls,
  shown,
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

  it("leaves the punctuation after a URL in place", () => {
    const { events, diagnostics } = collecting();
    diagnostics.activate();
    diagnostics.diagLogger.warn(
      "failed at http://u:SENTINEL@h.example/p?q=SENTINEL, retrying (see https://docs.example/x). Done",
    );
    expect(events[0]!.message).toBe(
      "failed at http://h.example, retrying (see https://docs.example). Done",
    );
  });

  it("keeps the bracket that closes an IPv6 host, and still leaves sentence punctuation", () => {
    expect(scrubUrls("connect http://[::1]")).toBe("connect http://[::1]");
    expect(scrubUrls("(see http://u:SENTINEL@[::1]:4318/p).")).toBe("(see http://[::1]:4318).");
    expect(scrubUrls("[http://h.example/p]")).toBe("[http://h.example]");
  });

  it("sanitizes the whole text before cutting it: a long user-info never passes for a host", () => {
    const { events, diagnostics } = collecting();
    diagnostics.activate();
    const url = `http://${"u".repeat(600)}:SENTINEL-PW@collector.example/path`;
    diagnostics.diagLogger.error(`failed ${url}`, new Error(`again ${url}`));
    diagnostics.report({ level: "error", message: "m", fields: { detail: `at ${url}` } });

    expect(events[0]!.message).toBe(
      "failed http://collector.example Error: again http://collector.example",
    );
    expect(events[1]!.fields).toEqual({ detail: "at http://collector.example" });
  });

  it("cuts what is left to a bounded length", () => {
    const { events, diagnostics } = collecting();
    diagnostics.activate();
    diagnostics.report({ level: "error", message: "m".repeat(501), fields: { detail: "d".repeat(501) } });
    expect(events[0]!.message).toBe(`${"m".repeat(500)}…`);
    expect(events[0]!.fields).toEqual({ detail: `${"d".repeat(500)}…` });
  });

  it("never prints the value of a telemetry variable, however the SDK quotes it", () => {
    const events: DiagnosticsEvent[] = [];
    const header = " Basic SENTINEL-HEADER-VALUE ";
    const quoted = `SENTINEL "it's"\nmultiline`;
    const diagnostics = createDiagnostics({
      sinkFactory: () => (event) => events.push(event),
      environment: {
        OTEL_EXPORTER_OTLP_TIMEOUT: header,
        OTEL_EXPORTER_OTLP_COMPRESSION: quoted,
        OBS_SOMETHING: "SENTINEL-OBS value",
        OTEL_EXPORTER_OTLP_PROTOCOL: "http/jsonn",
        UNRELATED: "an unrelated value",
      },
    });
    diagnostics.activate();
    // the three shapes the SDK uses: inspected, trimmed in quotes, and as an argument
    diagnostics.diagLogger.warn(
      `Unknown value ${inspect(header)} for OTEL_EXPORTER_OTLP_TIMEOUT, expected a number, using defaults`,
    );
    diagnostics.diagLogger.warn(
      `Configuration: OTEL_EXPORTER_OTLP_TIMEOUT is invalid (actual: '${header.trim()}')`,
    );
    diagnostics.diagLogger.warn(`Unknown value ${inspect(quoted)} for X`, new Error(quoted));
    diagnostics.report({ level: "warn", message: "m", fields: { detail: "SENTINEL-OBS value" } });
    diagnostics.diagLogger.warn("protocol 'http/jsonn' and an unrelated value are left alone");

    expect(JSON.stringify(events)).not.toContain("SENTINEL");
    expect(events.map((e) => e.message)).toEqual([
      "Unknown value '(a value that is not shown)' for OTEL_EXPORTER_OTLP_TIMEOUT, expected a number, using defaults",
      "Configuration: OTEL_EXPORTER_OTLP_TIMEOUT is invalid (actual: '(a value that is not shown)')",
      expect.stringMatching(/^Unknown value .\(a value that is not shown\). for X Error: \(a value that is not shown\)$/),
      "m",
      "protocol 'http/jsonn' and an unrelated value are left alone",
    ]);
    expect(events[3]!.fields).toEqual({ detail: "(a value that is not shown)" });
  });

  it("quotes a setting's value only when it is a plain token of at most 24 characters", () => {
    expect(shown("parentbased_traceidratio")).toBe('"parentbased_traceidratio"');
    expect(shown("a".repeat(24))).toBe(`"${"a".repeat(24)}"`);
    expect(shown("a".repeat(25))).toBe("(a value that is not shown)");
    expect(shown("")).toBe("(a value that is not shown)");
    expect(shown("has space")).toBe("(a value that is not shown)");
    expect(shown("a:b")).toBe("(a value that is not shown)");
    expect(shown(0.5)).toBe("0.5");
    expect(shown(Number.NaN)).toBe("(a value that is not shown)");
    expect(shown({})).toBe("(a value that is not shown)");
  });

  it("describes a message that is not a string by its shape, like any argument", () => {
    const { events, diagnostics } = collecting();
    diagnostics.activate();
    diagnostics.diagLogger.error({ secret: "SENTINEL" } as never);
    diagnostics.diagLogger.error(new TypeError("bad") as never);
    expect(events.map((e) => e.message)).toEqual(["{secret}", "TypeError: bad"]);
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
