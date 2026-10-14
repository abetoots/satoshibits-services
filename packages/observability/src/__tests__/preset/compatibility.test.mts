/**
 * COMPATIBILITY.md, checked. Every root export has a row and every row is a
 * root export (or says `removed`); every root export row is checked here by a
 * test of its own name; every facade row names a test that exists.
 */

import { metrics, SpanKind as ApiSpanKind, SpanStatusCode as ApiSpanStatusCode, trace } from "@opentelemetry/api";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// reads exports through the TypeScript compiler API in JavaScript, which TypeScript 7 (the native port) may not provide
import { createProgram, ModuleKind, ModuleResolutionKind, ScriptTarget, SymbolFlags } from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ApplicationContext,
  Meter,
  SanitizerOptions,
  SmartContext,
  SmartSamplerConfig,
  Span,
  Tracer,
} from "../../index.mjs";

import * as root from "../../index.mjs";
import { resetForTesting } from "../../preset/runtime.mjs";
import { startTestTelemetry } from "../../testing/in-memory.mjs";

const PACKAGE = path.join(import.meta.dirname, "../../..");
const DOC = readFileSync(path.join(PACKAGE, "COMPATIBILITY.md"), "utf8");
const ROOT_ENTRY = path.join(PACKAGE, "src/index.mts");

afterEach(async () => {
  await Promise.resolve()
    .then(() => root.SmartClient.shutdown())
    .catch(() => undefined);
  await resetForTesting();
  root.clearContext();
  root.clearSanitizationCache();
});

/** the lines of the table between `<!-- name:start -->` and `<!-- name:end -->`, as cells, header first */
function tableLines(name: string): string[][] {
  const from = DOC.indexOf(`<!-- ${name}:start -->`);
  const to = DOC.indexOf(`<!-- ${name}:end -->`);
  if (from === -1 || to <= from) throw new Error(`COMPATIBILITY.md has no ${name} table`);
  return DOC.slice(from, to)
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) =>
      // no cell holds a pipe
      line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim()),
    );
}

/** the rows of a table, as cells (the header and its rule left out) */
const tableRows = (name: string): string[][] => tableLines(name).slice(2);

/** the rows of a table, each cell by its column's header */
function tableRecords(name: string): Record<string, string>[] {
  const [header, , ...rows] = tableLines(name);
  return rows.map((cells) => Object.fromEntries(header!.map((column, i) => [column, cells[i] ?? ""])));
}

const TABLES = ["root-exports", "signature-types", "facade-behaviour", "removed-exports"] as const;

/** the 1.x export list, pinned from the code at 6f3dbab (see the fixture's `source`) */
const EXPORTS_1X = (
  JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures/root-exports-1x.json"), "utf8")) as {
    names: string[];
  }
).names;

const unquote = (cell: string) => cell.replace(/^`|`$/g, "");

/** what the root entry exports, by name and kind, read from the code */
function rootExports(): Map<string, "value" | "type"> {
  return exportsOf(ROOT_ENTRY);
}

const exportsCache = new Map<string, Map<string, "value" | "type">>();

