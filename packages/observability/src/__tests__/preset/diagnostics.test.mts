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

  it.each([
    ["connect http://[::1]", "connect http://[::1]"],
    ["connect http://[::]", "connect http://[::]"],
    ["(see http://u:SENTINEL@[::1]:4318/p).", "(see http://[::1]:4318)."],
    ["at http://[2001:db8::]/p?q=SENTINEL, again", "at http://[2001:db8::], again"],
    ["[http://h.example/p]", "[http://h.example]"],
  ])("keeps the brackets and colons of an IPv6 host and still leaves punctuation: %s", (text, expected) => {
    expect(scrubUrls(text)).toBe(expected);
  });

  it.each([
    // a quote inside the URL is part of it: password, path and query
    ["failed http://u:pw'SENTINEL@h.example/p", "failed http://h.example"],
    ["failed http://h.example/private'SENTINEL?token=SENTINEL", "failed http://h.example"],
    ['failed http://h.example/p?q="SENTINEL"&r=SENTINEL done', "failed http://h.example done"],
    // a quoted URL ends at its closing quote, and the text after it is kept
    ["could not parse 'http://h.example/p?q=SENTINEL', giving up", "could not parse 'http://h.example', giving up"],
    ['url "http://u:SENTINEL@h.example/p".', 'url "http://h.example".'],
    // a quoted URL that holds the same quote: nothing of it is printed
    ["url 'http://u:pw'SENTINEL@h.example/p' failed", "url 'http://h.example' failed"],
    // a quote that opens before the URL and never closes it
    ['url "http://u:pw"SENTINEL@h.example/p failed', 'url "http://h.example failed'],
    ['url "http://h.example/a"SENTINEL?token=SENTINEL', 'url "http://h.example'],
    ["url `http://u:pw`SENTINEL@h.example/p failed", "url `http://h.example failed"],
    // angle brackets inside a URL, and around one
    ["failed http://u:pw<SENTINEL@h.example/p", "failed http://h.example"],
    ["failed http://h.example/private>SENTINEL?token=SENTINEL", "failed http://h.example"],
    ["failed http://h.example/p?q=before<SENTINEL", "failed http://h.example"],
    ["see <http://h.example/p?q=SENTINEL>.", "see <http://h.example>."],
    // a scheme glued to what precedes it
    ["x _http://u:SENTINEL@h.example/p?token=SENTINEL y", "x _http://h.example y"],
    ["x 0http://u:SENTINEL@h.example/p y", "x 0http://h.example y"],
    // (the scheme is taken to be "Fhttp"; a URL prints its scheme in lower case)
    ["x %2Fhttp://u:SENTINEL@h.example/p y", "x %2fhttp://h.example y"],
    // two URLs glued together are one token: the first host stands for both
    ["http://a.example/x,http://u:SENTINEL@b.example/y", "http://a.example"],
  ])("cuts the whole URL whatever quotes are in or around it: %s", (text, expected) => {
    expect(scrubUrls(text)).toBe(expected);
    const { events, diagnostics } = collecting();
    diagnostics.activate();
    diagnostics.report({ level: "error", message: text, fields: { detail: text } });
    expect(events).toEqual([{ level: "error", message: expected, fields: { detail: expected } }]);
  });

  it("leaves text that only looks like the start of a URL alone", () => {
    expect(scrubUrls("a :// b, ://c and 123://d")).toBe("a :// b, ://c and 123://d");
    expect(scrubUrls("no url here")).toBe("no url here");
    expect(scrubUrls("")).toBe("");
  });

  it("bounds what it sanitizes: an oversized text is cut at whitespace, never inside a URL", () => {
    const { events, diagnostics } = collecting();
    diagnostics.activate();
    const huge = `http://u:SENTINEL@h.example/${"a-".repeat(200_000)}SENTINEL`;
    diagnostics.report({ level: "error", message: `start ${huge}`, fields: { detail: huge } });
    diagnostics.report({ level: "error", message: `${"word ".repeat(4000)}${huge}` });

    // the URL began before the bound and ran past it: it is dropped whole
    expect(events[0]).toEqual({ level: "error", message: "start …", fields: { detail: " …" } });
    expect(events[1]!.message).toBe(`${"word ".repeat(100)}…`);
    expect(JSON.stringify(events)).not.toContain("SENTINEL");
  });

  it.each([
    ["trailing dots", `http://h.example/${".".repeat(15_000)}a`],
    ["no whitespace at all", "a-".repeat(8_000)],
    ["scheme characters before every marker", "ab.".repeat(2_000) + "://x ".repeat(2_000)],
  ])("stays quick on text built to make a pattern backtrack: %s", (_what, text) => {
    const started = performance.now();
    scrubUrls(text);
    // linear work on 16k characters takes well under a millisecond; a backtracking pattern took seconds
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("survives an argument that cannot be described", () => {
    const { events, diagnostics } = collecting();
    diagnostics.activate();
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("boom"); } });
    expect(() => diagnostics.diagLogger.error("m", hostile)).not.toThrow();
    diagnostics.diagLogger.error("still reporting");
    expect(events.map((e) => e.message)).toEqual(["still reporting"]);
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