/** what an entry module exports, by name and kind, read from the code */
function exportsOf(entry: string): Map<string, "value" | "type"> {
  const cached = exportsCache.get(entry);
  if (cached) return cached;
  const program = createProgram([entry], {
    module: ModuleKind.NodeNext,
    moduleResolution: ModuleResolutionKind.NodeNext,
    target: ScriptTarget.ES2022,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  const module = source && checker.getSymbolAtLocation(source);
  if (!module) throw new Error(`the entry ${entry} could not be read as a module`);
  const found = new Map<string, "value" | "type">();
  for (const symbol of checker.getExportsOfModule(module)) {
    const target = symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    found.set(symbol.name, target.flags & SymbolFlags.Value ? "value" : "type");
  }
  exportsCache.set(entry, found);
  return found;
}

const ROWS = tableRows("root-exports").map(([name, kind, status]) => ({
  name: unquote(name!),
  kind: kind!,
  status: status!,
}));

/**
 * the business context lives in the OTel context, which needs a context manager: in 1.x and now,
 * the one initialize registers (here in test mode, which exports nothing)
 */
async function withContextManager(): Promise<void> {
  await root.SmartClient.initialize({
    environment: "node",
    serviceName: "compat",
    disableInstrumentation: true,
    testSpanProcessor: NOOP_PROCESSOR,
  });
}

const NOOP_PROCESSOR = {
  onStart: () => undefined,
  onEnd: () => undefined,
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};

const SAMPLER_CONFIG: SmartSamplerConfig = { baseRate: 0.25 };

/** one check per root export: it resolves, and does what it did in 1.x */
const CHECKS: Record<string, () => void | Promise<void>> = {
  // types: each is used as 1.x consumers use it; a missing or reshaped type fails to compile
  ApplicationContext: () => {
    const value: Partial<ApplicationContext> = { userId: "u-1" };
    expect(value.userId).toBe("u-1");
  },
  Meter: () => {
    const meter: Meter = metrics.getMeter("compat");
    expect(typeof meter.createCounter).toBe("function");
  },
  SanitizerOptions: () => {
    const options: SanitizerOptions = { maskEmails: true, redactionString: "[X]" };
    expect(new root.SanitizerManager(options).getDefault().sanitize("password: hunter2")).toBe("password: [X]");
  },
  SmartContext: async () => {
    await withContextManager();
    const value: SmartContext = { tenantId: "t-1" };
    expect(root.runWithBusinessContext(value, () => root.getSmartContext())).toEqual(value);
  },
  SmartSamplerConfig: () => {
    expect(String(new root.SmartSampler(SAMPLER_CONFIG))).toBe("SmartSampler{baseRate=0.25}");
  },
  Span: () => {
    const span: Span = trace.getTracer("compat").startSpan("compat");
    span.end();
    expect(span.isRecording()).toBe(false);
  },
  Tracer: () => {
    const tracer: Tracer = trace.getTracer("compat");
    expect(typeof tracer.startActiveSpan).toBe("function");
  },

  // values
  ContextEnricher: () => {
    const enricher = new root.ContextEnricher();
    enricher.addTag("region", "eu");
    expect(enricher.getContext().tags).toEqual({ region: "eu" });
  },
  SanitizerManager: () => {
    const manager = new root.SanitizerManager({ maskEmails: true }, {
      tenantConfigProvider: (ctx) => (ctx.tenantId === "strict" ? { maskIPs: true } : undefined),
    });
    expect(manager.getDefault().sanitize("mail jane@example.com")).toBe("mail j***@example.com");
    expect(manager.getSanitizer({ tenantId: "strict" }).sanitize("from 10.1.2.3")).toBe("from ***.***.***");
    expect(manager.getSanitizer()).toBe(manager.getDefault());
  },
  SanitizerPresets: () => {
    expect(root.SanitizerPresets.gdpr()).toMatchObject({ maskEmails: true, maskIPs: true, strictMode: true });
    expect(root.SanitizerPresets.minimal()).toMatchObject({ maskEmails: false, strictMode: false });
  },
  SmartClient: () => {
    expect(root.SmartClient.initialize).toBe(root.initializeObservability);
    expect(root.SmartClient.shutdown).toBe(root.shutdownObservability);
    expect(typeof root.SmartClient.create).toBe("function");
  },
  SmartSampler: () => {
    const sampler = new root.SmartSampler({ baseRate: 0.5 });
    expect(sampler.toString()).toBe("SmartSampler{baseRate=0.5}");
    expect(typeof sampler.shouldSample).toBe("function");
  },
  SpanKind: () => expect(root.SpanKind).toBe(ApiSpanKind),
  SpanStatusCode: () => expect(root.SpanStatusCode).toBe(ApiSpanStatusCode),
  UnifiedObservabilityClient: async () => {
    const client = await root.SmartClient.initialize({
      environment: "node",
      serviceName: "compat",
      disableInstrumentation: true,
      testSpanProcessor: NOOP_PROCESSOR,
    });
    expect(client).toBeInstanceOf(root.UnifiedObservabilityClient);
    expect(await client.traces.withSpan("compat", () => Promise.resolve(42))).toBe(42);
  },
  addBreadcrumb: () => {
    root.addBreadcrumb({ message: "clicked", category: "action", level: "info" });
    expect(root.getGlobalContext().getErrorContext().breadcrumbs.map((b) => b.message)).toContain("clicked");
  },
  addTag: () => {
    root.addTag("tier", "gold");
    expect(root.getGlobalContext().getContext().tags).toMatchObject({ tier: "gold" });
  },
  categorizeErrorForObservability: () => {
    const timeout = Object.assign(new Error("request timed out"), { name: "TimeoutError" });
    expect(root.categorizeErrorForObservability(timeout)).toBe("timeout");
  },
  clearContext: () => {
    root.addTag("gone", "soon");
    root.clearContext();
    expect(root.getGlobalContext().getContext().tags ?? {}).toEqual({});
  },
  clearSanitizationCache: () => {
    root.sanitizeString("cached value");
    expect(root.getCacheStats().size).toBeGreaterThan(0);
    root.clearSanitizationCache();
    expect(root.getCacheStats().size).toBe(0);
  },
  createSmartCounter: async () => {
    const telemetry = startTestTelemetry({ serviceName: "compat" });
    const counter = root.createSmartCounter("compat_counter", metrics.getMeter("compat"));
    counter.increment(2, { route: "/a" });
    expect(await telemetry.metricPoints("compat_counter")).toEqual([
      { attributes: expect.objectContaining({ route: "/a" }) as unknown, value: 2 },
    ]);
  },
  createSmartGauge: async () => {
    const telemetry = startTestTelemetry({ serviceName: "compat" });
    const gauge = root.createSmartGauge("compat_gauge", metrics.getMeter("compat"));
    gauge.set(17, { pool: "db" });
    expect(await telemetry.metricPoints("compat_gauge")).toEqual([
      { attributes: expect.objectContaining({ pool: "db" }) as unknown, value: 17 },
    ]);
  },
  createSmartHistogram: async () => {
    const telemetry = startTestTelemetry({ serviceName: "compat" });
    const histogram = root.createSmartHistogram("compat_histogram", metrics.getMeter("compat"));
    histogram.record(40);
    histogram.record(60);
    const [point] = await telemetry.metricPoints("compat_histogram");
    expect(point?.value).toMatchObject({ count: 2, sum: 100, min: 40, max: 60 });
  },
  createSmartSampler: () => {
    expect(root.createSmartSampler({ baseRate: 0.1 })).toBeInstanceOf(root.SmartSampler);
  },
  createSmartUpDownCounter: async () => {
    const telemetry = startTestTelemetry({ serviceName: "compat" });
    const counter = root.createSmartUpDownCounter("compat_updown", metrics.getMeter("compat"));
    counter.add(5);
    counter.add(-2);
    expect((await telemetry.metricPoints("compat_updown")).map((point) => point.value)).toEqual([3]);
  },
  extractResultError: () => {
    const error = new Error("no");
    expect(root.extractResultError({ success: false, error })).toBe(error);
    expect(root.extractResultError({ success: true, value: 1, error: null })).toBeNull();
  },
  extractResultValue: () => {
    expect(root.extractResultValue({ success: true, value: 7, error: null })).toBe(7);
  },
  getAllInstances: async () => {
    const client = await root.SmartClient.initialize({ environment: "node", serviceName: "compat", skipSdkInitialization: true });
    expect(root.getAllInstances()).toContain(client);
  },
  getCacheStats: () => {
    const before = root.getCacheStats().size;
    root.sanitizeString("a string not seen before");
    expect(root.getCacheStats().size).toBe(before + 1);
    expect(root.getCacheStats()).toEqual({
      size: expect.any(Number) as number,
      max: expect.any(Number) as number,
      ttl: expect.any(Number) as number,
    });
  },
  getEnrichedLabels: async () => {
    await withContextManager();
    const labels = root.runWithBusinessContext({ tenantId: "t-9" }, () => root.getEnrichedLabels({ extra: "1" }));
    expect(labels).toMatchObject({ tenant_id: "t-9", extra: "1" });
  },
  getGlobalContext: () => {
    expect(root.getGlobalContext()).toBeInstanceOf(root.ContextEnricher);
  },
  getInstanceCount: async () => {
    const before = root.getInstanceCount();
    await root.SmartClient.initialize({ environment: "node", serviceName: "compat", skipSdkInitialization: true });
    expect(root.getInstanceCount()).toBe(before + 1);
  },
  getResultAdapter: () => {
    expect(root.getResultAdapter("not a result")).toBeNull();
    expect(root.getResultAdapter({ _tag: "Right", right: 3 })?.isSuccess()).toBe(true);
  },
  getSmartContext: async () => {
    await withContextManager();
    expect(root.getSmartContext()).toEqual({});
    expect(root.runWithBusinessContext({ userId: "u" }, () => root.getSmartContext())).toEqual({ userId: "u" });
  },
  getUnifiedClientInstance: async () => {
    expect(root.getUnifiedClientInstance()).toBeNull();
    const client = await root.SmartClient.initialize({ environment: "node", serviceName: "compat", skipSdkInitialization: true });
    expect(root.getUnifiedClientInstance()).toBe(client);
  },
  initializeObservability: async () => {
    const warn = vi.spyOn(console, "warn");
    const config = { environment: "node", serviceName: "compat", skipSdkInitialization: true } as const;
    const first = await root.initializeObservability(config);
    expect(await root.initializeObservability(config)).toBe(first);
    expect(warn).toHaveBeenCalledWith("Observability client already initialized");
  },
  isResultFailure: () => {
    expect(root.isResultFailure({ success: false, error: new Error("x") })).toBe(true);
    expect(root.isResultFailure({ success: true, value: 1, error: null })).toBe(false);
  },
  isResultLike: () => {
    expect(root.isResultLike({ success: true, value: 1, error: null })).toBe(true);
    // a result is told by an error member as well as a success flag
    expect(root.isResultLike({ success: true, data: 1 })).toBe(false);
    expect(root.isResultLike(42)).toBe(false);
  },
  isResultSuccess: () => {
    expect(root.isResultSuccess({ success: true, value: 1, error: null })).toBe(true);
  },
  mergeBusinessContext: async () => {
    await withContextManager();
    const merged = root.runWithBusinessContext({ userId: "u" }, () => root.mergeBusinessContext({ tenantId: "t" }));
    expect(merged).toEqual({ userId: "u", tenantId: "t" });
  },
  normalizeHash: () => {
    expect(root.normalizeHash(0)).toBe(0);
    expect(root.normalizeHash(-2147483648)).toBe(1);
    expect(root.normalizeHash(2147483647)).toBe(1);
  },
  reportError: async () => {
    const telemetry = startTestTelemetry({ serviceName: "compat" });
    const error = new TypeError("lookup failed");

    // with no active span: an `error.report` span carrying the exception, and an ERROR log line
    root.reportError(error, { where: "compat" });
    const [reported] = await telemetry.spans();
    expect(reported?.name).toBe("error.report");
    expect(reported?.events.map((event) => event.name)).toEqual(["exception"]);
    expect(reported?.attributes).toMatchObject({ where: "compat", "breadcrumbs.count": 0 });
    const [line] = await telemetry.logRecords();
    expect(line?.severityText).toBe("ERROR");
    expect(line?.body).toBe("lookup failed");
    expect(line?.attributes).toMatchObject({ where: "compat" });

    // with an active span: recorded on that span, whose status becomes ERROR
    telemetry.clear();
    trace.getTracer("compat").startActiveSpan("handler", (span) => {
      root.reportError(error);
      span.end();
    });
    const spans = await telemetry.spans();
    expect(spans.map((span) => span.name)).toEqual(["handler"]);
    expect(spans[0]?.status).toEqual({ code: ApiSpanStatusCode.ERROR, message: "lookup failed" });
    expect(spans[0]?.events.map((event) => event.name)).toEqual(["exception"]);
  },
  runWithBusinessContext: async () => {
    await withContextManager();
    expect(root.runWithBusinessContext({ feature: "f" }, () => root.getSmartContext().feature)).toBe("f");
    expect(root.getSmartContext()).toEqual({});
  },
  sanitize: () => {
    expect(root.sanitize({ password: "p", name: "n" })).toEqual({ password: "[REDACTED]", name: "n" });
  },
  sanitizeError: () => {
    const sanitized = root.sanitizeError(new Error("card 4111 1111 1111 1111 declined"));
    expect(sanitized.message).toBe("card [REDACTED] declined");
  },
  sanitizeObject: () => {
    expect(root.sanitizeObject({ nested: { token: "abc" } })).toEqual({ nested: { token: "[REDACTED]" } });
  },
  sanitizeString: () => {
    expect(root.sanitizeString("ssn 123-45-6789")).toBe("ssn [REDACTED]");
  },
  setUser: () => {
    root.setUser({ id: "user-1" });
    expect(root.getGlobalContext().getContext().userId).toBe("user-1");
  },
  shutdownObservability: async () => {
    await root.SmartClient.initialize({ environment: "node", serviceName: "compat", skipSdkInitialization: true });
    await root.shutdownObservability();
    expect(root.getUnifiedClientInstance()).toBeNull();
  },
  withErrorReporting: async () => {
    expect(root.withErrorReporting(() => 1)).toBe(1);
    await expect(root.withErrorReporting(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  },
};

describe("every table", () => {
  it.each(TABLES)("%s has rows", (name) => {
    expect(tableRows(name).length).toBeGreaterThan(0);
  });

  it.each(TABLES)("%s gives the 1.x behaviour, the new one and why in every changed row", (name) => {
    for (const row of tableRecords(name)) {
      const status = row.Status ?? "";
      if (!status.startsWith("changed")) continue;
      const label = Object.values(row)[0];
      for (const column of ["1.x", "2.x", "Why"]) {
        expect(row[column], `${name} › ${label} has no ${column}`).toBeTruthy();
      }
    }
  });
});

describe("the root entry's table", () => {
  it("has one row for every root export, of the right kind, and no row for anything else", () => {
    const exported = rootExports();
    const rowNames = ROWS.map((row) => row.name);
    expect(new Set(rowNames).size, "a name has two rows").toBe(rowNames.length);
    const missing = [...exported.keys()].filter((name) => !rowNames.includes(name));
    expect(missing, "root exports with no row in COMPATIBILITY.md").toEqual([]);
    const stray = ROWS.filter((row) => !exported.has(row.name) && row.status !== "removed");
    expect(stray.map((row) => row.name), "rows for names the root entry does not export").toEqual([]);
    for (const row of ROWS.filter((r) => exported.has(r.name))) {
      expect(row.kind, row.name).toBe(exported.get(row.name));
    }
  });

  it("has a row for every name 1.x exported, so an export cannot leave with its row", () => {
    expect(EXPORTS_1X.length).toBeGreaterThan(0);
    const rowNames = ROWS.map((row) => row.name);
    expect(EXPORTS_1X.filter((name) => !rowNames.includes(name)), "1.x exports with no row").toEqual([]);
  });

  it("says unchanged, changed or removed in every row", () => {
    for (const row of ROWS) expect(["unchanged", "changed", "removed"], row.name).toContain(row.status);
  });
});

describe("root export", () => {
  it.each(ROWS.map((row) => row.name))("%s", async (name) => {
    const check = CHECKS[name];
    expect(check, `no check for ${name}`).toBeDefined();
    if (ROWS.find((row) => row.name === name)?.kind === "value") {
      expect((root as Record<string, unknown>)[name], `${name} does not resolve`).toBeDefined();
    }
    await check!();
  });
});

describe("the types the sanitizer exports' signatures expose", () => {
  type DataSanitizer = ReturnType<root.SanitizerManager["getSanitizer"]>;
  type SanitizationContext = NonNullable<Parameters<typeof root.sanitize>[1]>;
  type SanitizedValue = ReturnType<typeof root.sanitize>;

  const TYPE_CHECKS: Record<string, () => void> = {
    DataSanitizer: () => {
      const sanitizer: DataSanitizer = new root.SanitizerManager().getDefault();
      expect(sanitizer.shouldRedactField("password")).toBe(true);
      expect(sanitizer.sanitizeLabels({ password: "p", ok: "1" })).toEqual({ password: "[REDACTED]", ok: "1" });
      expect(typeof sanitizer.clearCache).toBe("function");
      expect(sanitizer.getCacheStats()).toHaveProperty("size");
    },
    SanitizationContext: () => {
      const ctx: SanitizationContext = { tenantId: "t", region: "eu" };
      expect(root.sanitizeString("plain", ctx)).toBe("plain");
    },
    SanitizedValue: () => {
      const value: SanitizedValue = root.sanitize({ a: 1 });
      expect(value).toEqual({ a: 1 });
    },
  };

  it.each(tableRows("signature-types").map(([name]) => unquote(name!)))("%s", (name) => {
    expect(TYPE_CHECKS[name], `no check for ${name}`).toBeDefined();
    TYPE_CHECKS[name]!();
  });
});

describe("the facade's table", () => {
  const rows = tableRows("facade-behaviour").map((cells) => ({
    row: unquote(cells[0]!),
    status: cells[3]!,
    why: cells[4]!,
    test: cells[5]!,
  }));

  it.each(rows.map((r) => [r.row, r] as const))("row %s names a test that exists", (_, row) => {
    const match = /^`([^`]+)` › (.+)$/.exec(row.test);
    expect(match, `the test cell of ${row.row} reads \`file\` › name`).not.toBeNull();
    const source = readFileSync(path.join(PACKAGE, "src/__tests__/preset", match![1]!), "utf8");
    expect(source, `${match![1]} has no test named "${match![2]}"`).toContain(`it("${match![2]}"`);
  });

  it("says why for every changed row", () => {
    for (const row of rows) {
      expect(["unchanged", "changed", "changed, by design"], row.row).toContain(row.status);
      if (row.status !== "unchanged") expect(row.why, row.row).not.toBe("");
      // a change made by design cites the plan's rule
      if (row.status === "changed, by design") expect(row.why, row.row).toMatch(/^by design \(plan, Design › \w+\):/);
    }
  });

  it("has a row for each item the owner listed", () => {
    expect(rows.map((r) => r.row)).toEqual(
      expect.arrayContaining([
        "sampling",
        "metric-interval",
        "logs",
        "NODE_ENV",
        "OTEL_SDK_DISABLED-hooks",
        "endpoint-v1-traces",
      ]),
    );
  });
});

describe("the removed exports' table", () => {
  const ENTRIES: Record<string, string> = { "/testing": "src/testing.mts" };
  // entries deleted whole; their names must not reappear on any entry that remains
  const REMOVED_ENTRIES = ["/browser"];
  const manifest = JSON.parse(readFileSync(path.join(PACKAGE, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  };
  /** the source of every entry the exports map still has */
  const liveSources = Object.keys(manifest.exports).map((key) =>
    path.join(PACKAGE, key === "." ? "src/index.mts" : `src/${key.slice(2)}.mts`),
  );
  const rows = tableRows("removed-exports").map(
    (cells) => [unquote(cells[0]!), unquote(cells[1]!), cells[2]!, cells[3]!] as const,
  );

  // fixed here, so a row deleted from the table fails rather than leaving with its check
  const BROWSER_NAMES = [
    "BrowserInitConfig",
    "BrowserClientUserConfig",
    "BrowserClientConfig",
    "RECOMMENDED_BROWSER_INSTRUMENTATION",
    "FULL_BROWSER_INSTRUMENTATION",
  ];

  it.each(BROWSER_NAMES)("has a removed /browser row for %s, and no entry exports it", (name) => {
    const row = rows.find(([entry, rowName]) => entry === "/browser" && rowName === name);
    expect(row, `no /browser row for ${name}`).toBeDefined();
    expect(row![3]).toBe("removed");
    for (const source of liveSources) {
      expect([...exportsOf(source).keys()], `${name} on ${path.relative(PACKAGE, source)}`).not.toContain(name);
    }
  });

  it("lists each removed entry with a row of its own", () => {
    for (const entry of REMOVED_ENTRIES) {
      expect(rows.filter(([e, , kind]) => e === entry && kind === "entry"), entry).toHaveLength(1);
    }
  });

  it.each(rows.filter(([, , kind]) => kind === "entry").map(([entry, , , status]) => [entry, status] as const))(
    "the %s entry is gone from the exports map and the sources",
    (entry, status) => {
      expect(status).toBe("removed");
      expect(REMOVED_ENTRIES).toContain(entry);
      expect(Object.keys(manifest.exports)).not.toContain(`.${entry}`);
      expect(existsSync(path.join(PACKAGE, `src${entry}.mts`)), `src${entry}.mts`).toBe(false);
    },
  );

  it.each(rows.filter(([, , kind]) => kind !== "entry").map(([entry, name, , status]) => [entry, name, status] as const))(
    "%s no longer exports %s",
    (entry, name, status) => {
      expect(status).toBe("removed");
      if (REMOVED_ENTRIES.includes(entry)) {
        for (const source of liveSources) {
          expect([...exportsOf(source).keys()], `${name} on ${path.relative(PACKAGE, source)}`).not.toContain(name);
        }
        return;
      }
      expect(ENTRIES[entry], `no source file known for ${entry}`).toBeDefined();
      expect([...exportsOf(path.join(PACKAGE, ENTRIES[entry]!)).keys()]).not.toContain(name);
    },
  );
});
